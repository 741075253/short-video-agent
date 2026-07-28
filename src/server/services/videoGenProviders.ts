import { createHmac } from 'node:crypto'
import { extname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { klingConfig } from '../config'
import type {
  ClipFailure,
  ClipGenerationResult,
  ClipResult,
  KlingConfig,
  Shot,
  VideoGenProviderName
} from '../../shared/schema'

const KLING_API_BASE = 'https://api.kling.kuaishou.com'

export interface VideoGenProvider {
  readonly name: VideoGenProviderName
  generateClips(shots: Shot[], imageUrls: string[], outputDir: string): Promise<ClipGenerationResult>
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

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.bmp': return 'image/bmp'
    default: return 'image/png'
  }
}

async function imageInput(source: string): Promise<string> {
  if (/^(?:https?:|data:)/i.test(source)) return source
  const content = await readFile(source)
  return `data:${mimeTypeFor(source)};base64,${content.toString('base64')}`
}

export class KlingProvider implements VideoGenProvider {
  readonly name = 'kling' as const

  constructor(private readonly config: KlingConfig = klingConfig) {}

  async generateClips(
    shots: Shot[],
    imageUrls: string[],
    outputDir: string
  ): Promise<ClipGenerationResult> {
    if (shots.length === 0) return { success: true, clips: [] }
    if (!this.config.accessKey || !this.config.secretKey) {
      return this.failureForAll(shots, '未配置 Kling 凭据，请设置 KLING_ACCESS_KEY 和 KLING_SECRET_KEY')
    }
    if (shots.length !== imageUrls.length) {
      return this.failureForAll(shots, `Kling 输入图片数量 ${imageUrls.length} 与镜头数量 ${shots.length} 不一致`)
    }

    await mkdir(outputDir, { recursive: true })
    const submitted: SubmittedTask[] = []

    for (let offset = 0; offset < shots.length; offset += this.config.concurrency) {
      const batch = shots.slice(offset, offset + this.config.concurrency)
      const results: Array<{ task: SubmittedTask } | { failure: ClipFailure }> = await Promise.all(batch.map(async (shot, index) => {
        try {
          const taskId = await this.submitTask(shot, imageUrls[offset + index])
          return { task: { shot, taskId } }
        } catch (error) {
          return { failure: { shotId: shot.id, message: this.errorMessage(error) } }
        }
      }))

      const failures: ClipFailure[] = []
      for (const result of results) {
        if ('task' in result) submitted.push(result.task)
        else failures.push(result.failure)
      }
      if (failures.length > 0) {
        await this.cancelTasks(submitted)
        return { success: false, failures, completed: [] }
      }
    }

    return this.pollAndDownload(submitted, outputDir)
  }

  private failureForAll(shots: Shot[], message: string): ClipGenerationResult {
    return {
      success: false,
      failures: shots.map((shot) => ({ shotId: shot.id, message })),
      completed: []
    }
  }

  private jwt(): string {
    const now = Math.floor(Date.now() / 1000)
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64Url(JSON.stringify({ iss: this.config.accessKey, nbf: now - 5, exp: now + 300 }))
    const unsigned = `${header}.${payload}`
    const signature = createHmac('sha256', this.config.secretKey).update(unsigned).digest('base64url')
    return `${unsigned}.${signature}`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${KLING_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.jwt()}`,
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

  private async submitTask(shot: Shot, imageUrl: string): Promise<string> {
    const data = await this.request<{ task_id?: string; taskId?: string }>('/v1/videos/image2video', {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.model,
        image: await imageInput(imageUrl),
        prompt: shot.videoPrompt || shot.prompt || shot.visual,
        duration: String(this.config.duration),
        cfg_scale: this.config.cfgScale,
        mode: this.config.mode
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
    }>(`/v1/videos/${taskId}`)
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

      const failures: ClipFailure[] = []
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

      if (failures.length > 0) {
        await this.cancelTasks(Array.from(pending.values()))
        return { success: false, failures, completed }
      }
    }

    if (pending.size > 0) {
      const failures = Array.from(pending.values()).map(({ shot }) => ({
        shotId: shot.id,
        message: `Kling 任务轮询超时，请缩短或简化 videoPrompt 后重试`
      }))
      await this.cancelTasks(Array.from(pending.values()))
      return { success: false, failures, completed }
    }

    const order = new Map(tasks.map((task, index) => [task.shot.id, index]))
    completed.sort((a, b) => (order.get(a.shotId) ?? 0) - (order.get(b.shotId) ?? 0))
    return { success: true, clips: completed }
  }

  private async cancelTasks(tasks: SubmittedTask[]): Promise<void> {
    await Promise.all(tasks.map(async ({ taskId }) => {
      try {
        await this.request(`/v1/videos/${taskId}/cancel`, { method: 'POST' })
      } catch {
        // 取消为尽力操作，不覆盖原始生成失败信息。
      }
    }))
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

export class MockVideoGenProvider implements VideoGenProvider {
  readonly name = 'mock' as const

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
  name: VideoGenProviderName,
  config: KlingConfig = klingConfig
): VideoGenProvider {
  return name === 'kling' ? new KlingProvider(config) : new MockVideoGenProvider()
}
