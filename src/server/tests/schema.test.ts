import { describe, expect, it } from 'vitest'
import { ProjectSchema } from '../../shared/schema'

describe('ProjectSchema', () => {
  it('accepts a complete project with one shot', () => {
    const project = ProjectSchema.parse({
      id: 'project-1',
      name: '测试项目',
      sourceText: '少年推开门，看见远处燃烧的城市。',
      style: 'animation_drama',
      storyPackage: {
        summary: '少年发现城市陷入危机。',
        characters: [
          {
            id: 'char-1',
            name: '少年',
            description: '年轻、紧张、勇敢',
            appearance: '黑发，深色外套，神情坚定'
          }
        ],
        scenes: [
          {
            id: 'scene-1',
            name: '城门外',
            description: '远处城市燃烧，空气中有烟尘'
          }
        ],
        shots: [
          {
            id: 'shot-1',
            index: 1,
            durationSeconds: 5,
            sceneId: 'scene-1',
            characterIds: ['char-1'],
            visual: '少年站在城门外望向燃烧城市',
            action: '少年慢慢抬头',
            narration: '他第一次意识到，灾难已经降临。',
            subtitle: '灾难已经降临。',
            camera: '缓慢推近',
            prompt: 'animation drama style, black-haired young man, burning city background',
            status: 'pending'
          }
        ]
      },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    })

    expect(project.storyPackage?.shots[0].status).toBe('pending')
  })
})
