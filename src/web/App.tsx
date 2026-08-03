import { useEffect, useState } from 'react'
import {
  defaultVideoGenerationOptions,
  modelCatalog,
  type ImageGenerationModel,
  type Project,
  type TextGenerationModel,
  type VideoGenerationOptions,
  type VideoGenerationProviderName,
  type VideoProviderDescriptor
} from '../shared/schema'
import { api } from './api'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [current, setCurrent] = useState<Project | null>(null)
  const [name, setName] = useState('我的小说短视频')
  const [sourceText, setSourceText] = useState('')
  const [message, setMessage] = useState('')
  const [providers, setProviders] = useState<VideoProviderDescriptor[]>([])
  const [selectedProvider, setSelectedProvider] = useState<VideoGenerationProviderName>('happyhorse_i2v')
  const [selectedTextModel, setSelectedTextModel] = useState<TextGenerationModel>('qwen3.8-max')
  const [selectedImageModel, setSelectedImageModel] = useState<ImageGenerationModel>('wan2.7-image-pro')
  const [videoOptions, setVideoOptions] = useState<VideoGenerationOptions>({ ...defaultVideoGenerationOptions })
  const [generatingImages, setGeneratingImages] = useState(false)
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null)

  async function refreshProjects() {
    setProjects(await api.listProjects())
  }

  useEffect(() => {
    Promise.all([refreshProjects(), api.listVideoProviders().then(setProviders)])
      .catch((error: Error) => setMessage(error.message))
  }, [])

  const providerDescriptor = providers.find((provider) => provider.id === selectedProvider)

  function resetVideoOptions(provider: VideoProviderDescriptor | undefined) {
    setVideoOptions({
      durationSeconds: provider?.capabilities.duration?.default ?? defaultVideoGenerationOptions.durationSeconds,
      resolution: provider?.capabilities.defaultResolution ?? defaultVideoGenerationOptions.resolution,
      nativeAudio: false
    })
  }

  function openProject(project: Project) {
    setCurrent(project)
    setSelectedProvider('happyhorse_i2v')
    resetVideoOptions(providers.find((provider) => provider.id === 'happyhorse_i2v'))
  }

  async function createProject() {
    setMessage('正在创建项目...')
    const project = await api.createProject({ name, sourceText })
    openProject(project)
    await refreshProjects()
    setMessage('项目已创建')
  }

  async function generateStory() {
    if (!current) return
    setMessage('正在生成分镜脚本包...')
    const project = await api.generateStory(current.id, selectedTextModel)
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

  async function generateImages() {
    if (!current) return
    setGeneratingImages(true)
    setMessage(`正在使用 ${selectedImageModel} 生成分镜图片...`)
    try {
      const saved = await api.saveProject(current)
      const project = await api.generateImages(saved.id, selectedImageModel)
      setCurrent(project)
      await refreshProjects()
      setMessage('分镜图片已生成')
    } finally {
      setGeneratingImages(false)
    }
  }

  async function generateVideo(shotId?: string, retryFailedOnly = false) {
    if (!current) return
    const activeId = shotId ?? 'all'
    setGeneratingShotId(activeId)
    setMessage(`正在使用 ${providerDescriptor?.label ?? selectedProvider} 生成视频...`)
    try {
      const saved = await api.saveProject(current)
      setCurrent(saved)
      const result = await api.generateVideo(current.id, {
        provider: selectedProvider,
        options: videoOptions,
        shotId,
        retryFailedOnly
      })
      const project = await api.getProject(current.id)
      setCurrent(project)
      if (result.errors.length > 0) {
        setMessage(result.errors[0].message)
      } else if (result.outputPath) {
        setMessage(`生成完成：${result.outputPath}`)
      } else {
        setMessage('分镜片段已生成，全部分镜就绪后将自动合成整片')
      }
    } finally {
      setGeneratingShotId(null)
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>短视频智能体</h1>
        <p>小说文本 → 动画分镜 → AI 动态片段 → 字幕成片</p>
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
          <button key={project.id} className="listItem" onClick={() => openProject(project)}>
            {project.name}
          </button>
        ))}
      </section>

      {current && (
        <section className="panel wide">
          <h2>{current.name}</h2>
          <div className="actions">
            <label className="compactControl">
              分镜模型
              <select
                value={selectedTextModel}
                onChange={(event) => setSelectedTextModel(event.target.value as TextGenerationModel)}
              >
                {modelCatalog.text.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <button onClick={() => generateStory().catch((error: Error) => setMessage(error.message))}>生成分镜</button>
            <button onClick={() => saveProject().catch((error: Error) => setMessage(error.message))}>保存修改</button>
            <a href={api.exportUrl(current.id, 'json')} target="_blank" rel="noreferrer">导出 JSON</a>
            <a href={api.exportUrl(current.id, 'markdown')} target="_blank" rel="noreferrer">导出 Markdown</a>
          </div>

          <div className="generationControls">
            <label className="compactControl">
              生图模型
              <select
                value={selectedImageModel}
                onChange={(event) => setSelectedImageModel(event.target.value as ImageGenerationModel)}
              >
                {modelCatalog.image.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={generatingImages || generatingShotId !== null || !current.storyPackage}
              onClick={() => generateImages().catch((error: Error) => setMessage(error.message))}
            >
              {generatingImages ? '图片生成中...' : '生成分镜图片'}
            </button>

            <label className="compactControl">
              视频模型
              <select
                value={selectedProvider}
                onChange={(event) => {
                  const provider = providers.find((item) => item.id === event.target.value)
                  if (!provider) return
                  setSelectedProvider(provider.id)
                  resetVideoOptions(provider)
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
            </label>

            {providerDescriptor?.capabilities.duration && (
              <label className="compactControl durationControl">
                时长（秒）
                <input
                  type="number"
                  min={providerDescriptor.capabilities.duration.min}
                  max={providerDescriptor.capabilities.duration.max}
                  value={videoOptions.durationSeconds}
                  onChange={(event) => setVideoOptions({
                    ...videoOptions,
                    durationSeconds: Number(event.target.value)
                  })}
                />
              </label>
            )}

            {providerDescriptor?.capabilities.resolutions && (
              <fieldset className="segmentedControl">
                <legend>分辨率</legend>
                <div>
                  {providerDescriptor.capabilities.resolutions.map((resolution) => (
                    <button
                      type="button"
                      key={resolution}
                      aria-pressed={videoOptions.resolution === resolution}
                      onClick={() => setVideoOptions({ ...videoOptions, resolution })}
                    >
                      {resolution}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {providerDescriptor?.capabilities.nativeAudio && (
              <label className="checkboxControl">
                <input
                  type="checkbox"
                  checked={videoOptions.nativeAudio}
                  onChange={(event) => setVideoOptions({ ...videoOptions, nativeAudio: event.target.checked })}
                />
                生成原生音频
              </label>
            )}

            <button
              className="generateButton"
              disabled={generatingImages || generatingShotId !== null || !current.storyPackage}
              onClick={() => generateVideo().catch((error: Error) => setMessage(error.message))}
            >
              {generatingShotId === 'all' ? '生成中...' : '生成视频'}
            </button>
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
                  <label>
                    动作提示词
                    <textarea
                      value={shot.videoPrompt ?? ''}
                      onChange={(event) => {
                        const shots = [...current.storyPackage!.shots]
                        shots[index] = {
                          ...shot,
                          videoPrompt: event.target.value,
                          videoPromptSource: 'manual'
                        }
                        setCurrent({ ...current, storyPackage: { ...current.storyPackage!, shots } })
                      }}
                    />
                  </label>
                  {shot.errorMessage && <p className="shotError">{shot.errorMessage}</p>}
                  {shot.status === 'failed' && (
                    <button
                      className="retryButton"
                      disabled={generatingShotId !== null}
                      onClick={() => generateVideo(shot.id, true).catch((error: Error) => setMessage(error.message))}
                    >
                      {generatingShotId === shot.id ? '重试中...' : '重试此分镜'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
