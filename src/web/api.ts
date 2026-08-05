import type {
  ModelCatalogResponse,
  Project,
  VideoProviderDescriptor
} from '../shared/schema'
import type {
  ArtifactVersion,
  Episode,
  ResumeRunInput,
  StartRunInput,
  WorkflowRun
} from '../shared/workflow'

const viteEnv = (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env
const API_BASE = viteEnv?.VITE_API_BASE ?? 'http://127.0.0.1:5174/api'

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(body.message ?? response.statusText)
  }
  return response.json() as Promise<T>
}

export const api = {
  listModels: () => requestJson<ModelCatalogResponse>('/models'),
  listVideoProviders: () => requestJson<VideoProviderDescriptor[]>('/video-providers'),
  listProjects: () => requestJson<Project[]>('/projects'),
  createProject: (input: { name: string; sourceText: string; productionConfig?: Project['productionConfig'] }) =>
    requestJson<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  getProject: (id: string) => requestJson<Project>(`/projects/${id}`),
  saveProject: (project: Project) =>
    requestJson<Project>(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) }),
  listRuns: (projectId: string) => requestJson<WorkflowRun[]>(`/projects/${projectId}/runs`),
  listEpisodes: (projectId: string) => requestJson<Episode[]>(`/projects/${projectId}/episodes`),
  startRun: (projectId: string, input: StartRunInput) =>
    requestJson<WorkflowRun>(`/projects/${projectId}/runs`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  getRun: (id: string) => requestJson<WorkflowRun>(`/runs/${id}`),
  resumeRun: (id: string, input: ResumeRunInput) =>
    requestJson<WorkflowRun>(`/runs/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  cancelRun: (id: string) => requestJson<WorkflowRun>(`/runs/${id}/cancel`, { method: 'POST' }),
  listArtifacts: (runId: string) => requestJson<ArtifactVersion[]>(`/runs/${runId}/artifacts`),
  rollbackArtifact: (runId: string, artifactId: string) =>
    requestJson<ArtifactVersion>(`/runs/${runId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ artifactId })
    }),
  artifactFileUrl: (artifactId: string) => `${API_BASE}/artifacts/${artifactId}/file`,
  subscribeToRun: (runId: string, onEvent: () => void) => {
    const source = new EventSource(`${API_BASE}/runs/${runId}/events`)
    const eventTypes = [
      'run.started',
      'node.completed',
      'run.interrupted',
      'run.completed',
      'run.cancelled',
      'run.failed'
    ]
    eventTypes.forEach((type) => source.addEventListener(type, onEvent))
    source.onerror = onEvent
    return () => source.close()
  },
  exportUrl: (id: string, format: 'json' | 'markdown') => `${API_BASE}/projects/${id}/export/${format}`
}
