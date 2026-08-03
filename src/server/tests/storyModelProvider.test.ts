import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateStoryPackageWithModel } from '../services/storyModelProvider'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storyModelProvider', () => {
  it('calls Token Plan chat completions and maps model JSON to a story package', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body))
      expect(requestBody).toMatchObject({
        model: 'qwen3.8-max',
        response_format: { type: 'json_object' },
        enable_thinking: false
      })
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: '林川发现城市陷入危机。',
              characters: [{ name: '林川', description: '少年主角', appearance: '黑发，深色外套' }],
              scenes: [{ name: '燃烧的城市', description: '夜色中的街道火光冲天' }],
              shots: [{
                durationSeconds: 5,
                sceneIndex: 0,
                characterIndexes: [0],
                visual: '林川推开门看向城市',
                action: '林川推门后向前迈步',
                narration: '城市正在燃烧。',
                subtitle: '城市正在燃烧',
                camera: '缓慢推近',
                prompt: '9:16 动画画面，林川站在门前',
                videoPrompt: '林川推开门，镜头缓慢推近'
              }]
            })
          }
        }]
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateStoryPackageWithModel(
      { sourceText: '少年林川推开门，看见远处城市燃烧。', style: 'animation_drama' },
      'qwen3.8-max',
      { apiKey: 'token-plan-key', baseUrl: 'https://token-plan.test/compatible-mode/v1' }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://token-plan.test/compatible-mode/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.shots[0]).toMatchObject({
      id: 'shot-1',
      sceneId: 'scene-1',
      characterIds: ['char-1'],
      videoPromptSource: 'generated',
      status: 'pending'
    })
  })
})
