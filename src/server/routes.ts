import { Router } from 'express'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProjectStore } from './services/projectStore'
import { generateStoryPackage } from './services/storyGenerator'
import { exportProjectJson, exportProjectMarkdown } from './services/exporters'
import { createVideoProvider } from './services/videoProviders'
import { VideoProviderNameSchema, type Project } from '../shared/schema'

export function createRoutes(dataDir: string) {
  const router = Router()
  const store = createProjectStore(dataDir)

  router.get('/projects', async (_req, res, next) => {
    try {
      res.json(await store.listProjects())
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects', async (req, res, next) => {
    try {
      const now = new Date().toISOString()
      const project: Project = {
        id: randomUUID(),
        name: String(req.body.name ?? '未命名项目'),
        sourceText: String(req.body.sourceText ?? ''),
        style: 'animation_drama',
        createdAt: now,
        updatedAt: now
      }
      res.status(201).json(await store.saveProject(project))
    } catch (error) {
      next(error)
    }
  })

  router.get('/projects/:id', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id)
      if (!project) return res.status(404).json({ message: '项目不存在' })
      res.json(project)
    } catch (error) {
      next(error)
    }
  })

  router.put('/projects/:id', async (req, res, next) => {
    try {
      const existing = await store.getProject(req.params.id)
      if (!existing) return res.status(404).json({ message: '项目不存在' })
      const updated: Project = { ...existing, ...req.body, id: existing.id, updatedAt: new Date().toISOString() }
      res.json(await store.saveProject(updated))
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:id/generate-story', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id)
      if (!project) return res.status(404).json({ message: '项目不存在' })
      const storyPackage = generateStoryPackage({ sourceText: project.sourceText, style: project.style })
      const updated = await store.saveProject({ ...project, storyPackage, updatedAt: new Date().toISOString() })
      res.json(updated)
    } catch (error) {
      next(error)
    }
  })

  router.get('/projects/:id/export/json', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id)
      if (!project) return res.status(404).json({ message: '项目不存在' })
      res.type('application/json').send(exportProjectJson(project))
    } catch (error) {
      next(error)
    }
  })

  router.get('/projects/:id/export/markdown', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id)
      if (!project) return res.status(404).json({ message: '项目不存在' })
      res.type('text/markdown').send(exportProjectMarkdown(project))
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:id/generate-video', async (req, res, next) => {
    try {
      const project = await store.getProject(req.params.id)
      if (!project) return res.status(404).json({ message: '项目不存在' })
      const providerName = VideoProviderNameSchema.parse(req.body.provider ?? 'mock')
      const ffmpegPath = process.env.FFMPEG_PATH
      const apiKey = process.env.OPENAI_API_KEY
      const provider = createVideoProvider(providerName, join(dataDir, 'outputs', project.id), ffmpegPath, apiKey)
      const result = await provider.generate({ project, provider: providerName, shotId: req.body.shotId })
      if (project.storyPackage) {
        const updatedById = new Map(result.updatedShots.map((shot) => [shot.id, shot]))
        const storyPackage = {
          ...project.storyPackage,
          shots: project.storyPackage.shots.map((shot) => updatedById.get(shot.id) ?? shot)
        }
        await store.saveProject({ ...project, storyPackage, updatedAt: new Date().toISOString() })
      }
      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}
