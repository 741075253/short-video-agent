import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('routes', () => {
  it('creates a project, generates story package, exports markdown, and runs mock video generation', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-api-'))
    const app = createApp({ dataDir: dir })

    const created = await request(app)
      .post('/api/projects')
      .send({ name: '测试项目', sourceText: '少年林川推开门，看见远处城市燃烧。少女阿月说他们必须立刻离开。黑云压下，巨兽的吼声传来。' })
      .expect(201)

    const id = created.body.id
    expect(id).toBeTruthy()

    const generated = await request(app).post(`/api/projects/${id}/generate-story`).expect(200)
    expect(generated.body.storyPackage.shots.length).toBeGreaterThanOrEqual(3)

    const markdown = await request(app).get(`/api/projects/${id}/export/markdown`).expect(200)
    expect(markdown.text).toContain('## 分镜')

    const video = await request(app).post(`/api/projects/${id}/generate-video`).send({ provider: 'mock' }).expect(200)
    expect(video.body.updatedShots[0].status).toBe('ready')

    const persisted = await request(app).get(`/api/projects/${id}`).expect(200)
    expect(persisted.body.storyPackage.shots.every((shot: { status: string }) => shot.status === 'ready')).toBe(true)
  })

  it('generates and persists only the requested shot', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-api-'))
    const app = createApp({ dataDir: dir })
    const created = await request(app)
      .post('/api/projects')
      .send({ name: '测试项目', sourceText: '少年林川推开门。少女阿月转身离开。黑云压下，巨兽吼声传来。' })
      .expect(201)
    const generated = await request(app).post(`/api/projects/${created.body.id}/generate-story`).expect(200)
    const shotId = generated.body.storyPackage.shots[0].id

    const video = await request(app)
      .post(`/api/projects/${created.body.id}/generate-video`)
      .send({ provider: 'mock', shotId })
      .expect(200)
    expect(video.body.updatedShots).toHaveLength(1)

    const persisted = await request(app).get(`/api/projects/${created.body.id}`).expect(200)
    expect(persisted.body.storyPackage.shots[0].status).toBe('ready')
    expect(persisted.body.storyPackage.shots.slice(1).every((shot: { status: string }) => shot.status === 'pending')).toBe(true)
  })
})
