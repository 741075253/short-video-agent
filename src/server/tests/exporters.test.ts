import { describe, expect, it } from 'vitest'
import { exportProjectJson, exportProjectMarkdown } from '../services/exporters'
import type { Project } from '../../shared/schema'

const project: Project = {
  id: 'project-1',
  name: '测试项目',
  sourceText: '少年推开门，看见城市燃烧。',
  style: 'animation_drama',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  storyPackage: {
    summary: '少年看见城市燃烧。',
    characters: [{ id: 'char-1', name: '少年', description: '主角', appearance: '黑发深色外套' }],
    scenes: [{ id: 'scene-1', name: '城门', description: '燃烧城市外' }],
    shots: [
      {
        id: 'shot-1',
        index: 1,
        durationSeconds: 5,
        sceneId: 'scene-1',
        characterIds: ['char-1'],
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

describe('exporters', () => {
  it('exports stable JSON', () => {
    const json = exportProjectJson(project)
    expect(JSON.parse(json)).toEqual(project)
  })

  it('exports markdown shot table', () => {
    const markdown = exportProjectMarkdown(project)
    expect(markdown).toContain('# 测试项目')
    expect(markdown).toContain('## 分镜')
    expect(markdown).toContain('| 1 | 5s | 少年站在门前 | 城市燃烧了。 |')
  })
})
