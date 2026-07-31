import { describe, expect, it } from 'vitest'
import { generateStoryPackage, upgradeShotVideoPrompt } from '../services/storyGenerator'

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
    expect(result.characters.map((character) => character.name)).toEqual(['林川', '阿月'])
    expect(result.shots[0].characterIds).toEqual(['char-1'])
    expect(result.shots[1].characterIds).toEqual(['char-2'])
    expect(result.shots[0].prompt).not.toContain('阿月（')
    expect(result.shots[0].prompt).toContain('动画短剧')
    expect(result.shots[0].action).toContain('伸手握住门把')
    expect(result.shots[0].videoPrompt).toContain('动作过程：')
    expect(result.shots[0].videoPrompt).toContain('无静止定格')
    expect(result.shots[0].videoPromptSource).toBe('generated')
  })

  it('covers the full source text while limiting the package to eight shots', () => {
    const sourceText = Array.from({ length: 10 }, (_, index) => `第${index + 1}段剧情继续推进`).join('。')
    const result = generateStoryPackage({ sourceText, style: 'animation_drama' })

    expect(result.shots).toHaveLength(8)
    expect(result.shots.at(-1)?.narration).toContain('第10段剧情继续推进')
  })

  it('does not split a Chinese sentence at an internal line break', () => {
    const result = generateStoryPackage({
      sourceText: '少年林川推开木门，看见城市燃烧。少女阿月说他们必须离开。黑云\n压下，街道尽头传来巨兽的吼声。',
      style: 'animation_drama'
    })

    expect(result.shots).toHaveLength(3)
    expect(result.shots[2].visual).toBe('黑云压下，街道尽头传来巨兽的吼声')
  })

  it('upgrades legacy prompts without overwriting manual prompts', () => {
    const shot = generateStoryPackage({
      sourceText: '少年林川推开木门，看见远处城市燃烧。',
      style: 'animation_drama'
    }).shots[0]
    const legacy = upgradeShotVideoPrompt({
      ...shot,
      action: '林川在紧张氛围中做出反应',
      videoPrompt: '林川做出反应。smooth continuous motion, cinematic movement',
      videoPromptSource: undefined
    })
    const manual = upgradeShotVideoPrompt({
      ...shot,
      videoPrompt: '林川快速推门后退两步。',
      videoPromptSource: 'manual'
    })

    expect(legacy.videoPromptSource).toBe('generated')
    expect(legacy.videoPrompt).toContain('伸手握住门把')
    expect(manual.videoPrompt).toBe('林川快速推门后退两步。')
  })

  it('rejects text that is too short', () => {
    expect(() =>
      generateStoryPackage({ sourceText: '太短', style: 'animation_drama' })
    ).toThrow('小说文本至少需要 10 个字符')
  })
})
