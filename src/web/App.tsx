import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Download,
  FileText,
  Film,
  FolderOpen,
  History,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  StepForward,
  X
} from 'lucide-react'
import {
  defaultProductionConfig,
  type ModelCatalogResponse,
  type ProductionConfig,
  type Project,
  type StoryPackage
} from '../shared/schema'
import type { ArtifactVersion, Episode, RunStatus, WorkflowRun, WorkflowState } from '../shared/workflow'
import { api } from './api'

const terminalStatuses: RunStatus[] = ['completed', 'failed', 'cancelled']

const statusLabels: Record<RunStatus, string> = {
  queued: '等待执行',
  running: '正在执行',
  waiting_step_review: '等待继续',
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

const workflowNodeLabels: Record<string, string> = Object.fromEntries(
  workflowStages.map((stage) => [stage.id, stage.label])
)
workflowNodeLabels.character_approval = '确认角色参考图'
workflowNodeLabels.storyboard_approval = '确认分镜'
workflowNodeLabels.director_review = '导演复核'
workflowNodeLabels.human_review = '人工审核'

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
  const resumableFailedRun = run?.status === 'failed' && Boolean(run.state) && Boolean(run.currentNode)
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
    setName(project.name)
    setSourceText(project.sourceText)
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
      const saved = await api.saveProject({ ...current, name, sourceText, productionConfig: config })
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
      const saved = await api.saveProject({ ...current, name, sourceText, productionConfig: config })
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
      const reviewingStep = run.status === 'waiting_step_review'
      const recoveringFailedRun = run.status === 'failed'
      await api.resumeRun(run.id, {
        approved,
        feedback: feedback || undefined,
        storyboard: includeStoryboard ? draftStoryboard ?? undefined : undefined
      })
      setFeedback('')
      setDraftStoryboard(null)
      await refreshRun(run.id)
      setMessage(recoveringFailedRun ? '已从上次进度继续执行' : reviewingStep ? '已开始执行下一步' : approved ? '已确认，流程继续执行' : '已提交返工意见')
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

  function beginNewProject() {
    setCurrent(null)
    setRun(null)
    setArtifacts([])
    setEpisodes([])
    setSelectedEpisodeId('')
    setName('我的短剧')
    setSourceText('')
    setConfig({ ...defaultProductionConfig, ...modelCatalog?.defaults })
    setFeedback('')
    setDraftStoryboard(null)
    setMessage('')
  }

  const completedNode = typeof run?.interrupt?.completedNode === 'string'
    ? run.interrupt.completedNode
    : [...workflowStages].reverse().find((stage) => run && stage.ready(run))?.id
  const nextNode = typeof run?.interrupt?.nextNode === 'string' ? run.interrupt.nextNode : run?.currentNode

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
            <div className="sectionTitle">
              <h2>{current ? '项目内容' : '新项目'}</h2>
              {current && (
                <button className="iconButton" title="新建项目" onClick={beginNewProject}>
                  <Plus size={16} />
                </button>
              )}
            </div>
            <label>
              名称
              <input disabled={Boolean(active)} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              故事内容
              <textarea disabled={Boolean(active)} value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={7} />
            </label>
            {current ? (
              <button className="primaryButton" disabled={busy || Boolean(active) || sourceText.trim().length < 10} onClick={() => void saveProject()}>
                <Save size={16} />保存内容
              </button>
            ) : (
              <button className="primaryButton" disabled={busy || sourceText.trim().length < 10} onClick={() => void createProject()}>
                <Sparkles size={16} />创建项目
              </button>
            )}
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
                  <h1>{name}</h1>
                </div>
                <div className="headerActions">
                  <button className="secondaryButton" disabled={busy || Boolean(active) || sourceText.trim().length < 10} onClick={() => void saveProject()}>
                    <Save size={16} />保存
                  </button>
                  <button className="primaryButton" disabled={busy || Boolean(active) || sourceText.trim().length < 10} onClick={() => void startRun()}>
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

              {run?.state && <WorkflowResults state={run.state} activeNode={completedNode} />}

              {run?.status === 'waiting_step_review' && (
                <section className="decisionBand stepBand">
                  <StepForward size={20} />
                  <div>
                    <strong>{completedNode ? `${workflowNodeLabels[completedNode] ?? completedNode}已生成` : '本步骤已完成'}</strong>
                    <p>检查上方产物后，再决定是否执行下一步。未点击时不会调用后续模型。</p>
                  </div>
                  <button className="primaryButton" disabled={busy} onClick={() => void resume(true)}>
                    <Play size={16} />执行下一步：{nextNode ? workflowNodeLabels[nextNode] ?? nextNode : '继续'}
                  </button>
                </section>
              )}

              {resumableFailedRun && (
                <section className="decisionBand warningBand">
                  <StepForward size={20} />
                  <div>
                    <strong>流程已保存到 {nextNode ? workflowNodeLabels[nextNode] ?? nextNode : '当前节点'}</strong>
                    <p>上次执行中断后保留了节点状态，可直接从这里继续，不需要重新运行已完成步骤。</p>
                  </div>
                  <button className="primaryButton" disabled={busy} onClick={() => void resume(true)}>
                    <Play size={16} />继续执行：{nextNode ? workflowNodeLabels[nextNode] ?? nextNode : '恢复流程'}
                  </button>
                </section>
              )}

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

function WorkflowResults({ state, activeNode }: { state: WorkflowState; activeNode?: string | null }) {
  const resultCount = [
    state.storyAnalysis,
    state.directorPlan,
    state.characterBible,
    state.plotOutline,
    state.sceneBible,
    state.storyboard,
    state.generatedAssets,
    state.editResult
  ].filter(Boolean).length

  if (resultCount === 0) return null

  return (
    <section className="resultsSection">
      <div className="sectionTitle resultsHeading">
        <h2><FileText size={16} />步骤产物</h2>
        <span>{resultCount} 份</span>
      </div>
      <div className="resultStack">
        {state.storyAnalysis && (
          <ResultBlock id="story_analyzer" title="故事理解" activeNode={activeNode}>
            <p className="resultLead">{state.storyAnalysis.summary}</p>
            <div className="resultGrid">
              <ResultGroup title="人物">
                <ul>{state.storyAnalysis.characters.map((item) => <li key={item.name}><strong>{item.name}</strong>：{item.description}</li>)}</ul>
              </ResultGroup>
              <ResultGroup title="地点">
                <p>{state.storyAnalysis.locations.join('、') || '无'}</p>
              </ResultGroup>
              <ResultGroup title="原文事实">
                <ul>{state.storyAnalysis.facts.map((item, index) => <li key={`${item.sourceRange}-${index}`}>{item.text}<small>{item.sourceRange}</small></li>)}</ul>
              </ResultGroup>
              <ResultGroup title="事件顺序">
                <ol>{state.storyAnalysis.events.map((item) => <li key={item.order}>{item.description}<small>{item.characterNames.join('、')}</small></li>)}</ol>
              </ResultGroup>
              <ResultGroup title="核心冲突">
                <ul>{state.storyAnalysis.conflicts.map((item) => <li key={item}>{item}</li>)}</ul>
              </ResultGroup>
            </div>
          </ResultBlock>
        )}

        {state.directorPlan && (
          <ResultBlock id="director" title="导演规划" activeNode={activeNode}>
            <div className="resultGrid resultGridFour">
              <ResultDatum label="受众" value={state.directorPlan.audience} />
              <ResultDatum label="基调" value={state.directorPlan.tone} />
              <ResultDatum label="节奏" value={state.directorPlan.pacing} />
              <ResultDatum label="视觉方向" value={state.directorPlan.visualDirection} />
            </div>
            <ResultGroup title="改编目标"><ul>{state.directorPlan.adaptationGoals.map((item) => <li key={item}>{item}</li>)}</ul></ResultGroup>
            <ResultGroup title="分集计划">
              <ol>{state.directorPlan.episodeSummaries.map((item) => <li key={item.episode}>第 {item.episode} 集：{item.summary}<small>{item.targetDurationSeconds} 秒</small></li>)}</ol>
            </ResultGroup>
          </ResultBlock>
        )}

        {state.characterBible && (
          <ResultBlock id="character" title="角色设定" activeNode={activeNode} count={state.characterBible.characters.length}>
            <div className="resultRecords">
              {state.characterBible.characters.map((character) => (
                <div className="resultRecord" key={character.id}>
                  <div className="resultRecordTitle"><strong>{character.name}</strong><code>{character.id}</code></div>
                  <p>{character.description}</p>
                  <dl className="resultInlineData">
                    <div><dt>外观</dt><dd>{character.appearance}</dd></div>
                    <div><dt>性格</dt><dd>{character.personality}</dd></div>
                    <div><dt>服装</dt><dd>{character.wardrobe}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </ResultBlock>
        )}

        {state.plotOutline && (
          <ResultBlock id="plot" title="剧情拆分" activeNode={activeNode} count={state.plotOutline.beats.length}>
            <p className="resultLead">{state.plotOutline.premise}</p>
            <ol className="numberedResults">
              {state.plotOutline.beats.map((beat) => (
                <li key={beat.id}><span>{String(beat.order).padStart(2, '0')}</span><div><strong>{beat.title}</strong><p>{beat.description}</p><small>{beat.dramaticPurpose}</small></div></li>
              ))}
            </ol>
            <div className="resultGrid">
              <ResultDatum label="高潮" value={state.plotOutline.climax} />
              <ResultDatum label="结局" value={state.plotOutline.ending} />
            </div>
          </ResultBlock>
        )}

        {state.sceneBible && (
          <ResultBlock id="scene" title="场景设计" activeNode={activeNode} count={state.sceneBible.scenes.length}>
            <ResultGroup title="世界规则"><ul>{state.sceneBible.worldRules.map((item) => <li key={item}>{item}</li>)}</ul></ResultGroup>
            <div className="resultRecords">
              {state.sceneBible.scenes.map((scene) => (
                <div className="resultRecord" key={scene.id}>
                  <div className="resultRecordTitle"><strong>{scene.name}</strong><code>{scene.id}</code></div>
                  <p>{scene.description}</p>
                  <small>{scene.time} · {scene.lighting}</small>
                </div>
              ))}
            </div>
          </ResultBlock>
        )}

        {state.storyboard && (
          <ResultBlock id="storyboard_agent" title="分镜" activeNode={activeNode} count={state.storyboard.shots.length}>
            <p className="resultLead">{state.storyboard.summary}</p>
            <ol className="numberedResults shotResults">
              {state.storyboard.shots.map((shot) => (
                <li key={shot.id}><span>{String(shot.index).padStart(2, '0')}</span><div><strong>{shot.visual}</strong><p>{shot.action}</p><small>{shot.camera} · {shot.durationSeconds} 秒 · 字幕：{shot.subtitle || '无'}</small></div></li>
              ))}
            </ol>
          </ResultBlock>
        )}

        {state.generatedAssets && (
          <ResultBlock id="production" title="视频制作" activeNode={activeNode} count={state.generatedAssets.shots.length}>
            <ul className="assetResults">
              {state.generatedAssets.shots.map((shot) => (
                <li key={shot.id}><span>镜头 {String(shot.index).padStart(2, '0')}</span><strong className={`assetStatus asset-${shot.status}`}>{shot.status === 'ready' ? '已完成' : shot.status === 'failed' ? '失败' : shot.status === 'generating' ? '生成中' : '待生成'}</strong></li>
              ))}
            </ul>
          </ResultBlock>
        )}

        {state.editResult && (
          <ResultBlock id="editing" title="剪辑合成" activeNode={activeNode}>
            <ResultDatum label="成片文件" value={state.editResult.outputPath} />
          </ResultBlock>
        )}
      </div>
    </section>
  )
}

function ResultBlock(props: {
  id: string
  title: string
  activeNode?: string | null
  count?: number
  children: ReactNode
}) {
  return (
    <details className="resultBlock" open={props.activeNode === props.id}>
      <summary><span>{props.title}</span>{props.count !== undefined && <small>{props.count} 项</small>}</summary>
      <div className="resultBody">{props.children}</div>
    </details>
  )
}

function ResultGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="resultGroup"><h3>{title}</h3>{children}</section>
}

function ResultDatum({ label, value }: { label: string; value: string }) {
  return <div className="resultDatum"><span>{label}</span><p>{value}</p></div>
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
