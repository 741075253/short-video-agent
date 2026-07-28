import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateImages: vi.fn(),
  generateClips: vi.fn(),
  renderVideo: vi.fn()
}))

vi.mock('../services/imageProviders', () => ({
  createImageProvider: () => ({
    name: 'test-image-provider',
    lastImageUrl: 'https://images.test/latest.png',
    generateImage: vi.fn(),
    generateImages: mocks.generateImages
  })
}))

vi.mock('../services/videoGenProviders', () => ({
  createVideoGenProvider: () => ({ name: 'kling', generateClips: mocks.generateClips })
}))

vi.mock('../services/videoProviders', () => ({
  createVideoProvider: () => ({ name: 'local_ffmpeg', generate: mocks.renderVideo })
}))

import { createApp } from '../app'

let dir: string | undefined

beforeEach(() => {
  mocks.generateImages.mockResolvedValue(['generated-shot.png'])
  mocks.generateClips.mockResolvedValue({
    success: true,
    clips: [{ shotId: 'shot-1', clipPath: 'shot-1-clip.mp4' }]
  })
  mocks.renderVideo.mockImplementation(async (input: {
    project: { id: string; storyPackage?: { shots: Array<Record<string, unknown>> } }
    shotId?: string
  }) => {
    const shots = input.project.storyPackage?.shots ?? []
    const updatedShots = input.shotId
      ? shots.filter((shot) => shot.id === input.shotId)
      : shots
    return {
      provider: 'local_ffmpeg',
      projectId: input.project.id,
      outputPath: 'final.mp4',
      updatedShots: updatedShots.map((shot) => ({ ...shot, status: 'ready', errorMessage: undefined })),
      errors: []
    }
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function projectWithStory() {
  dir = await mkdtemp(join(tmpdir(), 'short-video-agent-kling-route-'))
  const app = createApp({ dataDir: dir })
  const created = await request(app)
    .post('/api/projects')
    .send({ name: 'Kling 测试', sourceText: '少年林川推开木门，看见远处城市燃烧。' })
    .expect(201)
  await request(app).post(`/api/projects/${created.body.id}/generate-story`).expect(200)
  return { app, id: created.body.id as string }
}

describe('Kling video route', () => {
  it('generates missing images, persists clip paths, and renders the final video', async () => {
    const { app, id } = await projectWithStory()

    await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling' })
      .expect(200)

    expect(mocks.generateImages).toHaveBeenCalledTimes(1)
    expect(mocks.generateClips.mock.calls[0][1]).toEqual(['https://images.test/latest.png'])
    expect(mocks.renderVideo).toHaveBeenCalledTimes(1)
    const persisted = await request(app).get(`/api/projects/${id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0]).toMatchObject({
      status: 'ready',
      assetPath: 'generated-shot.png',
      videoClipPath: 'shot-1-clip.mp4'
    })
  })

  it('returns 502 and skips FFmpeg when Kling fails', async () => {
    mocks.generateClips.mockResolvedValue({
      success: false,
      failures: [{ shotId: 'shot-1', message: 'prompt rejected' }],
      completed: []
    })
    const { app, id } = await projectWithStory()

    const response = await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling' })
      .expect(502)

    expect(response.body.failures).toEqual([{ shotId: 'shot-1', message: 'prompt rejected' }])
    expect(mocks.renderVideo).not.toHaveBeenCalled()
    const persisted = await request(app).get(`/api/projects/${id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0].status).toBe('failed')
  })
})
