import { z } from 'zod'
import { textGenConfig } from '../config'
import type { GenerateStoryInput, StoryPackage, TextGenerationModel } from '../../shared/schema'

const GeneratedStorySchema = z.object({
  summary: z.string().min(1),
  characters: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    appearance: z.string().min(1)
  })).min(1).max(6),
  scenes: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1)
  })).min(1).max(8),
  shots: z.array(z.object({
    durationSeconds: z.coerce.number().int().min(3).max(12),
    sceneIndex: z.coerce.number().int().nonnegative(),
    characterIndexes: z.array(z.coerce.number().int().nonnegative()),
    visual: z.string().min(1),
    action: z.string().min(1),
    narration: z.string(),
    subtitle: z.string(),
    camera: z.string().min(1),
    prompt: z.string().min(1),
    videoPrompt: z.string().min(1)
  })).min(1).max(8)
})

type StoryModelConfig = {
  apiKey: string
  baseUrl: string
}

function jsonFromContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('文本模型未返回有效 JSON')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

export async function generateStoryPackageWithModel(
  input: GenerateStoryInput,
  model: TextGenerationModel,
  config: StoryModelConfig = textGenConfig
): Promise<StoryPackage> {
  if (!config.apiKey) throw new Error('未配置文本模型 API Key')

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是短视频分镜导演。只返回 JSON 对象，不要 Markdown。镜头适合 9:16 动画短剧，角色外观和场景必须跨镜头一致。'
        },
        {
          role: 'user',
          content: [
            '把下面小说改编为 1-8 个连续分镜。JSON 必须严格使用以下结构：',
            '{"summary":"","characters":[{"name":"","description":"","appearance":""}],"scenes":[{"name":"","description":""}],"shots":[{"durationSeconds":5,"sceneIndex":0,"characterIndexes":[0],"visual":"","action":"","narration":"","subtitle":"","camera":"","prompt":"","videoPrompt":""}]}',
            'sceneIndex 和 characterIndexes 使用从 0 开始的数组下标。prompt 描述静态关键帧，videoPrompt 描述明确、连续、可执行的人物动作和运镜。',
            `小说原文：${input.sourceText}`
          ].join('\n')
        }
      ],
      response_format: { type: 'json_object' },
      enable_thinking: false,
      temperature: 0.7,
      max_tokens: 8000
    })
  })

  const text = await response.text()
  if (!response.ok) throw new Error(`文本模型返回 ${response.status}: ${text.slice(0, 300)}`)

  let body: { choices?: Array<{ message?: { content?: string } }> }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    throw new Error(`文本模型返回了无效响应: ${text.slice(0, 300)}`)
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('文本模型未返回分镜内容')

  const generated = GeneratedStorySchema.parse(jsonFromContent(content))
  const characters = generated.characters.map((character, index) => ({
    id: `char-${index + 1}`,
    ...character
  }))
  const scenes = generated.scenes.map((scene, index) => ({
    id: `scene-${index + 1}`,
    ...scene
  }))
  const shots = generated.shots.map((shot, index) => {
    const scene = scenes[shot.sceneIndex] ?? scenes[0]
    const characterIds = shot.characterIndexes
      .map((characterIndex) => characters[characterIndex]?.id)
      .filter((id): id is string => Boolean(id))
    return {
      id: `shot-${index + 1}`,
      index: index + 1,
      durationSeconds: shot.durationSeconds,
      sceneId: scene.id,
      characterIds: characterIds.length > 0 ? characterIds : [characters[0].id],
      visual: shot.visual,
      action: shot.action,
      narration: shot.narration,
      subtitle: shot.subtitle,
      camera: shot.camera,
      prompt: shot.prompt,
      videoPrompt: shot.videoPrompt,
      videoPromptSource: 'generated' as const,
      status: 'pending' as const
    }
  })

  return { summary: generated.summary, characters, scenes, shots }
}
