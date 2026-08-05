import { describe, expect, it } from 'vitest'
import { StoryAnalysisModelSchema } from '../nest/workflow/story-analysis-schema'

describe('StoryAnalysisModelSchema', () => {
  it('normalizes common structured-output variations from text models', () => {
    const result = StoryAnalysisModelSchema.parse({
      summary: '少年发现城市陷入危机。',
      facts: [
        { fact: '城市正在燃烧', source: '段落1' },
        { content: '少年决定救人', evidence: '段落2' }
      ],
      characters: [{ characterName: '林川', role: '少年主角' }],
      locations: [
        { name: '旧城区', description: '燃烧中的街道' },
        { location: '钟楼' }
      ],
      events: [
        { sequence: '事件一', event: '林川发现火灾', characters: [{ name: '林川' }] },
        { title: '林川进入旧城区', participants: ['林川'] }
      ],
      conflicts: [
        { description: '林川必须穿过火场' },
        { conflict: '救人与自保之间的选择' }
      ]
    })

    expect(result).toMatchObject({
      facts: [
        { text: '城市正在燃烧', sourceRange: '段落1' },
        { text: '少年决定救人', sourceRange: '段落2' }
      ],
      characters: [{ name: '林川', description: '少年主角' }],
      locations: ['旧城区', '钟楼'],
      events: [
        { order: 1, description: '林川发现火灾', characterNames: ['林川'] },
        { order: 2, description: '林川进入旧城区', characterNames: ['林川'] }
      ],
      conflicts: ['林川必须穿过火场', '救人与自保之间的选择']
    })
  })
})
