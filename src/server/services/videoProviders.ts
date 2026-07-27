import { mkdir, writeFile } from 'node:fs/promises'
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
    await writeFile(join(this.outputDir, `${input.project.id}.ffmpeg-plan.txt`), `output=${outputPath}`, 'utf8')
    return {
      provider: 'local_ffmpeg',
      projectId: input.project.id,
      outputPath,
      updatedShots: shots.map((shot) => ({ ...shot, status: 'ready' as const, assetPath: outputPath, errorMessage: undefined })),
      errors: []
    }
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
