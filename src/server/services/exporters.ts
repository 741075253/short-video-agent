import type { Project } from '../../shared/schema'

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export function exportProjectMarkdown(project: Project): string {
  const story = project.storyPackage
  const lines: string[] = []
  lines.push(`# ${project.name}`)
  lines.push('')
  lines.push(`风格：${project.style}`)
  lines.push('')
  lines.push('## 小说原文')
  lines.push('')
  lines.push(project.sourceText)
  lines.push('')

  if (!story) {
    lines.push('## 生成结果')
    lines.push('')
    lines.push('当前项目还没有生成分镜脚本包。')
    return lines.join('\n')
  }

  lines.push('## 摘要')
  lines.push('')
  lines.push(story.summary)
  lines.push('')
  lines.push('## 角色')
  lines.push('')
  for (const character of story.characters) {
    lines.push(`- **${character.name}**：${character.description}；外貌：${character.appearance}`)
  }
  lines.push('')
  lines.push('## 场景')
  lines.push('')
  for (const scene of story.scenes) {
    lines.push(`- **${scene.name}**：${scene.description}`)
  }
  lines.push('')
  lines.push('## 分镜')
  lines.push('')
  lines.push('| # | 时长 | 画面 | 字幕 |')
  lines.push('|---|---:|---|---|')
  for (const shot of story.shots) {
    lines.push(`| ${shot.index} | ${shot.durationSeconds}s | ${escapeCell(shot.visual)} | ${escapeCell(shot.subtitle)} |`)
  }
  lines.push('')
  lines.push('## 提示词')
  lines.push('')
  for (const shot of story.shots) {
    lines.push(`### 镜头 ${shot.index}`)
    lines.push('')
    lines.push(shot.prompt)
    lines.push('')
  }
  return lines.join('\n')
}
