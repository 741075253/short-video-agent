import { createHash, randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Repository } from 'typeorm'
import type { ReviewResult } from '../../../shared/workflow'
import { DatabaseService } from '../persistence/persistence.service'
import {
  ApprovalEntity,
  ArtifactVersionEntity,
  ReviewEntity,
  UsageLedgerEntity,
  type ApprovalRecord,
  type ArtifactVersionRecord,
  type ReviewRecord,
  type UsageLedgerRecord
} from '../persistence/entities'

type ArtifactInput = {
  projectId: string
  runId: string
  kind: string
  ownerId?: string
  input: unknown
  data?: Record<string, unknown>
  filePath?: string
}

const downstreamKinds: Record<string, string[]> = {
  story_analysis: ['director_plan', 'character_bible', 'character_reference', 'plot_outline', 'scene_bible', 'storyboard', 'shot_image', 'shot_video', 'final_video'],
  director_plan: ['character_bible', 'character_reference', 'plot_outline', 'scene_bible', 'storyboard', 'shot_image', 'shot_video', 'final_video'],
  character_bible: ['character_reference', 'plot_outline', 'scene_bible', 'storyboard', 'shot_image', 'shot_video', 'final_video'],
  character_reference: ['plot_outline', 'scene_bible', 'storyboard', 'shot_image', 'shot_video', 'final_video'],
  plot_outline: ['scene_bible', 'storyboard', 'shot_image', 'shot_video', 'final_video'],
  scene_bible: ['storyboard', 'shot_image', 'shot_video', 'final_video'],
  storyboard: ['shot_image', 'shot_video', 'final_video'],
  shot_image: ['shot_video', 'final_video'],
  shot_video: ['final_video']
}

@Injectable()
export class ArtifactService {
  private readonly artifacts: Repository<ArtifactVersionRecord>
  private readonly approvals: Repository<ApprovalRecord>
  private readonly reviews: Repository<ReviewRecord>
  private readonly usage: Repository<UsageLedgerRecord>

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.artifacts = database.dataSource.getRepository(ArtifactVersionEntity)
    this.approvals = database.dataSource.getRepository(ApprovalEntity)
    this.reviews = database.dataSource.getRepository(ReviewEntity)
    this.usage = database.dataSource.getRepository(UsageLedgerEntity)
  }

  hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  async append(input: ArtifactInput): Promise<ArtifactVersionRecord> {
    const ownerId = input.ownerId ?? null
    const existing = await this.artifacts.find({
      where: { projectId: input.projectId, kind: input.kind },
      order: { version: 'DESC' }
    })
    const siblings = existing.filter((artifact) => artifact.ownerId === ownerId)
    await Promise.all(siblings
      .filter((artifact) => artifact.status === 'current')
      .map((artifact) => this.artifacts.update(artifact.id, { status: 'history' })))
    const artifact: ArtifactVersionRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      runId: input.runId,
      kind: input.kind,
      ownerId,
      version: (siblings[0]?.version ?? 0) + 1,
      status: 'current',
      inputHash: this.hash(input.input),
      data: input.data ?? null,
      filePath: input.filePath ?? null,
      createdAt: new Date()
    }
    return this.artifacts.save(artifact)
  }

  async findReusable(projectId: string, kind: string, ownerId: string | undefined, input: unknown): Promise<ArtifactVersionRecord | null> {
    const inputHash = this.hash(input)
    const artifacts = await this.artifacts.find({ where: { projectId, kind, status: 'current' } })
    return artifacts.find((artifact) => artifact.ownerId === (ownerId ?? null) && artifact.inputHash === inputHash) ?? null
  }

  async invalidateFrom(projectId: string, kind: string, ownerIds?: string[]): Promise<void> {
    const kinds = downstreamKinds[kind] ?? []
    if (kinds.length === 0) return
    const current = await this.artifacts.find({ where: { projectId, status: 'current' } })
    const affected = current.filter((artifact) =>
      kinds.includes(artifact.kind) && (!ownerIds || !artifact.ownerId || ownerIds.includes(artifact.ownerId)))
    await Promise.all(affected.map((artifact) => this.artifacts.update(artifact.id, { status: 'stale' })))
  }

  async list(projectId: string): Promise<ArtifactVersionRecord[]> {
    return this.artifacts.find({ where: { projectId }, order: { createdAt: 'DESC' } })
  }

  async get(id: string): Promise<ArtifactVersionRecord | null> {
    return this.artifacts.findOneBy({ id })
  }

  async rollback(projectId: string, id: string): Promise<ArtifactVersionRecord> {
    const target = await this.artifacts.findOneBy({ id, projectId })
    if (!target) throw new Error('回滚版本不存在')
    const siblings = await this.artifacts.find({ where: { projectId, kind: target.kind } })
    const sameOwner = siblings.filter((artifact) => artifact.ownerId === target.ownerId)
    await Promise.all(sameOwner
      .filter((artifact) => artifact.status === 'current' && artifact.id !== target.id)
      .map((artifact) => this.artifacts.update(artifact.id, { status: 'history' })))
    await this.artifacts.update(target.id, { status: 'current' })
    await this.invalidateFrom(projectId, target.kind, target.ownerId ? [target.ownerId] : undefined)
    return { ...target, status: 'current' }
  }

  async recordApproval(runId: string, kind: string, approved: boolean, payload?: Record<string, unknown>): Promise<void> {
    await this.approvals.save({
      id: randomUUID(),
      runId,
      kind,
      approved,
      payload: payload ?? null,
      createdAt: new Date()
    })
  }

  async recordReview(runId: string, result: ReviewResult): Promise<void> {
    await this.reviews.save({ id: randomUUID(), runId, result, createdAt: new Date() })
  }

  async recordUsage(input: Omit<UsageLedgerRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.usage.save({ ...input, id: randomUUID(), createdAt: new Date() })
  }
}
