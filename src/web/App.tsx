import { useEffect, useState } from 'react'
import type { Project } from '../shared/schema'
import { api } from './api'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [current, setCurrent] = useState<Project | null>(null)
  const [name, setName] = useState('我的小说短视频')
  const [sourceText, setSourceText] = useState('')
  const [message, setMessage] = useState('')

  async function refreshProjects() {
    setProjects(await api.listProjects())
  }

  useEffect(() => {
    refreshProjects().catch((error: Error) => setMessage(error.message))
  }, [])

  async function createProject() {
    setMessage('正在创建项目...')
    const project = await api.createProject({ name, sourceText })
    setCurrent(project)
    await refreshProjects()
    setMessage('项目已创建')
  }

  async function generateStory() {
    if (!current) return
    setMessage('正在生成分镜脚本包...')
    const project = await api.generateStory(current.id)
    setCurrent(project)
    await refreshProjects()
    setMessage('分镜脚本包已生成')
  }

  async function saveProject() {
    if (!current) return
    setMessage('正在保存...')
    const project = await api.saveProject(current)
    setCurrent(project)
    await refreshProjects()
    setMessage('已保存')
  }

  async function generateVideo(provider: 'mock' | 'local_ffmpeg' | 'dalle') {
    if (!current) return
    setMessage(`正在使用 ${provider} 生成视频...`)
    const result = await api.generateVideo(current.id, provider)
    const project = await api.getProject(current.id)
    setCurrent(project)
    setMessage(result.errors.length > 0 ? result.errors[0].message : `生成完成：${result.outputPath}`)
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>短视频智能体</h1>
        <p>小说文本 → 动画短剧分镜脚本包 → Mock / FFmpeg 视频生成流程</p>
        <label>
          项目名称
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          小说文本
          <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={8} />
        </label>
        <button onClick={() => createProject().catch((error: Error) => setMessage(error.message))}>新建项目</button>
        <p className="message">{message}</p>
      </section>

      <section className="panel">
        <h2>项目列表</h2>
        {projects.map((project) => (
          <button key={project.id} className="listItem" onClick={() => setCurrent(project)}>
            {project.name}
          </button>
        ))}
      </section>

      {current && (
        <section className="panel wide">
          <h2>{current.name}</h2>
          <div className="actions">
            <button onClick={() => generateStory().catch((error: Error) => setMessage(error.message))}>生成分镜</button>
            <button onClick={() => saveProject().catch((error: Error) => setMessage(error.message))}>保存修改</button>
            <button onClick={() => generateVideo('mock').catch((error: Error) => setMessage(error.message))}>Mock 生成视频</button>
            <button onClick={() => generateVideo('local_ffmpeg').catch((error: Error) => setMessage(error.message))}>FFmpeg 生成视频</button>
            <button onClick={() => generateVideo('dalle').catch((error: Error) => setMessage(error.message))}>DALL·E 生成视频</button>
            <a href={api.exportUrl(current.id, 'json')} target="_blank" rel="noreferrer">导出 JSON</a>
            <a href={api.exportUrl(current.id, 'markdown')} target="_blank" rel="noreferrer">导出 Markdown</a>
          </div>

          <label>
            小说原文
            <textarea
              value={current.sourceText}
              onChange={(event) => setCurrent({ ...current, sourceText: event.target.value })}
              rows={6}
            />
          </label>

          {current.storyPackage && (
            <div className="story">
              <h3>摘要</h3>
              <textarea
                value={current.storyPackage.summary}
                onChange={(event) =>
                  setCurrent({ ...current, storyPackage: { ...current.storyPackage!, summary: event.target.value } })
                }
              />
              <h3>分镜</h3>
              {current.storyPackage.shots.map((shot, index) => (
                <div className="shot" key={shot.id}>
                  <strong>镜头 {shot.index}｜{shot.status}</strong>
                  <label>
                    画面
                    <input
                      value={shot.visual}
                      onChange={(event) => {
                        const shots = [...current.storyPackage!.shots]
                        shots[index] = { ...shot, visual: event.target.value }
                        setCurrent({ ...current, storyPackage: { ...current.storyPackage!, shots } })
                      }}
                    />
                  </label>
                  <label>
                    字幕
                    <input
                      value={shot.subtitle}
                      onChange={(event) => {
                        const shots = [...current.storyPackage!.shots]
                        shots[index] = { ...shot, subtitle: event.target.value }
                        setCurrent({ ...current, storyPackage: { ...current.storyPackage!, shots } })
                      }}
                    />
                  </label>
                  <label>
                    提示词
                    <textarea
                      value={shot.prompt}
                      onChange={(event) => {
                        const shots = [...current.storyPackage!.shots]
                        shots[index] = { ...shot, prompt: event.target.value }
                        setCurrent({ ...current, storyPackage: { ...current.storyPackage!, shots } })
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
