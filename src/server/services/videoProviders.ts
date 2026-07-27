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

    const concatList = join(this.outputDir, 'concat.txt')
    const lines: string[] = []
    for (const shot of shots) {
      const bgPath = await this.createColorFrame(shot, '#1a1a2e')
      lines.push(`file '${bgPath.replace(/'/g, "'\\''")}'`)
      lines.push(`duration ${shot.durationSeconds}`)
    }
    const lastBg = await this.createColorFrame(shots[shots.length - 1], '#1a1a2e')
    lines.push(`file '${lastBg.replace(/'/g, "'\\''")}'`)
    await writeFile(concatList, lines.join('\n'), 'utf8')

    const args: string[] = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatList,
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-r', '24',
      '-y',
      outputPath
    ]

    if (fontFile) {
      // 内嵌字幕
      const subtitleLines: string[] = []
      let offset = 0
      for (const shot of shots) {
        const seconds = shot.durationSeconds
        const text = (shot.subtitle || '')
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "'\\''")
          .replace(/:/g, '\\:')
          .replace(/{/g, '\\{').replace(/}/g, '\\}')
        if (text.trim()) {
          subtitleLines.push(
            `drawtext=fontfile='${fontFile.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}':text='${text}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=h-120:box=1:boxcolor=black@0.5:boxborderw=8:enable='between(t,${offset},${offset + seconds})'`
          )
        }
        offset += seconds
      }
      if (subtitleLines.length > 0) {
        args.splice(6, 0, '-vf', subtitleLines.join(','))
      }
    }

    await this.spawnFfmpeg(args)
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

  private async createColorFrame(shot: Shot, color: string): Promise<string> {
    const path = join(this.outputDir, `${shot.id}-bg.png`)
    await this.spawnFfmpeg([
      '-f', 'lavfi',
      '-i', `color=${color}:size=1080x1920:d=${shot.durationSeconds}`,
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
