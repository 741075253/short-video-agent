import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KlingProvider, MockVideoGenProvider } from '../services/videoGenProviders'
import type { KlingConfig, Shot, VideoGenerationOptions } from '../../shared/schema'

let dir: string | undefined

const config: KlingConfig = {
  apiKey: 'api-key',
  baseUrl: 'https://api.test',
  model: 'kling-v3',
  concurrency: 3,
  pollIntervalMs: 0,
  pollMaxRetries: 2
}

const options: VideoGenerationOptions = {
  durationSeconds: 7,
  resolution: '720p',
  nativeAudio: true
}

const shots: Shot[] = [1, 2].map((index) => ({
  id: `shot-${index}`,
  index,
  durationSeconds: 5,
  sceneId: 'scene-1',
  characterIds: [],
  visual: `画面 ${index}`,
  action: `动作 ${index}`,
  narration: '',
  subtitle: `字幕 ${index}`,
  camera: '推近',
  prompt: `图片提示词 ${index}`,
  videoPrompt: `视频提示词 ${index}`,
  status: 'pending'
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('videoGenProviders', () => {
  it('mock provider creates empty mp4 files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-gen-'))
    const result = await new MockVideoGenProvider().generateClips(shots, [], dir)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.clips).toHaveLength(2)
    expect((await stat(result.clips[0].clipPath)).size).toBe(0)
  })

  it('submits Kling tasks with API Key auth and downloads completed clips', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-gen-'))
    const imagePaths = await Promise.all(shots.map(async (shot) => {
      const path = join(dir!, `${shot.id}.png`)
      await writeFile(path, `image-${shot.id}`)
      return path
    }))
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/videos/image2video')) {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer api-key')
        const requestBody = JSON.parse(String(init?.body))
        const shotNumber = Number(String(requestBody.prompt).match(/\d+$/)?.[0])
        expect(requestBody.prompt).toBe(`视频提示词 ${shotNumber}`)
        expect(requestBody.image).toBe(Buffer.from(`image-shot-${shotNumber}`).toString('base64'))
        expect(requestBody).toMatchObject({
          model_name: 'kling-v3',
          duration: '7',
          mode: 'std',
          sound: 'on',
          multi_shot: false
        })
        return jsonResponse({ code: 0, data: { task_id: `task-${shotNumber}` } })
      }
      if (/\/v1\/videos\/image2video\/task-\d$/.test(url)) {
        const taskId = url.split('/').at(-1)
        return jsonResponse({
          code: 0,
          data: { task_status: 'succeed', task_result: { videos: [{ url: `https://cdn.test/${taskId}.mp4` }] } }
        })
      }
      if (url.startsWith('https://cdn.test/')) return new Response('video-data')
      throw new Error(`unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new KlingProvider(config).generateClips(shots, imagePaths, dir, options)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.clips.map((clip) => clip.shotId)).toEqual(['shot-1', 'shot-2'])
    expect(await readFile(result.clips[0].clipPath, 'utf8')).toBe('video-data')
  })

  it('keeps completed tasks when another Kling task fails', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-gen-'))
    let submitIndex = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/videos/image2video')) {
        submitIndex += 1
        return jsonResponse({ code: 0, data: { task_id: `task-${submitIndex}` } })
      }
      if (url.endsWith('/task-1')) {
        return jsonResponse({ code: 0, data: { task_status: 'failed', task_status_msg: 'prompt rejected' } })
      }
      if (url.endsWith('/task-2')) {
        return jsonResponse({
          code: 0,
          data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/task-2.mp4' }] } }
        })
      }
      if (url.startsWith('https://cdn.test/')) return new Response('video-data')
      throw new Error(`unexpected URL: ${url}`)
    }))

    const result = await new KlingProvider(config).generateClips(
      shots,
      ['https://images.test/1.png', 'https://images.test/2.png'],
      dir
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.failures).toEqual([{ shotId: 'shot-1', message: 'prompt rejected' }])
    expect(result.completed.map((clip) => clip.shotId)).toEqual(['shot-2'])
  })
})
