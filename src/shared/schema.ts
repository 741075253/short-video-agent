import { z } from 'zod'

export const VideoStyleSchema = z.enum(['animation_drama'])
export type VideoStyle = z.infer<typeof VideoStyleSchema>

export const ShotStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed'])
export type ShotStatus = z.infer<typeof ShotStatusSchema>

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  appearance: z.string()
})
export type Character = z.infer<typeof CharacterSchema>

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string()
})
export type Scene = z.infer<typeof SceneSchema>

export const ShotSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  durationSeconds: z.number().int().min(3).max(12),
  sceneId: z.string(),
  characterIds: z.array(z.string()),
  visual: z.string(),
  action: z.string(),
  narration: z.string(),
  subtitle: z.string(),
  camera: z.string(),
  prompt: z.string(),
  status: ShotStatusSchema,
  assetPath: z.string().optional(),
  errorMessage: z.string().optional()
})
export type Shot = z.infer<typeof ShotSchema>

export const StoryPackageSchema = z.object({
  summary: z.string(),
  characters: z.array(CharacterSchema),
  scenes: z.array(SceneSchema),
  shots: z.array(ShotSchema)
})
export type StoryPackage = z.infer<typeof StoryPackageSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceText: z.string(),
  style: VideoStyleSchema,
  storyPackage: StoryPackageSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Project = z.infer<typeof ProjectSchema>

export const GenerateStoryInputSchema = z.object({
  sourceText: z.string().min(10),
  style: VideoStyleSchema.default('animation_drama')
})
export type GenerateStoryInput = z.infer<typeof GenerateStoryInputSchema>

export const VideoProviderNameSchema = z.enum(['mock', 'local_ffmpeg'])
export type VideoProviderName = z.infer<typeof VideoProviderNameSchema>

export const VideoGenerateInputSchema = z.object({
  project: ProjectSchema,
  provider: VideoProviderNameSchema,
  shotId: z.string().optional()
})
export type VideoGenerateInput = z.infer<typeof VideoGenerateInputSchema>

export const VideoGenerateResultSchema = z.object({
  provider: VideoProviderNameSchema,
  projectId: z.string(),
  outputPath: z.string().optional(),
  updatedShots: z.array(ShotSchema),
  errors: z.array(z.object({ shotId: z.string(), message: z.string() }))
})
export type VideoGenerateResult = z.infer<typeof VideoGenerateResultSchema>
