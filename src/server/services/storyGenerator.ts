import type { GenerateStoryInput, Shot, StoryPackage } from '../../shared/schema'

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

const motionDetails: Array<[string, (name: string) => string]> = [
  ['推开', (name) => `${name}伸手握住门把，手臂发力将门向内推开并向前迈出一步`],
  ['握紧', (name) => `${name}收紧手指牢牢握住手中的物品，手腕轻微转动，身体进入戒备姿态`],
  ['转身', (name) => `${name}先转动头部看向身后，随后肩膀和身体连续转过去`],
  ['抬头', (name) => `${name}缓慢抬起下巴和视线，眼神聚焦到前方高处`],
  ['走进', (name) => `${name}连续向前迈步进入场景，衣摆和头发随步伐自然摆动`],
  ['走出', (name) => `${name}连续向前迈步离开当前位置，身体重心随步伐自然移动`],
  ['跑向', (name) => `${name}身体前倾并快速迈步跑向目标，双臂随步伐有力摆动`],
  ['低声', (name) => `${name}略微靠近同伴，嘴唇自然开合并压低声音说话`],
  ['喊', (name) => `${name}深吸一口气后张口呼喊，面部和肩颈随发声自然用力`],
  ['笑', (name) => `${name}眼神逐渐放松，嘴角扬起并露出自然笑容`],
  ['哭', (name) => `${name}眼眶逐渐湿润，呼吸颤动并抬手擦去泪水`],
  ['看见', (name) => `${name}转动视线看向目标，身体短暂停住，表情产生明显变化`],
  ['听见', (name) => `${name}动作突然停顿，侧头辨认声音来源并警觉地看向远处`],
  ['拿', (name) => `${name}伸手抓住目标物品，将其稳定地拿到身前`],
  ['举', (name) => `${name}握住物品并抬高手臂，将其举到视线前方`],
  ['冲', (name) => `${name}猛然压低重心并向前冲出，动作快速而连贯`],
  ['躲', (name) => `${name}迅速侧身降低重心，连续移动到遮挡物后方`]
]

function concreteAction(sentence: string, characterName: string): string {
  const actions = motionDetails
    .filter(([marker]) => sentence.includes(marker))
    .slice(0, 3)
    .map(([, describe]) => describe(characterName))
  if (actions.length > 0) return actions.join('，随后')
  return `${characterName}先转头观察周围，随后向前迈出一步并抬起手臂，表情随剧情由平静转为警觉`
}

export function buildVideoPrompt(visual: string, action: string, camera: string): string {
  return `动作过程：${action}。表情和视线随动作自然变化。镜头：${camera}。${visual}中的角色外观、服装和场景保持一致，动作连续流畅，无静止定格。`
}

export function isLegacyVideoPrompt(prompt: string | undefined): boolean {
  if (!prompt) return true
  return prompt.includes('做出反应') || prompt.includes('smooth continuous motion, cinematic movement')
}

export function upgradeShotVideoPrompt(shot: Shot): Shot {
  if (shot.videoPromptSource === 'manual') return shot
  if (!shot.videoPromptSource && !isLegacyVideoPrompt(shot.videoPrompt)) {
    return { ...shot, videoPromptSource: 'manual' }
  }

  const legacyName = shot.action.match(/^(.{1,6})在.*做出反应/)?.[1]
  const nameFromVisual = pickCharacterNames(shot.visual)[0]
  const characterName = legacyName || nameFromVisual || '角色'
  const action = shot.action.includes('做出反应')
    ? concreteAction(shot.visual, characterName)
    : shot.action
  return {
    ...shot,
    action,
    videoPrompt: buildVideoPrompt(shot.visual, action, shot.camera),
    videoPromptSource: 'generated'
  }
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

    const action = concreteAction(sentence, shotCharacters[0].name)
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
      videoPrompt: buildVideoPrompt(sentence, action, camera),
      videoPromptSource: 'generated' as const,
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
