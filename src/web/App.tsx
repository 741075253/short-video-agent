import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Download,
  Film,
  FolderOpen,
  History,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  X
} from 'lucide-react'
import {
  defaultProductionConfig,
  type ModelCatalogResponse,
  type ProductionConfig,
  type Project,
  type StoryPackage
} from '../shared/schema'
import type { ArtifactVersion, Episode, RunStatus, WorkflowRun } from '../shared/workflow'
import { api } from './api'

const terminalStatuses: RunStatus[] = ['completed', 'failed', 'cancelled']

const statusLabels: Record<RunStatus, string> = {
  queued: '等待执行',
  running: '正在执行',
  waiting_character_approval: '确认角色',
  waiting_storyboard_approval: '确认分镜',
  waiting_budget_approval: '确认预算',
  waiting_human_review: '人工审核',
  cancel_requested: '正在取消',
  cancelled: '已取消',
  completed: '已完成',
  failed: '执行失败'
}

const workflowStages = [
  { id: 'story_analyzer', label: '故事理解', ready: (run: WorkflowRun) => Boolean(run.state?.storyAnalysis) },
  { id: 'director', label: '导演规划', ready: (run: WorkflowRun) => Boolean(run.state?.directorPlan) },
  { id: 'character', label: '角色设定', ready: (run: WorkflowRun) => Boolean(run.state?.characterBible) },
  { id: 'character_reference', label: '角色参考图', ready: (run: WorkflowRun) => Boolean(run.state?.characterReferences?.every((item) => item.approved)) },
  { id: 'plot', label: '剧情拆分', ready: (run: WorkflowRun) => Boolean(run.state?.plotOutline) },
  { id: 'scene', label: '场景设计', ready: (run: WorkflowRun) => Boolean(run.state?.sceneBible) },
  { id: 'storyboard_agent', label: '分镜生成', ready: (run: WorkflowRun) => Boolean(run.state?.storyboard) },
  { id: 'production', label: '视频制作', ready: (run: WorkflowRun) => Boolean(run.state?.generatedAssets?.shots.every((shot) => shot.status === 'ready')) },
  { id: 'editing', label: '剪辑合成', ready: (run: WorkflowRun) => Boolean(run.state?.editResult) },
  { id: 'reviewer', label: '成片审核', ready: (run: WorkflowRun) => run.status === 'completed' }
]

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [current, setCurrent] = useState<Project | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactVersion[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogResponse | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('')
  const [name, setName] = useState('我的短剧')
  const [sourceText, setSourceText] = useState('')
  const [config, setConfig] = useState<ProductionConfig>({ ...defaultProductionConfig })
  const [feedback, setFeedback] = useState('')
  const [draftStoryboard, setDraftStoryboard] = useState<StoryPackage | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshProjects() {
    setProjects(await api.listProjects())
  }

  async function refreshRun(runId: string) {
    const [nextRun, nextArtifacts] = await Promise.all([
      api.getRun(runId),
      api.listArtifacts(runId)
    ])
    setRun(nextRun)
    setArtifacts(nextArtifacts)
    if (nextRun.state?.storyboard && nextRun.status === 'waiting_storyboard_approval') {
      setDraftStoryboard((previous) => previous ?? nextRun.state!.storyboard!)
    }
    if (nextRun.status === 'completed' && current) {
      setCurrent(await api.getProject(current.id))
      await refreshProjects()
    }
  }

  useEffect(() => {
    Promise.all([refreshProjects(), api.listModels().then((catalog) => {
      setModelCatalog(catalog)
      setConfig((currentConfig) => ({
        ...currentConfig,
        ...catalog.defaults
      }))
    })])
      .catch((error: Error) => setMessage(error.message))
  }, [])

  useEffect(() => {
    if (!run || terminalStatuses.includes(run.status)) return
    const cleanup = api.subscribeToRun(run.id, () => {
      void refreshRun(run.id).catch((error: Error) => setMessage(error.message))
    })
    const poll = window.setInterval(() => {
      void refreshRun(run.id).catch((error: Error) => setMessage(error.message))
    }, 3000)
    return () => {
      cleanup()
      window.clearInterval(poll)
    }
  }, [run?.id, run?.status])

  const currentProvider = modelCatalog?.video.find((provider) => provider.id === config.videoProvider)
  const active = run && !terminalStatuses.includes(run.status)
  const tokenUsed = run ? run.budget.usedInputTokens + run.budget.usedOutputTokens : 0
  const finalArtifact = artifacts.find((artifact) => artifact.kind === 'final_video' && artifact.status === 'current')

  const characterArtifacts = useMemo(() => {
    const result = new Map<string, ArtifactVersion>()
    for (const artifact of artifacts) {
      if (artifact.kind === 'character_reference' && artifact.ownerId && artifact.status === 'current') {
        result.set(artifact.ownerId, artifact)
      }
    }
    return result
  }, [artifacts])

  async function openProject(project: Project) {
    setCurrent(project)
    setConfig(project.productionConfig ?? { ...defaultProductionConfig })
    setFeedback('')
    setDraftStoryboard(null)
    const [runs, projectEpisodes] = await Promise.all([api.listRuns(project.id), api.listEpisodes(project.id)])
    setEpisodes(projectEpisodes)
    setSelectedEpisodeId(projectEpisodes[0]?.id ?? '')
    const latest = runs[0] ?? null
    setRun(latest)
    setArtifacts(latest ? await api.listArtifacts(latest.id) : [])
  }

  async function createProject() {
    setBusy(true)
    try {
      const project = await api.createProject({ name, sourceText, productionConfig: config })
      await refreshProjects()
      await openProject(project)
      setMessage('项目已创建')
    } finally {
      setBusy(false)
    }
  }

  async function saveProject() {
    if (!current) return
    setBusy(true)
    try {
      const saved = await api.saveProject({ ...current, productionConfig: config })
      setCurrent(saved)
      await refreshProjects()
      setMessage('项目已保存')
    } finally {
      setBusy(false)
    }
  }

  async function startRun() {
    if (!current) return
    setBusy(true)
    try {
      const saved = await api.saveProject({ ...current, productionConfig: config })
      setCurrent(saved)
      const projectEpisodes = await api.listEpisodes(saved.id)
      setEpisodes(projectEpisodes)
      const episodeId = selectedEpisodeId && projectEpisodes.some((episode) => episode.id === selectedEpisodeId)
        ? selectedEpisodeId
        : projectEpisodes[0]?.id
      setSelectedEpisodeId(episodeId ?? '')
      const started = await api.startRun(saved.id, { productionConfig: config, episodeId })
      setRun(started)
      setArtifacts([])
      setMessage('制作流程已启动')
    } finally {
      setBusy(false)
    }
  }

  async function resume(approved: boolean, includeStoryboard = false) {
    if (!run) return
    setBusy(true)
    try {
      await api.resumeRun(run.id, {
        approved,
        feedback: feedback || undefined,
        storyboard: includeStoryboard ? draftStoryboard ?? undefined : undefined
      })
      setFeedback('')
      setDraftStoryboard(null)
      await refreshRun(run.id)
      setMessage(approved ? '已确认，流程继续执行' : '已提交返工意见')
    } finally {
      setBusy(false)
    }
  }

  async function addBudget() {
    if (!run) return
    setBusy(true)
    try {
      await api.resumeRun(run.id, { approved: true, additionalTokens: 50000 })
      await refreshRun(run.id)
      setMessage('已追加 50,000 Token')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRun() {
    if (!run) return
    setBusy(true)
    try {
      setRun(await api.cancelRun(run.id))
      setMessage('已请求取消')
    } finally {
      setBusy(false)
    }
  }

  async function rollbackArtifact(artifactId: string) {
    if (!run) return
    setBusy(true)
    try {
      await api.rollbackArtifact(run.id, artifactId)
      await refreshRun(run.id)
      setMessage('已切换到所选历史版本')
    } finally {
      setBusy(false)
    }
  }

  function updateShot(index: number, patch: Partial<StoryPackage['shots'][number]>) {
    if (!draftStoryboard) return
    const shots = [...draftStoryboard.shots]
    shots[index] = { ...shots[index], ...patch }
    setDraftStoryboard({ ...draftStoryboard, shots })
  }

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <Film aria-hidden="true" />
          <span>短剧制作台</span>
        </div>
        <div className="topbarStatus">
          {run && <span className={`statusPill status-${run.status}`}>{statusLabels[run.status]}</span>}
          {message && <span className="message">{message}</span>}
        </div>
      </header>

      <div className="studioGrid">
        <aside className="projectRail">
          <section className="newProject">
            <h2>新项目</h2>
            <label>
              名称
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              故事内容
              <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={7} />
            </label>
            <button className="primaryButton" disabled={busy || sourceText.trim().length < 10} onClick={() => void createProject()}>
              <Sparkles size={16} />创建项目
            </button>
          </section>

          <nav className="projectList" aria-label="项目列表">
            <div className="sectionTitle">
              <h2>项目</h2>
              <button className="iconButton" title="刷新项目" onClick={() => void refreshProjects()}>
                <RefreshCw size={16} />
              </button>
            </div>
            {projects.map((project) => (
              <button
                key={project.id}
                className={`projectItem ${current?.id === project.id ? 'selected' : ''}`}
                onClick={() => void openProject(project)}
              >
                <FolderOpen size={16} />
                <span>{project.name}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {projects.length === 0 && <p className="emptyText">创建第一个项目</p>}
          </nav>
        </aside>

        <section className="workArea">
          {!current ? (
            <div className="emptyWorkspace">
              <Film size={28} />
              <h1>选择一个项目</h1>
            </div>
          ) : (
            <>
              <div className="projectHeader">
                <div>
                  <span className="eyebrow">当前项目</span>
                  <h1>{current.name}</h1>
                </div>
                <div className="headerActions">
                  <button className="secondaryButton" disabled={busy || Boolean(active)} onClick={() => void saveProject()}>
                    <Save size={16} />保存
                  </button>
                  <button className="primaryButton" disabled={busy || Boolean(active)} onClick={() => void startRun()}>
                    <Play size={16} />启动制作
                  </button>
                </div>
              </div>

              <div className="configBand">
                <label>
                  文本模型
                  <select value={config.textModel} onChange={(event) => setConfig({ ...config, textModel: event.target.value })}>
                    {modelCatalog?.text.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </label>
                <label>
                  生图模型
                  <select value={config.imageModel} onChange={(event) => setConfig({ ...config, imageModel: event.target.value })}>
                    {modelCatalog?.image.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </label>
                <label>
                  视频模型
                  <select
                    value={config.videoProvider}
                    onChange={(event) => setConfig({
                      ...config,
                      videoProvider: event.target.value as ProductionConfig['videoProvider']
                    })}
                  >
                    {modelCatalog?.video.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </label>
                <label>
                  成片时长
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={config.targetDurationSeconds}
                    onChange={(event) => setConfig({ ...config, targetDurationSeconds: Number(event.target.value) })}
                  />
                </label>
                <label>
                  集数
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={config.episodeCount}
                    onChange={(event) => setConfig({ ...config, episodeCount: Number(event.target.value) })}
                  />
                </label>
                {episodes.length > 1 && (
                  <label>
                    当前剧集
                    <select value={selectedEpisodeId} onChange={(event) => setSelectedEpisodeId(event.target.value)}>
                      {episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  单镜头
                  <input
                    type="number"
                    min={currentProvider?.capabilities.duration?.min ?? 3}
                    max={currentProvider?.capabilities.duration?.max ?? 15}
                    value={config.videoOptions.durationSeconds}
                    onChange={(event) => setConfig({
                      ...config,
                      videoOptions: { ...config.videoOptions, durationSeconds: Number(event.target.value), nativeAudio: false }
                    })}
                  />
                </label>
                <fieldset>
                  <legend>分辨率</legend>
                  <div className="segment">
                    {(['720p', '1080p'] as const).map((resolution) => (
                      <button
                        type="button"
                        key={resolution}
                        aria-pressed={config.videoOptions.resolution === resolution}
                        onClick={() => setConfig({
                          ...config,
                          videoOptions: { ...config.videoOptions, resolution, nativeAudio: false }
                        })}
                      >
                        {resolution}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>

              <section className="timelineSection">
                <div className="sectionTitle">
                  <h2>制作流程</h2>
                  {run && <span className="runCode">RUN {run.id.slice(0, 8)}</span>}
                </div>
                <ol className="workflowTimeline">
                  {workflowStages.map((stage, index) => {
                    const complete = run ? stage.ready(run) : false
                    const activeStage = run?.currentNode === stage.id
                      || (stage.id === 'character_reference' && run?.status === 'waiting_character_approval')
                      || (stage.id === 'storyboard_agent' && run?.status === 'waiting_storyboard_approval')
                    return (
                      <li key={stage.id} className={complete ? 'complete' : activeStage ? 'active' : ''}>
                        <span className="stageMarker">{complete ? <Check size={14} /> : index + 1}</span>
                        <span>{stage.label}</span>
                      </li>
                    )
                  })}
                </ol>
              </section>

              {run?.status === 'waiting_character_approval' && (
                <section className="approvalSection">
                  <div className="sectionTitle"><h2>确认角色参考图</h2><span>版本不会覆盖</span></div>
                  <div className="characterGrid">
                    {run.state?.characterBible?.characters.map((character) => {
                      const artifact = characterArtifacts.get(character.id)
                      return (
                        <article className="characterItem" key={character.id}>
                          {artifact ? <img src={api.artifactFileUrl(artifact.id)} alt={`${character.name}参考图`} /> : <div className="mediaPlaceholder" />}
                          <div><strong>{character.name}</strong><p>{character.appearance}</p></div>
                        </article>
                      )
                    })}
                  </div>
                  <ApprovalActions feedback={feedback} setFeedback={setFeedback} busy={busy} onApprove={() => void resume(true)} onReject={() => void resume(false)} />
                </section>
              )}

              {run?.status === 'waiting_storyboard_approval' && draftStoryboard && (
                <section className="approvalSection">
                  <div className="sectionTitle"><h2>确认分镜</h2><span>{draftStoryboard.shots.length} 个镜头</span></div>
                  <div className="shotList">
                    {draftStoryboard.shots.map((shot, index) => (
                      <article className="shotEditor" key={shot.id}>
                        <span className="shotIndex">{String(shot.index).padStart(2, '0')}</span>
                        <div className="shotFields">
                          <label>画面<input value={shot.visual} onChange={(event) => updateShot(index, { visual: event.target.value })} /></label>
                          <label>字幕<input value={shot.subtitle} onChange={(event) => updateShot(index, { subtitle: event.target.value })} /></label>
                          <label>关键帧提示词<textarea rows={3} value={shot.prompt} onChange={(event) => updateShot(index, { prompt: event.target.value })} /></label>
                          <label>动作提示词<textarea rows={3} value={shot.videoPrompt ?? ''} onChange={(event) => updateShot(index, { videoPrompt: event.target.value, videoPromptSource: 'manual' })} /></label>
                        </div>
                      </article>
                    ))}
                  </div>
                  <ApprovalActions feedback={feedback} setFeedback={setFeedback} busy={busy} onApprove={() => void resume(true, true)} onReject={() => void resume(false)} />
                </section>
              )}

              {run?.status === 'waiting_budget_approval' && (
                <section className="decisionBand warningBand">
                  <Clock3 size={20} />
                  <div><strong>Token 预算不足</strong><p>当前节点已暂停，追加预算后从 checkpoint 继续。</p></div>
                  <button className="primaryButton" disabled={busy} onClick={() => void addBudget()}>追加 50,000 Token</button>
                </section>
              )}

              {run?.status === 'waiting_human_review' && (
                <section className="approvalSection">
                  <div className="sectionTitle"><h2>人工审核成片</h2><span>静音 · 9:16</span></div>
                  {finalArtifact && <video className="finalPreview" controls muted playsInline src={api.artifactFileUrl(finalArtifact.id)} />}
                  {run.state?.reviewResult?.issues.map((issue) => <p className="issueText" key={issue}>{issue}</p>)}
                  <ApprovalActions feedback={feedback} setFeedback={setFeedback} busy={busy} onApprove={() => void resume(true)} onReject={() => void resume(false)} />
                </section>
              )}

              {run?.status === 'completed' && finalArtifact && (
                <section className="decisionBand successBand">
                  <Check size={20} />
                  <div><strong>成片已完成</strong><p>{run.state?.editResult?.outputPath}</p></div>
                  <a className="primaryButton" href={api.artifactFileUrl(finalArtifact.id)} download>
                    <Download size={16} />下载成片
                  </a>
                </section>
              )}
            </>
          )}
        </section>

        <aside className="runRail">
          <div className="sectionTitle"><h2>运行状态</h2><History size={16} /></div>
          {!run ? <p className="emptyText">尚未启动流程</p> : (
            <>
              <dl className="runMetrics">
                <div><dt>状态</dt><dd>{statusLabels[run.status]}</dd></div>
                <div><dt>下一节点</dt><dd>{run.currentNode ?? '—'}</dd></div>
                <div><dt>Token</dt><dd>{tokenUsed.toLocaleString()} / {run.budget.maxTokens.toLocaleString()}</dd></div>
                <div><dt>费用</dt><dd>{run.budget.usedCost.toFixed(2)} / {run.budget.maxCost.toFixed(2)}</dd></div>
                <div><dt>产物版本</dt><dd>{artifacts.length}</dd></div>
              </dl>
              {run.error && <div className="errorBox"><X size={16} /><span>{run.error}</span></div>}
              {!terminalStatuses.includes(run.status) && (
                <button className="dangerButton" disabled={busy} onClick={() => void cancelRun()}>
                  <CircleStop size={16} />取消流程
                </button>
              )}
              <div className="exportLinks">
                <a href={api.exportUrl(run.projectId, 'json')} target="_blank" rel="noreferrer">JSON</a>
                <a href={api.exportUrl(run.projectId, 'markdown')} target="_blank" rel="noreferrer">Markdown</a>
              </div>
              <div className="versionList">
                <h3>最近版本</h3>
                {artifacts.slice(0, 8).map((artifact) => (
                  <div key={artifact.id}>
                    <span>{artifact.kind} v{artifact.version}</span>
                    {artifact.status === 'current' ? <strong>当前</strong> : (
                      <button
                        className="iconButton"
                        title="回滚到此版本"
                        disabled={busy || !terminalStatuses.includes(run.status)}
                        onClick={() => void rollbackArtifact(artifact.id)}
                      >
                        <History size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  )
}

function ApprovalActions(props: {
  feedback: string
  setFeedback: (value: string) => void
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="approvalActions">
      <label>
        修改意见
        <textarea rows={2} value={props.feedback} onChange={(event) => props.setFeedback(event.target.value)} />
      </label>
      <div>
        <button className="secondaryButton" disabled={props.busy} onClick={props.onReject}><X size={16} />退回修改</button>
        <button className="primaryButton" disabled={props.busy} onClick={props.onApprove}><Check size={16} />确认继续</button>
      </div>
    </div>
  )
}
