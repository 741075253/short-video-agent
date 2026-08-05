import { randomUUID } from 'node:crypto'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Command } from '@langchain/langgraph'
import type { Repository } from 'typeorm'
import {
  defaultProductionConfig,
  ProductionConfigSchema
} from '../../../shared/schema'
import {
  defaultUsageBudget,
  ResumeRunInputSchema,
  StartRunInputSchema,
  UsageBudgetSchema,
  WorkflowStateSchema,
  type ResumeRunInput,
  type RunStatus,
  type StartRunInput,
  type WorkflowState
} from '../../../shared/workflow'
import { ProjectsService } from '../projects/projects.service'
import { getDefaultModelSelection } from '../../services/modelCatalog'
import { DatabaseService } from '../persistence/persistence.service'
import { WorkflowRunEntity, type WorkflowRunRecord } from '../persistence/entities'
import { ArtifactService } from '../workflow/artifact.service'
import { MediaProductionService } from '../workflow/media-production.service'
import { ModelGateway } from '../workflow/model-gateway.service'
import { WorkflowGraphService } from '../workflow/workflow-graph.service'
import { RunEventsService } from './run-events.service'

type PublicRun = Omit<WorkflowRunRecord, 'createdAt' | 'updatedAt' | 'completedAt'> & {
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

@Injectable()
export class RunsService {
  private readonly runs: Repository<WorkflowRunRecord>
  private readonly activeRuns = new Set<string>()

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(WorkflowGraphService) private readonly workflow: WorkflowGraphService,
    @Inject(RunEventsService) private readonly events: RunEventsService,
    @Inject(ArtifactService) private readonly artifacts: ArtifactService,
    @Inject(ModelGateway) private readonly models: ModelGateway,
    @Inject(MediaProductionService) private readonly media: MediaProductionService
  ) {
    this.runs = database.dataSource.getRepository(WorkflowRunEntity)
  }

  async start(projectId: string, rawInput: unknown): Promise<PublicRun> {
    const input = StartRunInputSchema.parse(rawInput ?? {})
    const project = await this.projects.get(projectId)
    if (project.sourceText.trim().length < 10) throw new Error('故事内容至少需要 10 个字符')
    const projectConfig = project.productionConfig ?? ProductionConfigSchema.parse({
      ...defaultProductionConfig,
      ...getDefaultModelSelection()
    })
    const productionConfig = ProductionConfigSchema.parse({
      ...projectConfig,
      ...input.productionConfig,
      videoOptions: {
        ...projectConfig.videoOptions,
        ...input.productionConfig?.videoOptions,
        nativeAudio: false
      }
    })
    const budget = UsageBudgetSchema.parse({ ...defaultUsageBudget, ...input.budget })
    const episodes = await this.projects.listEpisodes(projectId)
    if (episodes.length > 1 && !input.episodeId) throw new Error('多集项目必须选择要制作的剧集')
    const episode = input.episodeId
      ? await this.projects.getEpisode(projectId, input.episodeId)
      : episodes[0]
    const id = randomUUID()
    const state = WorkflowStateSchema.parse({
      runId: id,
      projectId,
      episodeId: episode?.id,
      episodeNumber: episode?.episodeNumber,
      sourceText: project.sourceText,
      productionConfig,
      revisionCount: {},
      usageBudget: budget,
      errors: []
    })
    this.models.ensureConfigured(productionConfig.textModel)
    this.media.ensureConfigured(state)
    const now = new Date()
    const run = await this.runs.save({
      id,
      projectId,
      episodeId: episode?.id ?? null,
      threadId: `${projectId}:${episode?.id ?? 'single'}:${id}`,
      status: 'queued',
      currentNode: null,
      state,
      interrupt: null,
      budget,
      cancelRequested: false,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    })
    this.events.emit(id, 'run.queued')
    setImmediate(() => void this.execute(id, state))
    return this.toPublic(run)
  }

  async get(id: string): Promise<PublicRun> {
    return this.toPublic(await this.getRecord(id))
  }

  async listForProject(projectId: string): Promise<PublicRun[]> {
    const records = await this.runs.find({ where: { projectId }, order: { createdAt: 'DESC' } })
    return records.map((record) => this.toPublic(record))
  }

  async resume(id: string, rawInput: unknown): Promise<PublicRun> {
    const input = ResumeRunInputSchema.parse(rawInput)
    const run = await this.getRecord(id)
    if (!run.status.startsWith('waiting_')) throw new Error('当前任务不在等待人工处理状态')
    if (run.cancelRequested) throw new Error('任务已请求取消')
    await this.runs.update(id, { status: 'queued', interrupt: null, error: null })
    this.events.emit(id, 'run.queued', { resumed: true })
    const executionInput = run.status === 'waiting_step_review'
      ? null
      : new Command({ resume: input })
    setImmediate(() => void this.execute(id, executionInput))
    return this.get(id)
  }

  async cancel(id: string): Promise<PublicRun> {
    const run = await this.getRecord(id)
    const waiting = run.status.startsWith('waiting_') || run.status === 'queued'
    await this.runs.update(id, {
      cancelRequested: true,
      status: waiting ? 'cancelled' : 'cancel_requested',
      completedAt: waiting ? new Date() : null
    })
    this.events.emit(id, waiting ? 'run.cancelled' : 'run.cancel_requested')
    if (waiting) this.events.close(id)
    return this.get(id)
  }

  async listArtifacts(id: string) {
    const run = await this.getRecord(id)
    return this.artifacts.list(run.projectId)
  }

  async getArtifact(id: string) {
    const artifact = await this.artifacts.get(id)
    if (!artifact) throw new NotFoundException('产物不存在')
    return artifact
  }

  async rollback(id: string, artifactId: string) {
    const run = await this.getRecord(id)
    if (run.status === 'running' || run.status === 'queued' || run.status === 'cancel_requested') {
      throw new Error('流程执行中不能回滚版本')
    }
    const artifact = await this.artifacts.rollback(run.projectId, artifactId)
    if (!run.state) return artifact
    const state = structuredClone(run.state)
    const fieldByKind: Record<string, keyof WorkflowState> = {
      story_analysis: 'storyAnalysis',
      director_plan: 'directorPlan',
      character_bible: 'characterBible',
      plot_outline: 'plotOutline',
      scene_bible: 'sceneBible',
      storyboard: 'storyboard'
    }
    const field = fieldByKind[artifact.kind]
    if (field && artifact.data) Object.assign(state, { [field]: artifact.data })
    this.clearDownstreamState(state, artifact.kind, artifact.ownerId)
    if (artifact.kind === 'character_reference' && artifact.ownerId && artifact.filePath) {
      state.characterReferences = (state.characterReferences ?? []).map((reference) =>
        reference.characterId === artifact.ownerId
          ? { ...reference, imagePath: artifact.filePath!, version: artifact.version, approved: true }
          : reference)
    }
    if ((artifact.kind === 'shot_image' || artifact.kind === 'shot_video') && artifact.ownerId && artifact.filePath && state.generatedAssets) {
      state.generatedAssets.shots = state.generatedAssets.shots.map((shot) => {
        if (shot.id !== artifact.ownerId) return shot
        return artifact.kind === 'shot_image'
          ? { ...shot, assetPath: artifact.filePath!, videoClipPath: undefined, status: 'pending' as const }
          : { ...shot, videoClipPath: artifact.filePath!, status: 'ready' as const }
      })
    }
    if (artifact.kind === 'final_video' && artifact.filePath) {
      state.editResult = { outputPath: artifact.filePath }
    }
    const parsedState = WorkflowStateSchema.parse(state)
    await this.workflow.graph.updateState(
      { configurable: { thread_id: run.threadId } },
      parsedState as never
    )
    await this.runs.update(id, { state: parsedState })
    if (artifact.kind !== 'final_video') {
      await this.projects.saveWorkflowResult(run.projectId, {
        storyPackage: parsedState.storyboard,
        finalOutputPath: undefined
      })
    } else if (artifact.kind === 'final_video' && artifact.filePath) {
      await this.projects.saveWorkflowResult(run.projectId, {
        storyPackage: parsedState.storyboard,
        finalOutputPath: artifact.filePath
      })
    }
    this.events.emit(id, 'artifact.rolled_back', { artifactId, kind: artifact.kind, version: artifact.version })
    return artifact
  }

  private clearDownstreamState(state: WorkflowState, kind: string, ownerId: string | null): void {
    const clear = (...fields: Array<keyof WorkflowState>) => {
      for (const field of fields) Object.assign(state, { [field]: undefined })
    }
    const downstreamByKind: Record<string, Array<keyof WorkflowState>> = {
      story_analysis: ['directorPlan', 'characterBible', 'characterReferences', 'plotOutline', 'sceneBible', 'storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      director_plan: ['characterBible', 'characterReferences', 'plotOutline', 'sceneBible', 'storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      character_bible: ['characterReferences', 'plotOutline', 'sceneBible', 'storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      character_reference: ['plotOutline', 'sceneBible', 'storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      plot_outline: ['sceneBible', 'storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      scene_bible: ['storyboard', 'generatedAssets', 'editResult', 'reviewResult'],
      storyboard: ['generatedAssets', 'editResult', 'reviewResult'],
      shot_image: ['editResult', 'reviewResult'],
      shot_video: ['editResult', 'reviewResult']
    }
    clear(...(downstreamByKind[kind] ?? []))

    if (kind === 'shot_image' && ownerId && state.generatedAssets) {
      state.generatedAssets.shots = state.generatedAssets.shots.map((shot) =>
        shot.id === ownerId ? { ...shot, videoClipPath: undefined, status: 'pending' } : shot
      )
    }
  }

  private async execute(id: string, input: WorkflowState | Command<ResumeRunInput> | null): Promise<void> {
    if (this.activeRuns.has(id)) return
    this.activeRuns.add(id)
    try {
      const run = await this.getRecord(id)
      if (run.cancelRequested || run.status === 'cancelled') return
      await this.runs.update(id, { status: 'running', error: null })
      this.events.emit(id, 'run.started')
      const config = {
        configurable: { thread_id: run.threadId },
        recursionLimit: 100,
        streamMode: 'values' as const,
        durability: 'sync' as const
      }
      const stream = await this.workflow.graph.stream(input as never, config)
      let latestState: WorkflowState | undefined
      for await (const value of stream) {
        const state = WorkflowStateSchema.parse(value)
        latestState = state
        const snapshot = await this.workflow.graph.getState(config)
        const currentNode = snapshot.next[0] ?? null
        await this.runs.update(id, {
          state,
          budget: state.usageBudget,
          currentNode,
          updatedAt: new Date()
        })
        this.events.emit(id, 'node.completed', {
          nextNode: currentNode,
          usedTokens: state.usageBudget.usedInputTokens + state.usageBudget.usedOutputTokens
        })
        const latest = await this.getRecord(id)
        if (latest.cancelRequested) {
          await this.runs.update(id, { status: 'cancelled', completedAt: new Date() })
          this.events.emit(id, 'run.cancelled')
          this.events.close(id)
          return
        }
        void value
      }

      const snapshot = await this.workflow.graph.getState(config)
      const snapshotState = WorkflowStateSchema.safeParse(snapshot.values)
      const state = snapshotState.success ? snapshotState.data : latestState
      if (!state) throw snapshotState.error
      const interruptions = snapshot.tasks.flatMap((task) => task.interrupts ?? [])
      if (interruptions.length > 0) {
        const interruptValue = interruptions[0].value as Record<string, unknown> | undefined
        const status = this.statusForInterrupt(interruptValue?.type)
        await this.runs.update(id, {
          status,
          state,
          budget: state.usageBudget,
          currentNode: snapshot.next[0] ?? null,
          interrupt: (interruptValue ?? null) as never
        })
        this.events.emit(id, 'run.interrupted', { status, interrupt: interruptValue ?? {} })
        return
      }
      if (snapshot.next.length > 0) {
        const nextNode = snapshot.next[0]
        const interruptValue = {
          type: 'step_review',
          completedNode: this.completedNode(snapshot.metadata),
          nextNode
        }
        await this.runs.update(id, {
          status: 'waiting_step_review',
          state,
          budget: state.usageBudget,
          currentNode: nextNode,
          interrupt: interruptValue as never
        })
        this.events.emit(id, 'run.interrupted', { status: 'waiting_step_review', interrupt: interruptValue })
        return
      }
      await this.runs.update(id, {
        status: 'completed',
        state,
        budget: state.usageBudget,
        currentNode: null,
        completedAt: new Date()
      })
      this.events.emit(id, 'run.completed', { outputPath: state.editResult?.outputPath })
      this.events.close(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.runs.update(id, { status: 'failed', error: message, completedAt: new Date() })
      this.events.emit(id, 'run.failed', { message })
      this.events.close(id)
    } finally {
      this.activeRuns.delete(id)
    }
  }

  private statusForInterrupt(type: unknown): RunStatus {
    if (type === 'character_approval') return 'waiting_character_approval'
    if (type === 'storyboard_approval') return 'waiting_storyboard_approval'
    if (type === 'budget_approval') return 'waiting_budget_approval'
    return 'waiting_human_review'
  }

  private completedNode(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || !('writes' in metadata)) return null
    const writes = (metadata as { writes?: unknown }).writes
    if (!writes || typeof writes !== 'object' || Array.isArray(writes)) return null
    return Object.keys(writes)[0] ?? null
  }

  private async getRecord(id: string): Promise<WorkflowRunRecord> {
    const run = await this.runs.findOneBy({ id })
    if (!run) throw new NotFoundException('运行任务不存在')
    return run
  }

  private toPublic(record: WorkflowRunRecord): PublicRun {
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null
    }
  }
}
