import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  createVideoGenProvider: () => ({ name: 'kling', model: 'kling-v3', generateClips: mocks.generateClips })
}))

vi.mock('../services/videoProviders', () => ({
  createVideoProvider: () => ({ name: 'local_ffmpeg', generate: mocks.renderVideo })
}))

import { createApp } from '../app'

let dir: string | undefined

beforeEach(() => {
  mocks.generateImages.mockImplementation(async (
    shots: Array<{ id: string }>,
    outputDir: string
  ) => {
    await mkdir(outputDir, { recursive: true })
    return Promise.all(shots.map(async (shot) => {
      const path = join(outputDir, `${shot.id}.png`)
      await writeFile(path, `image-${shot.id}`)
      return path
    }))
  })
  mocks.generateClips.mockImplementation(async (
    shots: Array<{ id: string }>,
    _imageUrls: string[],
    outputDir: string
  ) => ({
    success: true,
    clips: await Promise.all(shots.map(async (shot) => {
      const clipPath = join(outputDir, `${shot.id}-clip.mp4`)
      await writeFile(clipPath, `video-${shot.id}`)
      return { shotId: shot.id, clipPath }
    }))
  }))
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

async function projectWithStory(
  sourceText = '少年林川推开木门，看见远处城市燃烧。',
  withImages = true
) {
  dir = await mkdtemp(join(tmpdir(), 'short-video-agent-kling-route-'))
  const app = createApp({ dataDir: dir })
  const created = await request(app)
    .post('/api/projects')
    .send({ name: 'Kling 测试', sourceText })
    .expect(201)
  await request(app).post(`/api/projects/${created.body.id}/generate-story`).expect(200)
  if (withImages) {
    await request(app)
      .post(`/api/projects/${created.body.id}/generate-images`)
      .send({ model: 'wan2.7-image-pro' })
      .expect(200)
  }
  return { app, id: created.body.id as string }
}

describe('Kling video route', () => {
  it('exposes provider capabilities for the page', async () => {
    const { app } = await projectWithStory()
    const response = await request(app).get('/api/video-providers').expect(200)

    expect(response.body[0]).toMatchObject({
      id: 'happyhorse_i2v',
      capabilities: {
        duration: { min: 3, max: 15, default: 5 },
        resolutions: ['720p', '1080p'],
        aiVideo: true,
        imageToVideo: true
      }
    })
  })

  it('uses generated images, persists clip paths, and renders the final video', async () => {
    const { app, id } = await projectWithStory()

    await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({
        provider: 'kling',
        options: { durationSeconds: 8, resolution: '720p', nativeAudio: false }
      })
      .expect(200)

    expect(mocks.generateImages).toHaveBeenCalledTimes(1)
    expect(mocks.generateClips.mock.calls[0][1][0]).toMatch(/shot-1\.png$/)
    expect(mocks.generateClips.mock.calls[0][3]).toEqual({
      durationSeconds: 8,
      resolution: '720p',
      nativeAudio: false
    })
    expect(mocks.renderVideo).toHaveBeenCalledTimes(1)
    const persisted = await request(app).get(`/api/projects/${id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0]).toMatchObject({
      status: 'ready',
      videoPromptSource: 'generated',
      videoClipMetadata: {
        provider: 'kling',
        model: 'kling-v3',
        durationSeconds: 8,
        resolution: '720p',
        nativeAudio: false
      }
    })
    expect(persisted.body.storyPackage.shots[0].assetPath).toMatch(/shot-1\.png$/)
    expect(persisted.body.storyPackage.shots[0].videoClipPath).toMatch(/shot-1-clip\.mp4$/)
  })

  it('requires image generation before image-to-video generation', async () => {
    const { app, id } = await projectWithStory(undefined, false)

    const response = await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling' })
      .expect(400)

    expect(response.body.message).toContain('请先生成分镜图片')
    expect(mocks.generateImages).not.toHaveBeenCalled()
    expect(mocks.generateClips).not.toHaveBeenCalled()
  })

  it('reuses a matching successful clip without another Kling request', async () => {
    const { app, id } = await projectWithStory()
    const payload = {
      provider: 'kling',
      options: { durationSeconds: 5, resolution: '1080p', nativeAudio: false }
    }

    await request(app).post(`/api/projects/${id}/generate-video`).send(payload).expect(200)
    await request(app).post(`/api/projects/${id}/generate-video`).send(payload).expect(200)

    expect(mocks.generateClips).toHaveBeenCalledTimes(1)
    expect(mocks.renderVideo).toHaveBeenCalledTimes(2)
  })

  it('invalidates a clip when page generation options change', async () => {
    const { app, id } = await projectWithStory()

    await request(app).post(`/api/projects/${id}/generate-video`).send({
      provider: 'kling',
      options: { durationSeconds: 5, resolution: '1080p', nativeAudio: false }
    }).expect(200)
    await request(app).post(`/api/projects/${id}/generate-video`).send({
      provider: 'kling',
      options: { durationSeconds: 6, resolution: '1080p', nativeAudio: false }
    }).expect(200)

    expect(mocks.generateClips).toHaveBeenCalledTimes(2)
  })

  it('retries only the failed shot and then renders all completed clips', async () => {
    const { app, id } = await projectWithStory(
      '少年林川推开木门，看见远处城市燃烧。少女阿月握紧短刀，转身看向街道。'
    )
    mocks.generateClips.mockImplementationOnce(async (
      shots: Array<{ id: string }>,
      _imageUrls: string[],
      outputDir: string
    ) => {
      const completedPath = join(outputDir, `${shots[0].id}-clip.mp4`)
      await writeFile(completedPath, 'completed-video')
      return {
        success: false,
        failures: [{ shotId: shots[1].id, message: 'prompt rejected' }],
        completed: [{ shotId: shots[0].id, clipPath: completedPath }]
      }
    })
    const options = { durationSeconds: 5, resolution: '1080p', nativeAudio: false }

    const first = await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling', options })
      .expect(200)
    expect(first.body.failures[0].shotId).toBe('shot-2')
    expect(mocks.renderVideo).not.toHaveBeenCalled()

    const second = await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling', options, shotId: 'shot-2', retryFailedOnly: true })
      .expect(200)

    expect(mocks.generateClips.mock.calls[1][0].map((shot: { id: string }) => shot.id)).toEqual(['shot-2'])
    expect(mocks.renderVideo).toHaveBeenCalledTimes(1)
    expect(second.body.outputPath).toBe('final.mp4')
  })

  it('returns partial results and skips FFmpeg when Kling fails', async () => {
    mocks.generateClips.mockResolvedValue({
      success: false,
      failures: [{ shotId: 'shot-1', message: 'prompt rejected' }],
      completed: []
    })
    const { app, id } = await projectWithStory()

    const response = await request(app)
      .post(`/api/projects/${id}/generate-video`)
      .send({ provider: 'kling' })
      .expect(200)

    expect(response.body.failures).toEqual([{ shotId: 'shot-1', message: 'prompt rejected' }])
    expect(response.body.errors).toEqual(response.body.failures)
    expect(mocks.renderVideo).not.toHaveBeenCalled()
    const persisted = await request(app).get(`/api/projects/${id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0].status).toBe('failed')
  })
})
