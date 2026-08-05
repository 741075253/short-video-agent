import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { LessThanOrEqual, type DeepPartial, type Repository } from 'typeorm'
import {
  defaultProductionConfig,
  ProductionConfigSchema,
  ProjectSchema,
  type Project
} from '../../../shared/schema'
import { persistenceConfig } from '../../config'
import { getDefaultModelSelection } from '../../services/modelCatalog'
import type { Episode } from '../../../shared/workflow'
import { exportProjectJson, exportProjectMarkdown } from '../../services/exporters'
import { DatabaseService } from '../persistence/persistence.service'
import {
  MigrationRecordEntity,
  EpisodeEntity,
  type EpisodeRecord,
  ProjectEntity,
  type MigrationRecord,
  type ProjectRecord
} from '../persistence/entities'

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly database: DatabaseService
  private readonly projects: Repository<ProjectRecord>
  private readonly migrations: Repository<MigrationRecord>
  private readonly episodes: Repository<EpisodeRecord>

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.database = database
    this.projects = database.dataSource.getRepository(ProjectEntity)
    this.migrations = database.dataSource.getRepository(MigrationRecordEntity)
    this.episodes = database.dataSource.getRepository(EpisodeEntity)
  }

  async onModuleInit(): Promise<void> {
    await this.database.ready()
    await this.importLegacyProjects()
  }

  async list(): Promise<Project[]> {
    const records = await this.projects.find({ order: { updatedAt: 'DESC' } })
    return records.map((record) => this.toProject(record))
  }

  async create(input: { name?: unknown; sourceText?: unknown; productionConfig?: unknown }): Promise<Project> {
    const now = new Date()
    const requestedConfig = ProductionConfigSchema.partial().parse(input.productionConfig ?? {})
    const project: ProjectRecord = {
      id: randomUUID(),
      name: String(input.name || '未命名项目'),
      sourceText: String(input.sourceText || ''),
      style: 'animation_drama',
      productionConfig: ProductionConfigSchema.parse({
        ...defaultProductionConfig,
        ...getDefaultModelSelection(),
        ...requestedConfig
      }),
      storyPackage: null,
      finalOutputPath: null,
      createdAt: now,
      updatedAt: now
    }
    const saved = this.toProject(await this.projects.save(project))
    await this.ensureEpisodes(saved.id, saved.productionConfig?.episodeCount ?? 1)
    return saved
  }

  async get(id: string): Promise<Project> {
    const record = await this.projects.findOneBy({ id })
    if (!record) throw new NotFoundException('项目不存在')
    return this.toProject(record)
  }

  async update(id: string, input: Partial<Project>): Promise<Project> {
    const existing = await this.projects.findOneBy({ id })
    if (!existing) throw new NotFoundException('项目不存在')
    const merged = ProjectSchema.parse({
      ...this.toProject(existing),
      ...input,
      id,
      updatedAt: new Date().toISOString()
    })
    const saved = this.toProject(await this.projects.save(this.fromProject(merged)))
    await this.ensureEpisodes(id, saved.productionConfig?.episodeCount ?? 1)
    return saved
  }

  async saveWorkflowResult(id: string, input: Pick<Project, 'storyPackage' | 'finalOutputPath'>): Promise<Project> {
    return this.update(id, input)
  }

  async exportJson(id: string): Promise<string> {
    return exportProjectJson(await this.get(id))
  }

  async exportMarkdown(id: string): Promise<string> {
    return exportProjectMarkdown(await this.get(id))
  }

  async listEpisodes(projectId: string): Promise<Episode[]> {
    const project = await this.get(projectId)
    const count = project.productionConfig?.episodeCount ?? 1
    await this.ensureEpisodes(projectId, count)
    const records = await this.episodes.find({
      where: { projectId, episodeNumber: LessThanOrEqual(count) },
      order: { episodeNumber: 'ASC' }
    })
    return records.map((record) => this.toEpisode(record))
  }

  async getEpisode(projectId: string, episodeId: string): Promise<Episode> {
    const record = await this.episodes.findOneBy({ id: episodeId, projectId })
    if (!record) throw new NotFoundException('剧集不存在')
    return this.toEpisode(record)
  }

  private toProject(record: ProjectRecord): Project {
    return ProjectSchema.parse({
      id: record.id,
      name: record.name,
      sourceText: record.sourceText,
      style: record.style,
      productionConfig: record.productionConfig ?? ProductionConfigSchema.parse({
        ...defaultProductionConfig,
        ...getDefaultModelSelection()
      }),
      storyPackage: record.storyPackage ?? undefined,
      finalOutputPath: record.finalOutputPath ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    })
  }

  private fromProject(project: Project): DeepPartial<ProjectRecord> {
    return {
      id: project.id,
      name: project.name,
      sourceText: project.sourceText,
      style: project.style,
      productionConfig: project.productionConfig ?? ProductionConfigSchema.parse({
        ...defaultProductionConfig,
        ...getDefaultModelSelection()
      }),
      storyPackage: project.storyPackage ?? null,
      finalOutputPath: project.finalOutputPath ?? null,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt)
    }
  }

  private async importLegacyProjects(): Promise<void> {
    const projectsDir = join(persistenceConfig.dataDir, 'projects')
    let files: string[]
    try {
      files = (await readdir(projectsDir)).filter((file) => file.endsWith('.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const file of files) {
      const sourcePath = join(projectsDir, file)
      try {
        const raw = await readFile(sourcePath, 'utf8')
        const sourceHash = createHash('sha256').update(raw).digest('hex')
        const migrated = await this.migrations.findOneBy({ sourcePath, sourceHash, migrationVersion: 1 })
        if (migrated) continue
        const project = ProjectSchema.parse(JSON.parse(raw))
        const existing = await this.projects.findOneBy({ id: project.id })
        if (!existing) await this.projects.save(this.fromProject(project))
        await this.ensureEpisodes(project.id, project.productionConfig?.episodeCount ?? 1)
        await this.migrations.save({
          id: randomUUID(),
          sourcePath,
          sourceHash,
          migrationVersion: 1,
          createdAt: new Date()
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`旧项目导入失败 ${sourcePath}: ${message}`)
      }
    }
  }

  private async ensureEpisodes(projectId: string, count: number): Promise<void> {
    const existing = await this.episodes.find({ where: { projectId } })
    const existingNumbers = new Set(existing.map((episode) => episode.episodeNumber))
    const now = new Date()
    const missing: EpisodeRecord[] = []
    for (let episodeNumber = 1; episodeNumber <= count; episodeNumber++) {
      if (existingNumbers.has(episodeNumber)) continue
      missing.push({
        id: randomUUID(),
        projectId,
        episodeNumber,
        title: `第 ${episodeNumber} 集`,
        state: null,
        createdAt: now,
        updatedAt: now
      })
    }
    if (missing.length > 0) await this.episodes.save(missing)
  }

  private toEpisode(record: EpisodeRecord): Episode {
    return {
      id: record.id,
      projectId: record.projectId,
      episodeNumber: record.episodeNumber,
      title: record.title,
      state: record.state,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    }
  }
}
