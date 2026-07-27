import { describe, expect, it } from 'vitest'
import { generateStoryPackage } from '../services/storyGenerator'

describe('generateStoryPackage', () => {
  it('generates summary, characters, scenes and shots from novel text', () => {
    const result = generateStoryPackage({
      sourceText: '少年林川推开破旧木门，看见远处城市燃烧。少女阿月握紧短刀，低声说他们必须立刻离开。黑云压下，街道尽头传来巨兽的吼声。',
      style: 'animation_drama'
    })

    expect(result.summary).toContain('少年林川')
    expect(result.characters.length).toBeGreaterThanOrEqual(2)
    expect(result.scenes.length).toBeGreaterThanOrEqual(1)
    expect(result.shots.length).toBeGreaterThanOrEqual(3)
    expect(result.shots[0]).toMatchObject({
      index: 1,
      durationSeconds: 5,
      status: 'pending'
    })
    expect(result.shots[0].prompt).toContain('animation drama')
  })

  it('rejects text that is too short', () => {
    expect(() =>
      generateStoryPackage({ sourceText: '太短', style: 'animation_drama' })
    ).toThrow('小说文本至少需要 10 个字符')
  })
})
