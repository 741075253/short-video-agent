import { mkdir, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Shot, VideoGenerateInput, VideoGenerateResult, VideoProviderName } from '../../shared/schema'

export interface VideoProvider {
  name: VideoProviderName
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>
}

function targetShots(input: VideoGenerateInput): Shot[] {
  const shots = input.project.storyPackage?.shots ?? []
  if (!input.shotId) return shots
  return shots.filter((shot) => shot.id === input.shotId)
}

class MockProvider implements VideoProvider {
  name: VideoProviderName = 'mock'

  constructor(private readonly outputDir: string) {}

  async generate(input: VideoGenerateInput): Promise<VideoGenerateResult> {
    await mkdir(this.outputDir, { recursive: true })
    const updatedShots = targetShots(input).map((shot) => ({
      ...shot,
      status: 'ready' as const,
      assetPath: join(this.outputDir, `${shot.id}.mock.txt`),
      errorMessage: undefined
    }))
    const outputPath = join(this.outputDir, `mock-video-${input.project.id}.json`)
    await writeFile(
      outputPath,
      JSON.stringify({ projectId: input.project.id, shots: updatedShots }, null, 2),
      'utf8'
    )
    return { provider: 'mock', projectId: input.project.id, outputPath, updatedShots, errors: [] }
  }
}

class LocalFfmpegProvider implements VideoProvider {
  name: VideoProviderName = 'local_ffmpeg'

  constructor(
    private readonly outputDir: string,
    private readonly ffmpegPath: string
  ) {}

  async generate(input: VideoGenerateInput): Promise<VideoGenerateResult> {
    await mkdir(this.outputDir, { recursive: true })
    const shots = targetShots(input)
    const available = await this.isFfmpegAvailable()
    if (!available) {
      return {
        provider: 'local_ffmpeg',
        projectId: input.project.id,
        updatedShots: shots.map((shot) => ({
          ...shot,
          status: 'failed' as const,
          errorMessage: 'FFmpeg 不可用，请安装 FFmpeg 或切换 MockProvider。'
        })),
        errors: shots.map((shot) => ({ shotId: shot.id, message: 'FFmpeg 不可用，请安装 FFmpeg 或切换 MockProvider。' }))
      }
    }

    const outputPath = join(this.outputDir, `${input.project.id}.mp4`)
    try {
      await this.renderVideo(shots, outputPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FFmpeg 渲染失败'
      return {
        provider: 'local_ffmpeg',
        projectId: input.project.id,
        updatedShots: shots.map((shot) => ({
          ...shot,
          status: 'failed' as const,
          errorMessage: message
        })),
        errors: shots.map((shot) => ({ shotId: shot.id, message })),
        outputPath
      }
    }

    return {
      provider: 'local_ffmpeg',
      projectId: input.project.id,
      outputPath,
      updatedShots: shots.map((shot) => ({
        ...shot,
        status: 'ready' as const,
        assetPath: outputPath,
        errorMessage: undefined
      })),
      errors: []
    }
  }

  private async renderVideo(shots: Shot[], outputPath: string): Promise<void> {
    const fontFile = this.resolveFont()
    const w = 1080
    const h = 1920

    // 每个镜头生成彩色渐变背景
    const palette = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560', '#1a1a2e']
    const frames: string[] = []
    for (const shot of shots) {
      const color = palette[shot.index % palette.length]
      const bgPath = await this.createGradientFrame(shot, color, w, h)
      // 每帧重复引用两次以克服 concat 问题
      frames.push(`file '${bgPath.replace(/'/g, "'\\''")}'`)
      frames.push(`duration ${shot.durationSeconds}`)
    }
    const lastColor = palette[shots.length % palette.length]
    const lastPath = await this.createGradientFrame(shots[shots.length - 1], lastColor, w, h)
    frames.push(`file '${lastPath.replace(/'/g, "'\\''")}'`)

    const concatList = join(this.outputDir, 'concat.txt')
    await writeFile(concatList, frames.join('\n'), 'utf8')

    const args: string[] = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatList,
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '27',
      '-r', '24',
      '-y',
      outputPath
    ]

    // 叠加场景文字和字幕
    if (fontFile) {
      const overlays: string[] = []
      let offset = 0
      for (const shot of shots) {
        const t0 = offset
        const t1 = offset + shot.durationSeconds * 0.4  // 淡入
        const tEnd = offset + shot.durationSeconds
        offset = tEnd

        const safeFont = fontFile.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')
        const sceneText = this.escapeDrawtext(shot.visual.slice(0, 40) || '……')
        const subtitleText = this.escapeDrawtext(shot.subtitle || '')

        // 画面描述 — 中上区域
        overlays.push(
          `drawtext=fontfile='${safeFont}':text='${sceneText}':fontcolor=white@0.9:fontsize=36:x=(w-text_w)/2:y=h*0.28-text_h/2:box=1:boxcolor=black@0.35:boxborderw=8:enable='between(t,${t0},${tEnd})':alpha='if(lt(t,${t1}), (t-${t0})/${t1 - t0}, 1)'`
        )
        if (subtitleText.trim()) {
          // 字幕 — 底部
          overlays.push(
            `drawtext=fontfile='${safeFont}':text='${subtitleText}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.5:boxborderw=8:enable='between(t,${t0},${tEnd})'`
          )
        }
      }
      if (overlays.length > 0) {
        args.splice(6, 0, '-vf', overlays.join(','))
      }
    }

    await this.spawnFfmpeg(args)
  }

  private escapeDrawtext(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''")
      .replace(/:/g, '\\:')
      .replace(/{/g, '\\{').replace(/}/g, '\\}')
      .replace(/\n/g, ' ')
      .replace(/%/g, '\\\\\\%')
  }

  private resolveFont(): string | null {
    const candidates = [
      'C:/Windows/Fonts/msyh.ttc',
      'C:/Windows/Fonts/simhei.ttf',
      'C:/Windows/Fonts/simsun.ttc',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    ]
    for (const path of candidates) {
      try {
        if (statSync(path).isFile()) return path
      } catch { /* skip */ }
    }
    return null
  }

  private async createGradientFrame(shot: Shot, color: string, w: number, h: number): Promise<string> {
    // 生成单帧彩色背景
    const path = join(this.outputDir, `${shot.id}-bg.png`)
    await this.spawnFfmpeg([
      '-f', 'lavfi',
      '-i', `color=${color}:size=${w}x${h}`,
      '-vframes', '1',
      '-y',
      path
    ])
    return path
  }

  private async spawnFfmpeg(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', (error) => reject(error))
      child.on('exit', (code) => {
        if (code === 0) return resolve()
        const errText = (stderr + stdout).slice(-800) || `FFmpeg 退出码 ${code}`
        reject(new Error(errText))
      })
    })
  }

  private async isFfmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.ffmpegPath, ['-version'], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('exit', (code) => resolve(code === 0))
    })
  }
}

export function createVideoProvider(
  name: VideoProviderName,
  outputDir: string,
  ffmpegPath = 'ffmpeg'
): VideoProvider {
  if (name === 'mock') return new MockProvider(outputDir)
  return new LocalFfmpegProvider(outputDir, ffmpegPath)
}
