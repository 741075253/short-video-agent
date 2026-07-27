import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectStore } from '../services/projectStore'
import type { Project } from '../../shared/schema'

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('projectStore', () => {
  it('saves and reads a project', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-'))
    const store = createProjectStore(dir)
    const project: Project = {
      id: 'project-1',
      name: '测试项目',
      sourceText: '少年推开门，看见远处燃烧的城市。',
      style: 'animation_drama',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    }

    await store.saveProject(project)

    await expect(store.getProject('project-1')).resolves.toEqual(project)
    await expect(store.listProjects()).resolves.toEqual([project])
  })

  it('returns null when project does not exist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-'))
    const store = createProjectStore(dir)

    await expect(store.getProject('missing')).resolves.toBeNull()
  })
})
