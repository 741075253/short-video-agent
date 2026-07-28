import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KlingProvider, MockVideoGenProvider } from '../services/videoGenProviders'
import type { KlingConfig, Shot } from '../../shared/schema'

let dir: string | undefined

const config: KlingConfig = {
  accessKey: 'access-key',
  secretKey: 'secret-key',
  model: 'kling-v1.6',
  duration: 5,
  mode: 'std',
  cfgScale: 0.5,
  concurrency: 3,
  pollIntervalMs: 0,
  pollMaxRetries: 2
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

  it('submits Kling tasks with JWT auth and downloads completed clips', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-gen-'))
    const imagePaths = await Promise.all(shots.map(async (shot) => {
      const path = join(dir!, `${shot.id}.png`)
      await writeFile(path, `image-${shot.id}`)
      return path
    }))
    let submitIndex = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/v1/videos/image2video')) {
        submitIndex += 1
        const token = String((init?.headers as Record<string, string>).authorization).slice('Bearer '.length)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
        expect(payload.iss).toBe('access-key')
        expect(payload.exp - payload.nbf).toBe(305)
        const requestBody = JSON.parse(String(init?.body))
        expect(requestBody.prompt).toBe(`视频提示词 ${submitIndex}`)
        expect(requestBody.image).toMatch(/^data:image\/png;base64,/)
        return jsonResponse({ code: 0, data: { task_id: `task-${submitIndex}` } })
      }
      if (/\/v1\/videos\/task-\d$/.test(url)) {
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

    const result = await new KlingProvider(config).generateClips(shots, imagePaths, dir)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.clips.map((clip) => clip.shotId)).toEqual(['shot-1', 'shot-2'])
    expect(await readFile(result.clips[0].clipPath, 'utf8')).toBe('video-data')
  })

  it('cancels pending tasks when any Kling task fails', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-video-gen-'))
    const cancelled: string[] = []
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
      if (url.endsWith('/task-2')) return jsonResponse({ code: 0, data: { task_status: 'processing' } })
      if (url.endsWith('/task-2/cancel')) {
        cancelled.push('task-2')
        return jsonResponse({ code: 0, data: {} })
      }
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
    expect(cancelled).toEqual(['task-2'])
  })
})
