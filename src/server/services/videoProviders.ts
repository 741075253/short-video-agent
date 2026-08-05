import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { videoOutputConfig, fontSearchPaths } from '../config'
import type { Shot, VideoGenerateInput, VideoGenerateResult, VideoProviderName } from '../../shared/schema'

export interface VideoProvider {
  name: VideoProviderName
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>
}

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm'])

function hasUsableImage(shot: Shot): boolean {
  return Boolean(
    shot.assetPath &&
    imageExtensions.has(extname(shot.assetPath).toLowerCase()) &&
    existsSync(shot.assetPath)
  )
}

function hasUsableClip(shot: Shot): boolean {
  return Boolean(
    shot.videoClipPath &&
    videoExtensions.has(extname(shot.videoClipPath).toLowerCase()) &&
    existsSync(shot.videoClipPath)
  )
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
    await Promise.all(
      updatedShots.map((shot) =>
        writeFile(
          shot.assetPath,
          JSON.stringify({ shotId: shot.id, prompt: shot.prompt, subtitle: shot.subtitle }, null, 2),
          'utf8'
        )
      )
    )
    const outputPath = join(this.outputDir, `mock-video-${input.project.id}.json`)
    await writeFile(
      outputPath,
      JSON.stringify({ projectId: input.project.id, shots: updatedShots }, null, 2),
      'utf8'
    )
    return { provider: 'mock', projectId: input.project.id, outputPath, updatedShots, errors: [] }
  }
}

export class LocalFfmpegProvider implements VideoProvider {
  name: VideoProviderName = 'local_ffmpeg'

  constructor(
    private readonly outputDir: string,
    private readonly ffmpegPath: string
  ) {}

  async generate(input: VideoGenerateInput): Promise<VideoGenerateResult> {
    await mkdir(this.outputDir, { recursive: true })
    const shots = targetShots(input)
    const useClips = shots.some((shot) => Boolean(shot.videoClipPath))
    const missingAsset = useClips
      ? shots.find((shot) => !hasUsableClip(shot))
      : shots.find((shot) => !hasUsableImage(shot))
    if (missingAsset) {
      const message = useClips
        ? `镜头 ${missingAsset.index} 缺少可用视频片段，已停止视频生成`
        : `镜头 ${missingAsset.index} 缺少可用图片素材，已停止视频生成`
      return {
        provider: 'local_ffmpeg',
        projectId: input.project.id,
        updatedShots: shots.map((shot) => ({ ...shot, status: 'failed' as const, errorMessage: message })),
        errors: [{ shotId: missingAsset.id, message }]
      }
    }

    const available = await this.isFfmpegAvailable()
    if (!available) {
      return {
        provider: 'local_ffmpeg',
        projectId: input.project.id,
        updatedShots: shots.map((shot) => ({
          ...shot,
          status: 'failed' as const,
          errorMessage: 'FFmpeg 不可用，请安装 FFmpeg 并配置 FFMPEG_PATH。'
        })),
        errors: shots.map((shot) => ({ shotId: shot.id, message: 'FFmpeg 不可用，请安装 FFmpeg 并配置 FFMPEG_PATH。' }))
      }
    }

    const outputPath = join(this.outputDir, `${input.project.id}.mp4`)
    try {
      if (useClips) {
        await this.renderVideoFromClips(shots.map((shot) => shot.videoClipPath!), shots, outputPath)
      } else {
        await this.renderVideo(shots, outputPath)
      }
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
        errorMessage: undefined
      })),
      errors: []
    }
  }

  private async renderVideo(shots: Shot[], outputPath: string): Promise<void> {
    const fontFile = this.resolveFont()
    const safeFont = fontFile?.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')

    // 每个镜头先生成视频片段（图片 + 文字叠加），再拼接
    const clipPaths: string[] = []

    for (const shot of shots) {
      const imagePath = shot.assetPath
      if (!imagePath || !hasUsableImage(shot)) {
        throw new Error(`镜头 ${shot.index} 缺少可用图片素材，已停止视频生成`)
      }
      const clipPath = join(this.outputDir, `${shot.id}-clip.mp4`)
      const duration = shot.durationSeconds

      const vfParts: string[] = [
        `scale=${videoOutputConfig.width}:${videoOutputConfig.height}:force_original_aspect_ratio=increase`,
        `crop=${videoOutputConfig.width}:${videoOutputConfig.height}`
      ]
      if (safeFont) {
        const sceneText = this.escapeDrawtext(shot.visual.slice(0, 40) || '……')
        const subtitleText = this.escapeDrawtext(shot.subtitle || '')
        const fadeIn = duration * 0.4
        vfParts.push(
          `drawtext=fontfile='${safeFont}':text='${sceneText}':fontcolor=white@0.9:fontsize=36:x=(w-text_w)/2:y=h*0.28-text_h/2:box=1:boxcolor=black@0.35:boxborderw=8:alpha='if(lt(t,${fadeIn}), t/${fadeIn}, 1)'`
        )
        if (subtitleText.trim()) {
          vfParts.push(
            `drawtext=fontfile='${safeFont}':text='${subtitleText}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.5:boxborderw=8`
          )
        }
      }

      const clipArgs: string[] = ['-loop', '1', '-i', imagePath, '-t', String(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', String(videoOutputConfig.crf), '-pix_fmt', 'yuv420p', '-r', String(videoOutputConfig.fps)]
      if (vfParts.length > 0) {
        clipArgs.push('-vf', vfParts.join(','))
      }
      clipArgs.push('-an', '-y', clipPath)

      await this.spawnFfmpeg(clipArgs)
      clipPaths.push(clipPath)
    }

    // 拼接所有片段
    const concatList = join(this.outputDir, 'concat.txt')
    const concatLines = clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    await writeFile(concatList, concatLines.join('\n'), 'utf8')

    await this.spawnFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c', 'copy', '-y',
      outputPath
    ])
  }

  async renderVideoFromClips(clipPaths: string[], shots: Shot[], outputPath: string): Promise<void> {
    if (clipPaths.length !== shots.length) {
      throw new Error(`视频片段数量 ${clipPaths.length} 与镜头数量 ${shots.length} 不一致`)
    }

    const fontFile = this.resolveFont()
    const safeFont = fontFile?.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')
    const captionedPaths: string[] = []

    for (let index = 0; index < shots.length; index++) {
      const shot = shots[index]
      const clipPath = clipPaths[index]
      const captionedPath = join(this.outputDir, `${shot.id}-captioned.mp4`)
      const args = ['-i', clipPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(videoOutputConfig.crf), '-pix_fmt', 'yuv420p', '-r', String(videoOutputConfig.fps)]
      const subtitleText = this.escapeDrawtext(shot.subtitle || '')
      const videoFilters = [
        `scale=${videoOutputConfig.width}:${videoOutputConfig.height}:force_original_aspect_ratio=increase`,
        `crop=${videoOutputConfig.width}:${videoOutputConfig.height}`
      ]
      if (safeFont && subtitleText.trim()) {
        videoFilters.push(`drawtext=fontfile='${safeFont}':text='${subtitleText}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.5:boxborderw=8`)
      }
      args.push('-vf', videoFilters.join(','), '-an', '-y', captionedPath)
      await this.spawnFfmpeg(args)
      captionedPaths.push(captionedPath)
    }

    const concatList = join(this.outputDir, 'concat-clips.txt')
    const concatLines = captionedPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
    await writeFile(concatList, concatLines.join('\n'), 'utf8')
    await this.spawnFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(videoOutputConfig.crf),
      '-pix_fmt', 'yuv420p', '-r', String(videoOutputConfig.fps), '-an', '-y', outputPath
    ])
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
    for (const path of fontSearchPaths) {
      try {
        if (statSync(path).isFile()) return path
      } catch { /* skip */ }
    }
    return null
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
  ffmpegPath: string
): VideoProvider {
  if (name === 'mock') return new MockProvider(outputDir)
  return new LocalFfmpegProvider(outputDir, ffmpegPath)
}
