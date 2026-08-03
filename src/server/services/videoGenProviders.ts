import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { happyHorseConfig, klingConfig } from '../config'
import type {
  ClipFailure,
  ClipGenerationResult,
  ClipResult,
  HappyHorseConfig,
  HappyHorseModel,
  KlingConfig,
  Shot,
  VideoGenerationOptions,
  VideoGenerationProviderName
} from '../../shared/schema'
import { defaultVideoGenerationOptions } from '../../shared/schema'

export interface VideoGenProvider {
  readonly name: VideoGenerationProviderName
  readonly model: string
  generateClips(
    shots: Shot[],
    imageUrls: string[],
    outputDir: string,
    options?: VideoGenerationOptions
  ): Promise<ClipGenerationResult>
}

interface SubmittedTask {
  shot: Shot
  taskId: string
}

interface TaskStatus {
  status: 'pending' | 'succeeded' | 'failed'
  videoUrl?: string
  message?: string
}

interface KlingResponse<T> {
  code?: number
  message?: string
  data?: T
}

async function imageInput(source: string): Promise<string> {
  if (/^https?:/i.test(source)) return source
  if (/^data:/i.test(source)) return source.replace(/^data:[^;]+;base64,/i, '')
  const content = await readFile(source)
  return content.toString('base64')
}

async function happyHorseImageInput(source: string): Promise<string> {
  if (/^(?:https?:|data:)/i.test(source)) return source
  const extension = source.toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1] ?? 'png'
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
  const content = await readFile(source)
  return `data:${mime};base64,${content.toString('base64')}`
}

export class KlingProvider implements VideoGenProvider {
  readonly name = 'kling' as const
  readonly model: string

  constructor(private readonly config: KlingConfig = klingConfig) {
    this.model = config.model
  }

  async generateClips(
    shots: Shot[],
    imageUrls: string[],
    outputDir: string,
    options: VideoGenerationOptions = defaultVideoGenerationOptions
  ): Promise<ClipGenerationResult> {
    if (shots.length === 0) return { success: true, clips: [] }
    if (!this.config.apiKey) {
      return this.failureForAll(shots, '未配置 Kling API Key，请设置 KLING_API_KEY')
    }
    if (shots.length !== imageUrls.length) {
      return this.failureForAll(shots, `Kling 输入图片数量 ${imageUrls.length} 与镜头数量 ${shots.length} 不一致`)
    }

    await mkdir(outputDir, { recursive: true })
    const submitted: SubmittedTask[] = []
    const submissionFailures: ClipFailure[] = []

    for (let offset = 0; offset < shots.length; offset += this.config.concurrency) {
      const batch = shots.slice(offset, offset + this.config.concurrency)
      const results: Array<{ task: SubmittedTask } | { failure: ClipFailure }> = await Promise.all(batch.map(async (shot, index) => {
        try {
          const taskId = await this.submitTask(shot, imageUrls[offset + index], options)
          return { task: { shot, taskId } }
        } catch (error) {
          return { failure: { shotId: shot.id, message: this.errorMessage(error) } }
        }
      }))

      for (const result of results) {
        if ('task' in result) submitted.push(result.task)
        else submissionFailures.push(result.failure)
      }
    }

    const polled = await this.pollAndDownload(submitted, outputDir)
    if (submissionFailures.length === 0) return polled
    return polled.success
      ? { success: false, failures: submissionFailures, completed: polled.clips }
      : { success: false, failures: [...submissionFailures, ...polled.failures], completed: polled.completed }
  }

  private failureForAll(shots: Shot[], message: string): ClipGenerationResult {
    return {
      success: false,
      failures: shots.map((shot) => ({ shotId: shot.id, message })),
      completed: []
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers
      }
    })
    const text = await response.text()
    let body: KlingResponse<T>
    try {
      body = text ? JSON.parse(text) as KlingResponse<T> : {}
    } catch {
      throw new Error(`Kling 返回 ${response.status}: ${text.slice(0, 300)}`)
    }
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      throw new Error(`Kling 返回 ${response.status}: ${body.message || text.slice(0, 300)}`)
    }
    if (!body.data) throw new Error('Kling 未返回 data')
    return body.data
  }

  private async submitTask(
    shot: Shot,
    imageUrl: string,
    options: VideoGenerationOptions
  ): Promise<string> {
    const data = await this.request<{ task_id?: string; taskId?: string }>('/v1/videos/image2video', {
      method: 'POST',
      body: JSON.stringify({
        model_name: this.config.model,
        image: await imageInput(imageUrl),
        prompt: shot.videoPrompt || shot.prompt || shot.visual,
        duration: String(options.durationSeconds),
        mode: options.resolution === '1080p' ? 'pro' : 'std',
        sound: options.nativeAudio ? 'on' : 'off',
        multi_shot: false
      })
    })
    const taskId = data.task_id ?? data.taskId
    if (!taskId) throw new Error('Kling 未返回 task_id')
    return taskId
  }

  private async queryTask(taskId: string): Promise<TaskStatus> {
    const data = await this.request<{
      task_status?: string
      status?: string
      task_status_msg?: string
      message?: string
      task_result?: { videos?: Array<{ url?: string }> }
      videos?: Array<{ url?: string }>
      video_url?: string
    }>(`/v1/videos/image2video/${taskId}`)
    const rawStatus = (data.task_status ?? data.status ?? '').toLowerCase()
    const message = data.task_status_msg ?? data.message
    if (['failed', 'failure', 'error'].includes(rawStatus)) return { status: 'failed', message }
    if (['succeed', 'succeeded', 'success', 'completed'].includes(rawStatus)) {
      const videoUrl = data.task_result?.videos?.[0]?.url ?? data.videos?.[0]?.url ?? data.video_url
      if (!videoUrl) return { status: 'failed', message: 'Kling 任务成功但未返回视频 URL' }
      return { status: 'succeeded', videoUrl }
    }
    return { status: 'pending' }
  }

  private async pollAndDownload(tasks: SubmittedTask[], outputDir: string): Promise<ClipGenerationResult> {
    const pending = new Map(tasks.map((task) => [task.taskId, task]))
    const completed: ClipResult[] = []
    const failures: ClipFailure[] = []

    for (let attempt = 0; attempt < this.config.pollMaxRetries && pending.size > 0; attempt++) {
      if (this.config.pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs))
      }
      const statuses = await Promise.all(Array.from(pending.values()).map(async (task) => {
        try {
          return { task, result: await this.queryTask(task.taskId) }
        } catch (error) {
          return { task, result: { status: 'failed', message: this.errorMessage(error) } as TaskStatus }
        }
      }))

      for (const { task, result } of statuses) {
        if (result.status === 'failed') {
          failures.push({ shotId: task.shot.id, message: result.message || 'Kling 视频生成失败，请调整 videoPrompt 后重试' })
          pending.delete(task.taskId)
          continue
        }
        if (result.status !== 'succeeded' || !result.videoUrl) continue
        try {
          const clipPath = join(outputDir, `${task.shot.id}-clip.mp4`)
          await this.download(result.videoUrl, clipPath)
          completed.push({ shotId: task.shot.id, clipPath })
          pending.delete(task.taskId)
        } catch (error) {
          failures.push({ shotId: task.shot.id, message: this.errorMessage(error) })
          pending.delete(task.taskId)
        }
      }

    }

    if (pending.size > 0) {
      failures.push(...Array.from(pending.values()).map(({ shot }) => ({
        shotId: shot.id,
        message: `Kling 任务轮询超时，请缩短或简化 videoPrompt 后重试`
      })))
    }

    const order = new Map(tasks.map((task, index) => [task.shot.id, index]))
    completed.sort((a, b) => (order.get(a.shotId) ?? 0) - (order.get(b.shotId) ?? 0))
    return failures.length > 0
      ? { success: false, failures, completed }
      : { success: true, clips: completed }
  }

  private async download(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`下载 Kling 视频失败: ${response.status}`)
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Kling 视频生成失败，请调整 videoPrompt 后重试'
  }
}

interface HappyHorseResponse<T> {
  output?: T
  code?: string
  message?: string
}

const happyHorseProviderNames: Record<HappyHorseModel, VideoGenerationProviderName> = {
  'happyhorse-1.1-i2v': 'happyhorse_i2v',
  'happyhorse-1.1-t2v': 'happyhorse_t2v',
  'happyhorse-1.1-r2v': 'happyhorse_r2v'
}

export class HappyHorseProvider implements VideoGenProvider {
  readonly name: VideoGenerationProviderName
  readonly model: HappyHorseModel

  constructor(private readonly config: HappyHorseConfig = happyHorseConfig) {
    this.model = config.model
    this.name = happyHorseProviderNames[config.model]
  }

  async generateClips(
    shots: Shot[],
    imageUrls: string[],
    outputDir: string,
    options: VideoGenerationOptions = defaultVideoGenerationOptions
  ): Promise<ClipGenerationResult> {
    if (shots.length === 0) return { success: true, clips: [] }
    if (!this.config.apiKey) {
      return this.failureForAll(shots, '未配置 Token Plan API Key，请设置 TOKEN_PLAN_API_KEY')
    }
    if (this.model !== 'happyhorse-1.1-t2v' && shots.length !== imageUrls.length) {
      return this.failureForAll(shots, `HappyHorse 输入图片数量 ${imageUrls.length} 与镜头数量 ${shots.length} 不一致`)
    }

    await mkdir(outputDir, { recursive: true })
    const submitted: SubmittedTask[] = []
    const submissionFailures: ClipFailure[] = []

    for (let offset = 0; offset < shots.length; offset += this.config.concurrency) {
      const batch = shots.slice(offset, offset + this.config.concurrency)
      const results: Array<{ task: SubmittedTask } | { failure: ClipFailure }> = await Promise.all(
        batch.map(async (shot, index) => {
          try {
            const taskId = await this.submitTask(shot, imageUrls[offset + index], options)
            return { task: { shot, taskId } }
          } catch (error) {
            return { failure: { shotId: shot.id, message: this.errorMessage(error) } }
          }
        })
      )
      for (const result of results) {
        if ('task' in result) submitted.push(result.task)
        else submissionFailures.push(result.failure)
      }
    }

    const polled = await this.pollAndDownload(submitted, outputDir)
    if (submissionFailures.length === 0) return polled
    return polled.success
      ? { success: false, failures: submissionFailures, completed: polled.clips }
      : { success: false, failures: [...submissionFailures, ...polled.failures], completed: polled.completed }
  }

  private failureForAll(shots: Shot[], message: string): ClipGenerationResult {
    return { success: false, failures: shots.map((shot) => ({ shotId: shot.id, message })), completed: [] }
  }

  private get apiBase(): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '')
    return baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers
      }
    })
    const text = await response.text()
    let body: HappyHorseResponse<T>
    try {
      body = text ? JSON.parse(text) as HappyHorseResponse<T> : {}
    } catch {
      throw new Error(`HappyHorse 返回 ${response.status}: ${text.slice(0, 300)}`)
    }
    if (!response.ok || body.code) {
      throw new Error(`HappyHorse 返回 ${response.status}: ${body.message || text.slice(0, 300)}`)
    }
    if (!body.output) throw new Error('HappyHorse 未返回 output')
    return body.output
  }

  private async submitTask(
    shot: Shot,
    imageUrl: string | undefined,
    options: VideoGenerationOptions
  ): Promise<string> {
    const prompt = shot.videoPrompt || shot.prompt || shot.visual
    const input: {
      prompt: string
      media?: Array<{ type: 'first_frame' | 'reference_image'; url: string }>
    } = { prompt }
    if (this.model !== 'happyhorse-1.1-t2v' && !imageUrl) {
      throw new Error('HappyHorse 图生视频缺少输入图片')
    }
    if (this.model === 'happyhorse-1.1-i2v') {
      input.media = [{ type: 'first_frame', url: await happyHorseImageInput(imageUrl!) }]
    } else if (this.model === 'happyhorse-1.1-r2v') {
      input.prompt = `[Image 1] 是当前镜头的角色与场景参考。${prompt}`
      input.media = [{ type: 'reference_image', url: await happyHorseImageInput(imageUrl!) }]
    }

    const parameters: Record<string, string | number | boolean> = {
      resolution: options.resolution.toUpperCase(),
      duration: options.durationSeconds,
      watermark: false
    }
    if (this.model !== 'happyhorse-1.1-i2v') parameters.ratio = '9:16'

    const output = await this.request<{ task_id?: string }>(
      '/services/aigc/video-generation/video-synthesis',
      {
        method: 'POST',
        headers: { 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: this.model, input, parameters })
      }
    )
    if (!output.task_id) throw new Error('HappyHorse 未返回 task_id')
    return output.task_id
  }

  private async queryTask(taskId: string): Promise<TaskStatus> {
    const output = await this.request<{
      task_status?: string
      message?: string
      video_url?: string
    }>(`/tasks/${taskId}`)
    const status = (output.task_status ?? '').toUpperCase()
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) {
      return { status: 'failed', message: output.message }
    }
    if (status === 'SUCCEEDED') {
      return output.video_url
        ? { status: 'succeeded', videoUrl: output.video_url }
        : { status: 'failed', message: 'HappyHorse 任务成功但未返回视频 URL' }
    }
    return { status: 'pending' }
  }

  private async pollAndDownload(tasks: SubmittedTask[], outputDir: string): Promise<ClipGenerationResult> {
    const pending = new Map(tasks.map((task) => [task.taskId, task]))
    const completed: ClipResult[] = []
    const failures: ClipFailure[] = []

    for (let attempt = 0; attempt < this.config.pollMaxRetries && pending.size > 0; attempt++) {
      if (this.config.pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs))
      }
      const statuses = await Promise.all(Array.from(pending.values()).map(async (task) => {
        try {
          return { task, result: await this.queryTask(task.taskId) }
        } catch (error) {
          return { task, result: { status: 'failed', message: this.errorMessage(error) } as TaskStatus }
        }
      }))

      for (const { task, result } of statuses) {
        if (result.status === 'failed') {
          failures.push({ shotId: task.shot.id, message: result.message || 'HappyHorse 视频生成失败' })
          pending.delete(task.taskId)
          continue
        }
        if (result.status !== 'succeeded' || !result.videoUrl) continue
        try {
          const clipPath = join(outputDir, `${task.shot.id}-clip.mp4`)
          await this.download(result.videoUrl, clipPath)
          completed.push({ shotId: task.shot.id, clipPath })
          pending.delete(task.taskId)
        } catch (error) {
          failures.push({ shotId: task.shot.id, message: this.errorMessage(error) })
          pending.delete(task.taskId)
        }
      }
    }

    failures.push(...Array.from(pending.values()).map(({ shot }) => ({
      shotId: shot.id,
      message: 'HappyHorse 任务轮询超时，请稍后重试'
    })))
    const order = new Map(tasks.map((task, index) => [task.shot.id, index]))
    completed.sort((a, b) => (order.get(a.shotId) ?? 0) - (order.get(b.shotId) ?? 0))
    return failures.length > 0
      ? { success: false, failures, completed }
      : { success: true, clips: completed }
  }

  private async download(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`下载 HappyHorse 视频失败: ${response.status}`)
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'HappyHorse 视频生成失败'
  }
}

export class MockVideoGenProvider implements VideoGenProvider {
  readonly name = 'mock' as const
  readonly model = 'mock'

  async generateClips(shots: Shot[], _imageUrls: string[], outputDir: string): Promise<ClipGenerationResult> {
    await mkdir(outputDir, { recursive: true })
    const clips = await Promise.all(shots.map(async (shot) => {
      const clipPath = join(outputDir, `${shot.id}-clip.mp4`)
      await writeFile(clipPath, Buffer.alloc(0))
      return { shotId: shot.id, clipPath }
    }))
    return { success: true, clips }
  }
}

export function createVideoGenProvider(
  name: VideoGenerationProviderName,
  config: KlingConfig = klingConfig
): VideoGenProvider {
  const factories: Partial<Record<VideoGenerationProviderName, () => VideoGenProvider>> = {
    kling: () => new KlingProvider(config),
    happyhorse_i2v: () => new HappyHorseProvider({ ...happyHorseConfig, model: 'happyhorse-1.1-i2v' }),
    happyhorse_t2v: () => new HappyHorseProvider({ ...happyHorseConfig, model: 'happyhorse-1.1-t2v' }),
    happyhorse_r2v: () => new HappyHorseProvider({ ...happyHorseConfig, model: 'happyhorse-1.1-r2v' }),
    mock: () => new MockVideoGenProvider()
  }
  const factory = factories[name]
  if (!factory) throw new Error(`视频 Provider ${name} 不支持 AI 图生视频`)
  return factory()
}
