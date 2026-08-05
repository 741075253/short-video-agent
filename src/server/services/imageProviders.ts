import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { imageGenConfig } from '../config'
import type { Shot } from '../../shared/schema'

type ImageProviderConfig = typeof imageGenConfig & {
  adapter?: 'dashscope-image' | 'openai-image'
}

export interface ImageProvider {
  readonly name: string
  generateImage(shot: Shot, outputDir: string, refImageUrl?: string): Promise<string>
  generateImages?(shots: Shot[], outputDir: string): Promise<string[]>
}

// ========== 通用 ImageProvider（自动适配 OpenAI 兼容 / DashScope 原生） ==========

class UniversalImageProvider implements ImageProvider {
  readonly name = 'image-gen'

  /** 最近一次生图的 OSS URL（DashScope 模式），用于下一帧参考 */
  lastImageUrl: string | null = null

  constructor(private readonly config: ImageProviderConfig) {}

  private promptForShot(shot: Shot): string {
    return `${shot.prompt || shot.visual}, continuous sequence, consistent characters and background, cohesive visual storytelling`
  }

  async generateImages(shots: Shot[], outputDir: string): Promise<string[]> {
    if (!this.config.apiKey) {
      throw new Error('未配置图片生成 API Key，请在 .env 中设置 IMAGE_GEN_API_KEY')
    }
    if (shots.length === 0) return []

    await mkdir(outputDir, { recursive: true })
    if (this.isWan27) return this.generateWanImageSet(shots, outputDir)

    const paths: string[] = []
    let refImageUrl: string | undefined
    for (const shot of shots) {
      paths.push(await this.generateImage(shot, outputDir, refImageUrl))
      refImageUrl = this.lastImageUrl ?? undefined
    }
    return paths
  }

  async generateImage(shot: Shot, outputDir: string, refImageUrl?: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('未配置图片生成 API Key，请在 .env 中设置 IMAGE_GEN_API_KEY')
    }

    const prompt = this.promptForShot(shot)
    await mkdir(outputDir, { recursive: true })
    const destPath = join(outputDir, `${shot.id}.png`)

    if (this.isDashScope) {
      if (this.isWan27) return (await this.generateWanImageSet([shot], outputDir))[0]
      return this.generateDashScope(prompt, destPath, refImageUrl)
    }
    return this.generateOpenAI(prompt, destPath)
  }

  // ---- OpenAI 兼容 API ----

  private async generateOpenAI(prompt: string, destPath: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, prompt, n: 1, size: this.config.size }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`图片生成返回 ${response.status}: ${text.slice(0, 300)}`)
    }

    const { data } = (await response.json()) as {
      data: Array<{ url?: string; b64_json?: string }>
    }
    const item = data?.[0]
    if (!item) throw new Error('未返回图片数据')

    if (item.url) {
      await this.download(item.url, destPath)
    } else if (item.b64_json) {
      await writeFile(destPath, Buffer.from(item.b64_json, 'base64'))
    } else {
      throw new Error('返回数据既无 url 也无 b64_json')
    }
    return destPath
  }

  // ---- DashScope 原生 API ----

  private get isDashScope(): boolean {
    return this.config.adapter === 'dashscope-image'
      || /(?:dashscope|maas)\.aliyuncs\.com/.test(this.config.baseUrl)
  }

  private get isWan27(): boolean {
    return /^wan2\.7-image(?:-pro)?(?:-|$)/.test(this.config.model)
  }

  private async generateDashScope(prompt: string, destPath: string, refImageUrl?: string): Promise<string> {
    if (/^qwen-image-(?:2\.0|3\.0)/.test(this.config.model)) {
      return this.generateDashScopeMultimodal(prompt, destPath, refImageUrl)
    }
    return this.generateDashScopeLegacy(prompt, destPath)
  }

  private get dashScopeApiBase(): string {
    return `${new URL(this.config.baseUrl).origin}/api/v1`
  }

  private async generateWanImageSet(shots: Shot[], outputDir: string): Promise<string[]> {
    const sequencePrompt = [
      '生成同一部动画短剧的连续分镜组图。所有图片必须严格保持角色面部、发型、服装、身材比例、画风、场景结构、光线和色调一致，只改变每个镜头指定的动作与构图。',
      ...shots.map((shot, index) => `第${index + 1}张（镜头${shot.index}）：${this.promptForShot(shot)}`)
    ].join('\n')
    const apiUrl = `${this.dashScopeApiBase}/services/aigc/multimodal-generation/generation`
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        input: {
          messages: [{ role: 'user', content: [{ text: sequencePrompt }] }]
        },
        parameters: {
          enable_sequential: shots.length > 1,
          n: shots.length,
          size: this.config.size,
          watermark: false
        }
      })
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Wan 2.7 返回 ${res.status}: ${text.slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> }
      code?: string
      message?: string
    }
    if (body.code) throw new Error(`Wan 2.7 错误 ${body.code}: ${body.message || ''}`)

    const imageUrls = (body.output?.choices ?? [])
      .flatMap((choice) => choice.message?.content ?? [])
      .map((item) => item.image)
      .filter((url): url is string => Boolean(url))
    if (imageUrls.length !== shots.length) {
      throw new Error(`Wan 2.7 返回 ${imageUrls.length} 张图片，期望 ${shots.length} 张`)
    }

    const paths = shots.map((shot) => join(outputDir, `${shot.id}.png`))
    await Promise.all(imageUrls.map((url, index) => this.download(url, paths[index])))
    this.lastImageUrl = imageUrls.at(-1) ?? null
    return paths
  }

  private async generateDashScopeMultimodal(
    prompt: string,
    destPath: string,
    refImageUrl?: string
  ): Promise<string> {
    const content: Array<{ image: string } | { text: string }> = []
    if (refImageUrl) content.push({ image: refImageUrl })
    content.push({
      text: refImageUrl
        ? `以上一张图为连续性参考，严格保持角色外貌、服装、画风、场景结构和色调，只调整当前镜头的动作与构图。${prompt}`
        : prompt
    })

    const apiUrl = `${this.dashScopeApiBase}/services/aigc/multimodal-generation/generation`
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
        'X-DashScope-OssResourceResolve': 'enable'
      },
      body: JSON.stringify({
        model: this.config.model,
        input: { messages: [{ role: 'user', content }] },
        parameters: {
          size: this.config.size,
          n: 1,
          prompt_extend: false,
          watermark: false
        }
      })
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`DashScope 返回 ${res.status}: ${text.slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      output?: {
        choices?: Array<{ message?: { content?: Array<{ image?: string; url?: string }> } }>
        results?: Array<{ url?: string }>
      }
      code?: string
      message?: string
    }
    if (body.code) throw new Error(`DashScope 错误 ${body.code}: ${body.message || ''}`)

    const resultContent = body.output?.choices?.[0]?.message?.content ?? []
    const imageUrl = resultContent.find((item) => item.image || item.url)?.image
      ?? resultContent.find((item) => item.image || item.url)?.url
      ?? body.output?.results?.[0]?.url
    if (!imageUrl) throw new Error('DashScope 未返回图片 URL')

    this.lastImageUrl = imageUrl
    await this.download(imageUrl, destPath)
    return destPath
  }

  private async generateDashScopeLegacy(prompt: string, destPath: string): Promise<string> {
    const apiUrl = `${this.dashScopeApiBase}/services/aigc/text2image/image-synthesis`
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: this.config.model,
        input: { prompt },
        parameters: { size: this.config.size, n: 1 }
      })
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`DashScope 返回 ${res.status}: ${text.slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      output?: { task_id?: string }
      code?: string
      message?: string
    }
    if (body.code) throw new Error(`DashScope 错误 ${body.code}: ${body.message || ''}`)

    const taskId = body.output?.task_id
    if (!taskId) throw new Error('DashScope 未返回 task_id')

    const imageUrl = await this.pollTask(taskId)
    if (!imageUrl) throw new Error('DashScope 任务超时或失败')

    this.lastImageUrl = imageUrl
    await this.download(imageUrl, destPath)
    return destPath
  }

  private async pollTask(taskId: string): Promise<string | null> {
    const taskUrl = `${this.dashScopeApiBase}/tasks/${taskId}`
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const res = await fetch(taskUrl, {
        headers: { authorization: `Bearer ${this.config.apiKey}` },
      })
      if (!res.ok) continue
      const body = (await res.json()) as {
        output?: { task_status?: string; results?: Array<{ url: string }> }
      }
      const status = body.output?.task_status
      if (status === 'SUCCEEDED') return body.output?.results?.[0]?.url ?? null
      if (status === 'FAILED') return null
    }
    return null
  }

  // ---- 公共 ----

  private async download(url: string, destPath: string): Promise<void> {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载图片失败: ${resp.status}`)
    await writeFile(destPath, Buffer.from(await resp.arrayBuffer()))
  }
}

// ========== 工厂 ==========

export function createImageProvider(config: ImageProviderConfig = imageGenConfig): ImageProvider | null {
  if (!config.apiKey) return null
  return new UniversalImageProvider(config)
}
