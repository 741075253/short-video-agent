import type { GenerateStoryInput, StoryPackage } from '../../shared/schema'

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pickCharacterNames(text: string): string[] {
  const matches = text.match(/[一-龥]{2,4}/g) ?? []
  const candidates = matches.filter((word) =>
    /少年|少女|男人|女人|老人|孩子|林|阿|小|王|李|张|陈/.test(word)
  )
  const unique = Array.from(new Set(candidates))
  if (unique.length >= 2) return unique.slice(0, 3)
  if (unique.length === 1) return [unique[0], '神秘同伴']
  return ['主角', '神秘同伴']
}

export function generateStoryPackage(input: GenerateStoryInput): StoryPackage {
  const sourceText = input.sourceText.trim()
  if (sourceText.length < 10) throw new Error('小说文本至少需要 10 个字符')

  const sentences = splitSentences(sourceText)
  const usableSentences = sentences.length > 0 ? sentences : [sourceText]
  const characterNames = pickCharacterNames(sourceText)

  const characters = characterNames.map((name, index) => ({
    id: `char-${index + 1}`,
    name,
    description: index === 0 ? '故事主角，情绪变化明显，推动剧情前进' : '重要配角，与主角形成互动或冲突',
    appearance: index === 0 ? '年轻角色，黑发，深色短外套，眼神坚定' : '年轻角色，浅色服装，表情警觉，动作敏捷'
  }))

  const scenes = [
    {
      id: 'scene-1',
      name: '关键场景',
      description: '根据小说片段生成的主要事件发生地，具有强烈戏剧氛围'
    }
  ]

  const shots = usableSentences.slice(0, 8).map((sentence, index) => ({
    id: `shot-${index + 1}`,
    index: index + 1,
    durationSeconds: 5,
    sceneId: 'scene-1',
    characterIds: characters.slice(0, Math.min(2, characters.length)).map((item) => item.id),
    visual: sentence,
    action: `${characters[0].name}在紧张氛围中做出反应`,
    narration: sentence,
    subtitle: sentence.length > 24 ? `${sentence.slice(0, 24)}…` : sentence,
    camera: index % 2 === 0 ? '缓慢推近，突出角色表情' : '横向跟拍，保持动作连续',
    prompt: [
      'animation drama style',
      'cinematic lighting',
      'consistent character design',
      characters.map((item) => `${item.name}: ${item.appearance}`).join('; '),
      sentence
    ].join(', '),
    status: 'pending' as const
  }))

  return {
    summary: usableSentences.slice(0, 2).join('。'),
    characters,
    scenes,
    shots
  }
}
