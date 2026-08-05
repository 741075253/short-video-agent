import { EntitySchema } from 'typeorm'
import type { ProductionConfig, Project } from '../../../shared/schema'
import type { ReviewResult, RunStatus, UsageBudget, WorkflowState } from '../../../shared/workflow'

export type ProjectRecord = {
  id: string
  name: string
  sourceText: string
  style: Project['style']
  productionConfig: ProductionConfig | null
  storyPackage: Project['storyPackage'] | null
  finalOutputPath: string | null
  createdAt: Date
  updatedAt: Date
}

export type EpisodeRecord = {
  id: string
  projectId: string
  episodeNumber: number
  title: string
  state: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export type WorkflowRunRecord = {
  id: string
  projectId: string
  episodeId: string | null
  threadId: string
  status: RunStatus
  currentNode: string | null
  state: WorkflowState | null
  interrupt: Record<string, unknown> | null
  budget: UsageBudget
  cancelRequested: boolean
  error: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export type ArtifactVersionRecord = {
  id: string
  projectId: string
  runId: string
  kind: string
  ownerId: string | null
  version: number
  status: 'current' | 'stale' | 'history'
  inputHash: string
  data: Record<string, unknown> | null
  filePath: string | null
  createdAt: Date
}

export type ApprovalRecord = {
  id: string
  runId: string
  kind: string
  approved: boolean
  payload: Record<string, unknown> | null
  createdAt: Date
}

export type ReviewRecord = {
  id: string
  runId: string
  result: ReviewResult
  createdAt: Date
}

export type UsageLedgerRecord = {
  id: string
  runId: string
  node: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
  createdAt: Date
}

export type MigrationRecord = {
  id: string
  sourcePath: string
  sourceHash: string
  migrationVersion: number
  createdAt: Date
}

const timestamps = {
  createdAt: { name: 'created_at', type: Date, createDate: true },
  updatedAt: { name: 'updated_at', type: Date, updateDate: true }
} as const

export const ProjectEntity = new EntitySchema<ProjectRecord>({
  name: 'Project',
  tableName: 'projects',
  columns: {
    id: { type: 'uuid', primary: true },
    name: { type: String },
    sourceText: { name: 'source_text', type: 'text' },
    style: { type: String },
    productionConfig: { name: 'production_config', type: 'jsonb', nullable: true },
    storyPackage: { name: 'story_package', type: 'jsonb', nullable: true },
    finalOutputPath: { name: 'final_output_path', type: String, nullable: true },
    ...timestamps
  }
})

export const EpisodeEntity = new EntitySchema<EpisodeRecord>({
  name: 'Episode',
  tableName: 'episodes',
  columns: {
    id: { type: 'uuid', primary: true },
    projectId: { name: 'project_id', type: 'uuid' },
    episodeNumber: { name: 'episode_number', type: Number },
    title: { type: String },
    state: { type: 'jsonb', nullable: true },
    ...timestamps
  },
  indices: [{ columns: ['projectId', 'episodeNumber'], unique: true }]
})

export const WorkflowRunEntity = new EntitySchema<WorkflowRunRecord>({
  name: 'WorkflowRun',
  tableName: 'workflow_runs',
  columns: {
    id: { type: 'uuid', primary: true },
    projectId: { name: 'project_id', type: 'uuid' },
    episodeId: { name: 'episode_id', type: 'uuid', nullable: true },
    threadId: { name: 'thread_id', type: String, unique: true },
    status: { type: String },
    currentNode: { name: 'current_node', type: String, nullable: true },
    state: { type: 'jsonb', nullable: true },
    interrupt: { type: 'jsonb', nullable: true },
    budget: { type: 'jsonb' },
    cancelRequested: { name: 'cancel_requested', type: Boolean, default: false },
    error: { type: 'text', nullable: true },
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    completedAt: { name: 'completed_at', type: Date, nullable: true }
  },
  indices: [{ columns: ['projectId', 'createdAt'] }]
})

export const ArtifactVersionEntity = new EntitySchema<ArtifactVersionRecord>({
  name: 'ArtifactVersion',
  tableName: 'artifact_versions',
  columns: {
    id: { type: 'uuid', primary: true },
    projectId: { name: 'project_id', type: 'uuid' },
    runId: { name: 'run_id', type: 'uuid' },
    kind: { type: String },
    ownerId: { name: 'owner_id', type: String, nullable: true },
    version: { type: Number },
    status: { type: String },
    inputHash: { name: 'input_hash', type: String },
    data: { type: 'jsonb', nullable: true },
    filePath: { name: 'file_path', type: String, nullable: true },
    createdAt: timestamps.createdAt
  },
  indices: [
    { columns: ['projectId', 'kind', 'ownerId', 'version'], unique: true },
    { columns: ['runId', 'status'] }
  ]
})

export const ApprovalEntity = new EntitySchema<ApprovalRecord>({
  name: 'Approval',
  tableName: 'approvals',
  columns: {
    id: { type: 'uuid', primary: true },
    runId: { name: 'run_id', type: 'uuid' },
    kind: { type: String },
    approved: { type: Boolean },
    payload: { type: 'jsonb', nullable: true },
    createdAt: timestamps.createdAt
  }
})

export const ReviewEntity = new EntitySchema<ReviewRecord>({
  name: 'Review',
  tableName: 'reviews',
  columns: {
    id: { type: 'uuid', primary: true },
    runId: { name: 'run_id', type: 'uuid' },
    result: { type: 'jsonb' },
    createdAt: timestamps.createdAt
  }
})

export const UsageLedgerEntity = new EntitySchema<UsageLedgerRecord>({
  name: 'UsageLedger',
  tableName: 'usage_ledgers',
  columns: {
    id: { type: 'uuid', primary: true },
    runId: { name: 'run_id', type: 'uuid' },
    node: { type: String },
    model: { type: String },
    inputTokens: { name: 'input_tokens', type: Number },
    outputTokens: { name: 'output_tokens', type: Number },
    cost: { type: 'double precision', default: 0 },
    durationMs: { name: 'duration_ms', type: Number },
    createdAt: timestamps.createdAt
  }
})

export const MigrationRecordEntity = new EntitySchema<MigrationRecord>({
  name: 'MigrationRecord',
  tableName: 'migration_records',
  columns: {
    id: { type: 'uuid', primary: true },
    sourcePath: { name: 'source_path', type: String },
    sourceHash: { name: 'source_hash', type: String },
    migrationVersion: { name: 'migration_version', type: Number },
    createdAt: timestamps.createdAt
  },
  indices: [{ columns: ['sourcePath', 'sourceHash', 'migrationVersion'], unique: true }]
})

export const entities = [
  ProjectEntity,
  EpisodeEntity,
  WorkflowRunEntity,
  ArtifactVersionEntity,
  ApprovalEntity,
  ReviewEntity,
  UsageLedgerEntity,
  MigrationRecordEntity
]
