import '../config'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  VideoResolutionSchema,
  type ModelCatalogResponse,
  type ProductionConfig,
  type VideoProviderCapabilities
} from '../../shared/schema'

const BaseModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  baseUrlEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  baseUrl: z.string().url(),
  basePath: z.string().startsWith('/').optional().default(''),
  model: z.string().min(1)
})

const TextModelSchema = BaseModelSchema.extend({
  adapter: z.enum(['openai-compatible'])
})

const ImageModelSchema = BaseModelSchema.extend({
  adapter: z.enum(['dashscope-image', 'openai-image']),
  size: z.string().min(1).default('1024x1792')
})

const VideoCapabilitiesSchema = z.object({
  duration: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    default: z.number().int().positive()
  }).optional(),
  resolutions: z.array(VideoResolutionSchema).optional(),
  defaultResolution: VideoResolutionSchema.optional(),
  nativeAudio: z.boolean(),
  aiVideo: z.boolean(),
  imageToVideo: z.boolean(),
  staticFallback: z.boolean()
})

const VideoModelSchema = BaseModelSchema.extend({
  adapter: z.enum(['dashscope-video', 'kling-video']),
  inputMode: z.enum(['t2v', 'i2v', 'r2v']),
  capabilities: VideoCapabilitiesSchema
})

const CatalogSchema = z.object({
  defaults: z.object({
    text: z.string().min(1),
    image: z.string().min(1),
    video: z.string().min(1)
  }),
  text: z.array(TextModelSchema).min(1),
  image: z.array(ImageModelSchema).min(1),
  video: z.array(VideoModelSchema).min(1)
})

type Catalog = z.infer<typeof CatalogSchema>
type TextEntry = Catalog['text'][number]
type ImageEntry = Catalog['image'][number]
type VideoEntry = Catalog['video'][number]

export type ResolvedModel<T> = T & {
  apiKey: string
  baseUrl: string
}

const configuredPath = process.env.MODEL_CATALOG_PATH || 'config/model-catalog.json'
const catalogPath = isAbsolute(configuredPath) ? configuredPath : join(process.cwd(), configuredPath)
const catalog = CatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf8')))

function assertUniqueIds(entries: Array<{ id: string }>, kind: string): void {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`${kind}模型 ID 重复：${entry.id}`)
    ids.add(entry.id)
  }
}

function validateCatalog(): void {
  assertUniqueIds(catalog.text, '文本')
  assertUniqueIds(catalog.image, '图片')
  assertUniqueIds(catalog.video, '视频')
  if (!catalog.text.some((entry) => entry.id === catalog.defaults.text)) throw new Error('默认文本模型不存在')
  if (!catalog.image.some((entry) => entry.id === catalog.defaults.image)) throw new Error('默认图片模型不存在')
  if (!catalog.video.some((entry) => entry.id === catalog.defaults.video)) throw new Error('默认视频模型不存在')
}

validateCatalog()

function resolve<T extends TextEntry | ImageEntry | VideoEntry>(entry: T): ResolvedModel<T> {
  const configuredBaseUrl = entry.baseUrlEnv ? process.env[entry.baseUrlEnv] : undefined
  const modelBaseUrl = (configuredBaseUrl?.trim() || entry.baseUrl).replace(/\/$/, '')
  return {
    ...entry,
    apiKey: process.env[entry.apiKeyEnv]?.trim() ?? '',
    baseUrl: `${modelBaseUrl}${entry.basePath}`
  }
}

function findById<T extends { id: string }>(entries: T[], id: string, kind: string): T {
  const entry = entries.find((item) => item.id === id)
  if (!entry) throw new Error(`未配置${kind}模型：${id}`)
  return entry
}

export function resolveTextModel(id: string): ResolvedModel<TextEntry> {
  return resolve(findById(catalog.text, id, '文本'))
}

export function resolveImageModel(id: string): ResolvedModel<ImageEntry> {
  return resolve(findById(catalog.image, id, '图片'))
}

export function resolveVideoModel(id: string): ResolvedModel<VideoEntry> {
  return resolve(findById(catalog.video, id, '视频'))
}

export function getDefaultModelSelection(): Pick<ProductionConfig, 'textModel' | 'imageModel' | 'videoProvider'> {
  return {
    textModel: catalog.defaults.text,
    imageModel: catalog.defaults.image,
    videoProvider: catalog.defaults.video
  }
}

export function listModelCatalog(): ModelCatalogResponse {
  return {
    defaults: getDefaultModelSelection(),
    text: catalog.text.map(({ id, label, adapter, model }) => ({ id, label, adapter, model })),
    image: catalog.image.map(({ id, label, adapter, model }) => ({ id, label, adapter, model })),
    video: catalog.video.map(({ id, label, adapter, model, capabilities }) => ({
      id,
      label,
      adapter,
      model,
      capabilities: capabilities as VideoProviderCapabilities
    }))
  }
}
