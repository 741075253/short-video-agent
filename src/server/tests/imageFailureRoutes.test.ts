import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/imageProviders', () => ({
  createImageProvider: () => ({
    name: 'failing-image-provider',
    generateImage: async () => {
      throw new Error('上游生图失败')
    }
  })
}))

import { createApp } from '../app'

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('image generation failure', () => {
  it('returns an error and does not continue to video generation', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-image-failure-'))
    const app = createApp({ dataDir: dir })
    const created = await request(app)
      .post('/api/projects')
      .send({ name: '测试项目', sourceText: '少年林川推开木门，看见远处城市燃烧。' })
      .expect(201)
    await request(app).post(`/api/projects/${created.body.id}/generate-story`).expect(200)

    const response = await request(app)
      .post(`/api/projects/${created.body.id}/generate-video`)
      .send({ provider: 'local_ffmpeg' })
      .expect(502)

    expect(response.body.message).toContain('镜头生图失败')
    const persisted = await request(app).get(`/api/projects/${created.body.id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0].status).toBe('failed')
    expect(persisted.body.storyPackage.shots[0].assetPath).toBeUndefined()
  })
})
