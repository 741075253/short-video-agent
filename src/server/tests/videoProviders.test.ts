import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoProvider, LocalFfmpegProvider } from '../services/videoProviders'
import type { Project } from '../../shared/schema'

let dir: string | undefined

const project: Project = {
  id: 'project-1',
  name: '测试项目',
  sourceText: '少年推开门，看见城市燃烧。',
  style: 'animation_drama',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  storyPackage: {
    summary: '少年看见城市燃烧。',
    characters: [],
    scenes: [],
    shots: [
      {
        id: 'shot-1',
        index: 1,
        durationSeconds: 5,
        sceneId: 'scene-1',
        characterIds: [],
        visual: '少年站在门前',
        action: '抬头',
        narration: '城市燃烧了。',
        subtitle: '城市燃烧了。',
        camera: '推近',
        prompt: 'animation drama style',
        status: 'pending'
      }
    ]
  }
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('videoProviders', () => {
  it('mock provider marks shots as ready and writes a manifest', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-'))
    const provider = createVideoProvider('mock', dir, 'ffmpeg')

    const result = await provider.generate({ project, provider: 'mock' })

    expect(result.errors).toEqual([])
    expect(result.updatedShots[0].status).toBe('ready')
    expect(result.outputPath).toContain('mock-video-project-1.json')
    expect(await readFile(result.updatedShots[0].assetPath!, 'utf8')).toContain('shot-1')
    const manifest = JSON.parse(await readFile(result.outputPath!, 'utf8'))
    expect(manifest.shots[0].subtitle).toBe('城市燃烧了。')
  })

  it('local ffmpeg provider fails clearly when ffmpeg path is unavailable', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-'))
    const provider = createVideoProvider('local_ffmpeg', dir, 'missing-ffmpeg-binary')
    const imagePath = join(dir, 'shot-1.png')
    await writeFile(imagePath, 'image')
    const projectWithImage: Project = {
      ...project,
      storyPackage: {
        ...project.storyPackage!,
        shots: project.storyPackage!.shots.map((shot) => ({ ...shot, assetPath: imagePath }))
      }
    }

    const result = await provider.generate({ project: projectWithImage, provider: 'local_ffmpeg' })

    expect(result.updatedShots[0].status).toBe('failed')
    expect(result.errors[0].message).toContain('FFmpeg 不可用')
  })

  it('fails instead of falling back to a solid background when an image is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-'))
    const provider = createVideoProvider('local_ffmpeg', dir, process.execPath)

    const result = await provider.generate({ project, provider: 'local_ffmpeg' })

    expect(result.updatedShots[0].status).toBe('failed')
    expect(result.errors[0].message).toContain('缺少可用图片素材')
  })

  it('renders existing video clips without the static image loop or scale filter', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-'))
    const clipPath = join(dir, 'shot-1-clip.mp4')
    await writeFile(clipPath, 'video')
    const projectWithClip: Project = {
      ...project,
      storyPackage: {
        ...project.storyPackage!,
        shots: project.storyPackage!.shots.map((shot) => ({ ...shot, videoClipPath: clipPath }))
      }
    }
    const provider = new LocalFfmpegProvider(dir, 'ffmpeg')
    const internals = provider as unknown as {
      isFfmpegAvailable(): Promise<boolean>
      spawnFfmpeg(args: string[]): Promise<void>
    }
    vi.spyOn(internals, 'isFfmpegAvailable').mockResolvedValue(true)
    const spawnFfmpeg = vi.spyOn(internals, 'spawnFfmpeg').mockResolvedValue()

    const result = await provider.generate({ project: projectWithClip, provider: 'local_ffmpeg' })

    expect(result.errors).toEqual([])
    expect(spawnFfmpeg).toHaveBeenCalledTimes(2)
    const firstArgs = spawnFfmpeg.mock.calls[0][0]
    const concatArgs = spawnFfmpeg.mock.calls[1][0]
    expect(firstArgs).not.toContain('-loop')
    expect(firstArgs.join(' ')).not.toContain('scale=')
    expect(concatArgs).toEqual(expect.arrayContaining(['-f', 'concat', '-c:v', 'libx264']))
  })
})
