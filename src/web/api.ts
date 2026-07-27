import type { Project, VideoGenerateResult } from '../shared/schema'

const API_BASE = 'http://127.0.0.1:5174/api'

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
  listProjects: () => requestJson<Project[]>('/projects'),
  createProject: (input: { name: string; sourceText: string }) =>
    requestJson<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  getProject: (id: string) => requestJson<Project>(`/projects/${id}`),
  saveProject: (project: Project) =>
    requestJson<Project>(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) }),
  generateStory: (id: string) => requestJson<Project>(`/projects/${id}/generate-story`, { method: 'POST' }),
  generateVideo: (id: string, provider: 'mock' | 'local_ffmpeg' | 'dalle') =>
    requestJson<VideoGenerateResult>(`/projects/${id}/generate-video`, {
      method: 'POST',
      body: JSON.stringify({ provider })
    }),
  exportUrl: (id: string, format: 'json' | 'markdown') => `${API_BASE}/projects/${id}/export/${format}`
}
