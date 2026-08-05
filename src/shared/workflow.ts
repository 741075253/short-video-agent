import { z } from 'zod'
import {
  CharacterSchema,
  ProductionConfigSchema,
  SceneSchema,
  StoryPackageSchema
} from './schema'

export const SourceFactSchema = z.object({
  text: z.string().min(1),
  sourceRange: z.string().min(1)
})

export const StoryAnalysisSchema = z.object({
  summary: z.string().min(1),
  facts: z.array(SourceFactSchema),
  characters: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1)
  })).min(1),
  locations: z.array(z.string().min(1)),
  events: z.array(z.object({
    order: z.coerce.number().int().positive(),
    description: z.string().min(1),
    characterNames: z.array(z.string())
  })).min(1),
  conflicts: z.array(z.string())
})
export type StoryAnalysis = z.infer<typeof StoryAnalysisSchema>

export const DirectorPlanSchema = z.object({
  audience: z.string().min(1),
  tone: z.string().min(1),
  pacing: z.string().min(1),
  visualDirection: z.string().min(1),
  adaptationGoals: z.array(z.string().min(1)).min(1),
  episodeSummaries: z.array(z.object({
    episode: z.coerce.number().int().positive(),
    summary: z.string().min(1),
    targetDurationSeconds: z.coerce.number().int().positive()
  })).min(1)
})
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>

export const CharacterBibleEntrySchema = CharacterSchema.extend({
  personality: z.string().min(1),
  relationships: z.array(z.string()),
  wardrobe: z.string().min(1),
  negativeConstraints: z.array(z.string()),
  referencePrompt: z.string().min(1)
})

export const CharacterBibleSchema = z.object({
  characters: z.array(CharacterBibleEntrySchema).min(1).max(12)
})
export type CharacterBible = z.infer<typeof CharacterBibleSchema>

export const CharacterReferenceSchema = z.object({
  characterId: z.string(),
  version: z.number().int().positive(),
  imagePath: z.string(),
  approved: z.boolean().default(false)
})
export type CharacterReference = z.infer<typeof CharacterReferenceSchema>

export const PlotOutlineSchema = z.object({
  premise: z.string().min(1),
  beats: z.array(z.object({
    id: z.string().min(1),
    order: z.coerce.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
    characterIds: z.array(z.string()),
    dramaticPurpose: z.string().min(1)
  })).min(1),
  climax: z.string().min(1),
  ending: z.string().min(1)
})
export type PlotOutline = z.infer<typeof PlotOutlineSchema>

export const SceneBibleSchema = z.object({
  worldRules: z.array(z.string()),
  scenes: z.array(SceneSchema.extend({
    time: z.string().min(1),
    lighting: z.string().min(1),
    visualConstraints: z.array(z.string()),
    beatIds: z.array(z.string())
  })).min(1)
})
export type SceneBible = z.infer<typeof SceneBibleSchema>

export const ReviewResultSchema = z.object({
  passed: z.boolean(),
  targetNode: z.enum(['character', 'plot', 'scene', 'storyboard', 'production', 'editing']).optional(),
  scopeIds: z.array(z.string()).default([]),
  issues: z.array(z.string()).default([]),
  severity: z.enum(['info', 'warning', 'error']).default('info')
})
export type ReviewResult = z.infer<typeof ReviewResultSchema>

export const UsageBudgetSchema = z.object({
  maxTokens: z.coerce.number().int().positive().default(100000),
  maxCost: z.coerce.number().positive().default(100),
  usedInputTokens: z.coerce.number().int().nonnegative().default(0),
  usedOutputTokens: z.coerce.number().int().nonnegative().default(0),
  usedCost: z.coerce.number().nonnegative().default(0)
})
export type UsageBudget = z.infer<typeof UsageBudgetSchema>

export const defaultUsageBudget: UsageBudget = UsageBudgetSchema.parse({})

export const WorkflowErrorSchema = z.object({
  node: z.string(),
  message: z.string(),
  occurredAt: z.string()
})
export type WorkflowError = z.infer<typeof WorkflowErrorSchema>

export const NextActionSchema = z.enum([
  'character',
  'plot',
  'scene',
  'storyboard',
  'production',
  'editing',
  'human',
  'end'
])
export type NextAction = z.infer<typeof NextActionSchema>

export const WorkflowStateSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  episodeId: z.string().optional(),
  episodeNumber: z.number().int().positive().optional(),
  sourceText: z.string().min(10),
  productionConfig: ProductionConfigSchema,
  storyAnalysis: StoryAnalysisSchema.optional(),
  directorPlan: DirectorPlanSchema.optional(),
  characterBible: CharacterBibleSchema.optional(),
  characterReferences: z.array(CharacterReferenceSchema).optional(),
  plotOutline: PlotOutlineSchema.optional(),
  sceneBible: SceneBibleSchema.optional(),
  storyboard: StoryPackageSchema.optional(),
  generatedAssets: z.object({
    outputDir: z.string(),
    shots: StoryPackageSchema.shape.shots
  }).optional(),
  editResult: z.object({ outputPath: z.string() }).optional(),
  reviewResult: ReviewResultSchema.optional(),
  nextAction: NextActionSchema.optional(),
  revisionCount: z.record(z.string(), z.number().int().nonnegative()).default({}),
  usageBudget: UsageBudgetSchema,
  humanFeedback: z.string().optional(),
  errors: z.array(WorkflowErrorSchema).default([])
})
export type WorkflowState = z.infer<typeof WorkflowStateSchema>

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_step_review',
  'waiting_character_approval',
  'waiting_storyboard_approval',
  'waiting_budget_approval',
  'waiting_human_review',
  'cancel_requested',
  'cancelled',
  'completed',
  'failed'
])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const StartRunInputSchema = z.object({
  episodeId: z.string().optional(),
  productionConfig: ProductionConfigSchema.partial().optional(),
  budget: UsageBudgetSchema.pick({ maxTokens: true, maxCost: true }).partial().optional()
})
export type StartRunInput = z.infer<typeof StartRunInputSchema>

export const ResumeRunInputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  storyboard: StoryPackageSchema.optional(),
  additionalTokens: z.coerce.number().int().positive().optional(),
  additionalCost: z.coerce.number().positive().optional()
})
export type ResumeRunInput = z.infer<typeof ResumeRunInputSchema>

export const WorkflowRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  episodeId: z.string().nullable(),
  threadId: z.string(),
  status: RunStatusSchema,
  currentNode: z.string().nullable(),
  state: WorkflowStateSchema.nullable(),
  interrupt: z.record(z.string(), z.unknown()).nullable(),
  budget: UsageBudgetSchema,
  cancelRequested: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable()
})
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>

export const ArtifactVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  runId: z.string(),
  kind: z.string(),
  ownerId: z.string().nullable(),
  version: z.number().int().positive(),
  status: z.enum(['current', 'stale', 'history']),
  inputHash: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  filePath: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()])
})
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>

export const EpisodeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  state: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Episode = z.infer<typeof EpisodeSchema>
