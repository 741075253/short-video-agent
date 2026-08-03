import { z } from 'zod'

export const VideoStyleSchema = z.enum(['animation_drama'])
export type VideoStyle = z.infer<typeof VideoStyleSchema>

export const ShotStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed'])
export type ShotStatus = z.infer<typeof ShotStatusSchema>

export const VideoResolutionSchema = z.enum(['720p', '1080p'])
export type VideoResolution = z.infer<typeof VideoResolutionSchema>

export const VideoGenerationOptionsSchema = z.object({
  durationSeconds: z.coerce.number().int().min(3).max(15),
  resolution: VideoResolutionSchema,
  nativeAudio: z.boolean()
})
export type VideoGenerationOptions = z.infer<typeof VideoGenerationOptionsSchema>

export const defaultVideoGenerationOptions: VideoGenerationOptions = {
  durationSeconds: 5,
  resolution: '1080p',
  nativeAudio: false
}

export const VideoClipMetadataSchema = z.object({
  provider: z.string(),
  model: z.string(),
  durationSeconds: z.number().int().min(3).max(15),
  resolution: VideoResolutionSchema,
  nativeAudio: z.boolean(),
  promptHash: z.string(),
  imageHash: z.string(),
  generatedAt: z.string()
})
export type VideoClipMetadata = z.infer<typeof VideoClipMetadataSchema>

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
  videoPrompt: z.string().optional(),
  videoPromptSource: z.enum(['generated', 'manual']).optional(),
  videoClipPath: z.string().optional(),
  videoClipMetadata: VideoClipMetadataSchema.optional(),
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

export const TextGenerationModelSchema = z.enum([
  'qwen3.8-max-preview',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-flash',
  'qwen3.8-max',
  'deepseek-v4-flash-0731',
  'deepseek-v4-pro',
  'glm-5.2'
])
export type TextGenerationModel = z.infer<typeof TextGenerationModelSchema>

export const ImageGenerationModelSchema = z.enum(['wan2.7-image', 'wan2.7-image-pro'])
export type ImageGenerationModel = z.infer<typeof ImageGenerationModelSchema>

export const HappyHorseModelSchema = z.enum([
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-t2v',
  'happyhorse-1.1-r2v'
])
export type HappyHorseModel = z.infer<typeof HappyHorseModelSchema>

export const modelCatalog = {
  text: TextGenerationModelSchema.options,
  image: ImageGenerationModelSchema.options,
  tts: ['qwen-audio-3.0-tts-plus'] as const
}

export const VideoProviderNameSchema = z.enum(['mock', 'local_ffmpeg'])
export type VideoProviderName = z.infer<typeof VideoProviderNameSchema>

export const VideoGenerationProviderNameSchema = z.enum([
  'mock',
  'local_ffmpeg',
  'kling',
  'happyhorse_i2v',
  'happyhorse_t2v',
  'happyhorse_r2v'
])
export type VideoGenerationProviderName = z.infer<typeof VideoGenerationProviderNameSchema>

export type VideoProviderCapabilities = {
  duration?: { min: number; max: number; default: number }
  resolutions?: VideoResolution[]
  defaultResolution?: VideoResolution
  nativeAudio: boolean
  aiVideo: boolean
  imageToVideo: boolean
  staticFallback: boolean
}

export type VideoProviderDescriptor = {
  id: VideoGenerationProviderName
  label: string
  capabilities: VideoProviderCapabilities
}

export const KlingConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  concurrency: z.coerce.number().int().positive(),
  pollIntervalMs: z.coerce.number().int().nonnegative(),
  pollMaxRetries: z.coerce.number().int().positive()
})
export type KlingConfig = z.infer<typeof KlingConfigSchema>

export const HappyHorseConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().url(),
  model: HappyHorseModelSchema,
  concurrency: z.coerce.number().int().positive(),
  pollIntervalMs: z.coerce.number().int().nonnegative(),
  pollMaxRetries: z.coerce.number().int().positive()
})
export type HappyHorseConfig = z.infer<typeof HappyHorseConfigSchema>

export const ClipResultSchema = z.object({
  shotId: z.string(),
  clipPath: z.string()
})
export type ClipResult = z.infer<typeof ClipResultSchema>

export const ClipFailureSchema = z.object({
  shotId: z.string(),
  message: z.string()
})
export type ClipFailure = z.infer<typeof ClipFailureSchema>

export type ClipGenerationResult =
  | { success: true; clips: ClipResult[] }
  | { success: false; failures: ClipFailure[]; completed: ClipResult[] }

export const VideoGenerateInputSchema = z.object({
  project: ProjectSchema,
  provider: VideoProviderNameSchema,
  shotId: z.string().optional()
})
export type VideoGenerateInput = z.infer<typeof VideoGenerateInputSchema>

export const VideoGenerateResultSchema = z.object({
  provider: VideoGenerationProviderNameSchema,
  projectId: z.string(),
  outputPath: z.string().optional(),
  updatedShots: z.array(ShotSchema),
  errors: z.array(z.object({ shotId: z.string(), message: z.string() })),
  completed: z.array(ClipResultSchema).optional(),
  failures: z.array(ClipFailureSchema).optional()
})
export type VideoGenerateResult = z.infer<typeof VideoGenerateResultSchema>
