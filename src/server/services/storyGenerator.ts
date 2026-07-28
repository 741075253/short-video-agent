import type { GenerateStoryInput, StoryPackage } from '../../shared/schema'

function splitSentences(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/([一-龥，、；：])\s*\n+\s*(?=[一-龥])/g, '$1')

  return normalized
    .split(/[。！？!?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const actionMarkers = [
  '推开', '握紧', '低声', '看见', '听见', '走进', '走出', '跑向', '转身', '抬头', '站在', '坐在',
  '说', '问', '答', '喊', '笑', '哭', '走', '跑', '看', '望', '拿', '举', '冲', '躲', '停'
]

function characterNameFromPhrase(phrase: string): string | null {
  let end = phrase.length
  for (const marker of actionMarkers) {
    const index = phrase.indexOf(marker)
    if (index >= 0) end = Math.min(end, index)
  }
  const candidate = phrase.slice(0, end)
  return candidate.length >= 2 && candidate.length <= 4 ? candidate : null
}

function pickCharacterNames(text: string): string[] {
  const candidates: string[] = []
  const pattern = /(?:少年|少女|青年|女孩|男孩|老人|孩子)([一-龥]{1,12})/g
  for (const match of text.matchAll(pattern)) {
    const name = characterNameFromPhrase(match[1])
    if (name) candidates.push(name)
  }

  const unique = Array.from(new Set(candidates))
  if (unique.length >= 2) return unique.slice(0, 3)
  if (unique.length === 1) return [unique[0], '神秘同伴']
  return ['主角', '神秘同伴']
}

function groupSentences(sentences: string[], maxShots = 8): string[] {
  if (sentences.length <= maxShots) return sentences
  return Array.from({ length: maxShots }, (_, index) => {
    const start = Math.floor(index * sentences.length / maxShots)
    const end = Math.floor((index + 1) * sentences.length / maxShots)
    return sentences.slice(start, end).join('。')
  })
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

  const sceneContext = [
    `动画短剧风格，统一场景`,
    `色调：暖色调，柔光`,
    `背景：${scenes[0].description}`,
    `服装与发型保持一致`,
    `电影级光影，9:16竖屏构图`
  ]

  const shots = groupSentences(usableSentences).map((sentence, index) => {
    const mentionedCharacters = characters.filter((character) => sentence.includes(character.name))
    const shotCharacters = mentionedCharacters.length > 0 ? mentionedCharacters : [characters[0]]
    const characterContext = `角色：${shotCharacters.map((character) => `${character.name}（${character.appearance}）`).join('、')}`

    const action = `${shotCharacters[0].name}在紧张氛围中做出反应`
    const camera = index % 2 === 0 ? '缓慢推近，突出角色表情' : '横向跟拍，保持动作连续'

    return {
      id: `shot-${index + 1}`,
      index: index + 1,
      durationSeconds: 5,
      sceneId: 'scene-1',
      characterIds: shotCharacters.map((character) => character.id),
      visual: sentence,
      action,
      narration: sentence,
      subtitle: sentence.length > 24 ? `${sentence.slice(0, 24)}…` : sentence,
      camera,
      prompt: `${[...sceneContext, characterContext].join('，')}，镜头${index + 1}：${sentence}`,
      videoPrompt: `${sentence}。${action}。${camera}。smooth continuous motion, cinematic movement, consistent character appearance`,
      status: 'pending' as const
    }
  })

  return {
    summary: usableSentences.slice(0, 2).join('。'),
    characters,
    scenes,
    shots
  }
}
