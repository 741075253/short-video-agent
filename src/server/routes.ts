import { Router } from 'express'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createProjectStore } from './services/projectStore'
import { generateStoryPackage, upgradeShotVideoPrompt } from './services/storyGenerator'
import { exportProjectJson, exportProjectMarkdown } from './services/exporters'
import { createVideoProvider } from './services/videoProviders'
import { createVideoGenProvider } from './services/videoGenProviders'
import { createImageProvider } from './services/imageProviders'
import { resolveFfmpegPath } from './config'
import { canReuseVideoClip, createVideoClipMetadata } from './services/videoClipMetadata'
import {
  getVideoProviderDescriptor,
  listVideoProviderDescriptors,
  validateVideoGenerationOptions
} from './services/videoProviderRegistry'
import {
  defaultVideoGenerationOptions,
  VideoGenerationOptionsSchema,
  VideoGenerationProviderNameSchema,
  type Project,
  type Shot
} from '../shared/schema'

function mergeGeneratedShots(project: Project, updatedShots: Shot[]): Project {
  if (!project.storyPackage) return project
  const updatedById = new Map(updatedShots.map((shot) => [shot.id, shot]))
  return {
    ...project,
    storyPackage: {
      ...project.storyPackage,
      shots: project.storyPackage.shots.map((shot) => updatedById.get(shot.id) ?? shot)
    },
    updatedAt: new Date().toISOString()
  }
}

export function createRoutes(dataDir: string) {
  const router = Router()
  const store = createProjectStore(dataDir)

  router.get('/video-providers', (_req, res) => {
    res.json(listVideoProviderDescriptors())
  })

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
      const body = req.body ?? {}
      const providerName = VideoGenerationProviderNameSchema.parse(body.provider ?? 'mock')
      const options = VideoGenerationOptionsSchema.parse(body.options ?? defaultVideoGenerationOptions)
      validateVideoGenerationOptions(providerName, options)
      const providerDescriptor = getVideoProviderDescriptor(providerName)
      const shotId = body.shotId
      if (shotId !== undefined && typeof shotId !== 'string') {
        return res.status(400).json({ message: 'shotId 必须是字符串' })
      }

      const shots = project.storyPackage?.shots ?? []
      if (shots.length === 0) return res.status(400).json({ message: '请先生成分镜' })
      if (shotId && !shots.some((shot) => shot.id === shotId)) {
        return res.status(404).json({ message: '镜头不存在' })
      }
      if (body.retryFailedOnly !== undefined && typeof body.retryFailedOnly !== 'boolean') {
        return res.status(400).json({ message: 'retryFailedOnly 必须是布尔值' })
      }

      const outputDir = join(dataDir, 'outputs', project.id)
      const ffmpegPath = resolveFfmpegPath()

      if (providerName === 'mock') {
        const provider = createVideoProvider('mock', outputDir, ffmpegPath)
        const result = await provider.generate({ project, provider: 'mock', shotId })
        await store.saveProject(mergeGeneratedShots(project, result.updatedShots))
        return res.json(result)
      }

      if (providerDescriptor.capabilities.imageToVideo) {
        const requestedShots = shotId
          ? shots.filter((shot) => shot.id === shotId)
          : body.retryFailedOnly
            ? shots.filter((shot) => shot.status === 'failed')
            : shots
        if (requestedShots.length === 0) {
          return res.status(400).json({ message: '没有需要重试的失败分镜' })
        }

        const requestedIds = new Set(requestedShots.map((shot) => shot.id))
        let workingShots = shots.map((shot) => requestedIds.has(shot.id)
          ? upgradeShotVideoPrompt(shot)
          : shot)
        const missingImageShots = workingShots.filter((shot) =>
          requestedIds.has(shot.id) && (!shot.assetPath || !existsSync(shot.assetPath)))

        if (missingImageShots.length > 0) {
          const imageProvider = createImageProvider()
          if (!imageProvider) {
            return res.status(400).json({ message: '未配置图片生成 API Key，无法生成镜头画面' })
          }
          try {
            const imagePaths = imageProvider.generateImages
              ? await imageProvider.generateImages(missingImageShots, outputDir)
              : await Promise.all(missingImageShots.map((shot) => imageProvider.generateImage(shot, outputDir)))
            const imagePathById = new Map(missingImageShots.map((shot, index) => [shot.id, imagePaths[index]]))
            workingShots = shots.map((shot) => {
              const upgraded = requestedIds.has(shot.id) ? upgradeShotVideoPrompt(shot) : shot
              const imagePath = imagePathById.get(shot.id)
              return imagePath
                ? {
                    ...upgraded,
                    assetPath: imagePath,
                    videoClipPath: undefined,
                    videoClipMetadata: undefined,
                    errorMessage: undefined
                  }
                : upgraded
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : '图片生成失败'
            const missingIds = new Set(missingImageShots.map((shot) => shot.id))
            const failedShots = shots.map((shot) => missingIds.has(shot.id)
              ? { ...shot, status: 'failed' as const, assetPath: undefined, errorMessage: message }
              : shot
            )
            await store.saveProject(mergeGeneratedShots(project, failedShots))
            return res.status(502).json({
              message: `镜头生图失败：${message}`,
              errors: missingImageShots.map((shot) => ({ shotId: shot.id, message }))
            })
          }
        }

        const targetWorkingShots = workingShots.filter((shot) => requestedIds.has(shot.id))
        const imageInputs = targetWorkingShots.map((shot) => shot.assetPath!)
        const videoGenProvider = createVideoGenProvider(providerName)
        const expectedMetadata = await Promise.all(targetWorkingShots.map((shot, index) =>
          createVideoClipMetadata(
            shot,
            imageInputs[index],
            videoGenProvider.name,
            videoGenProvider.model,
            options
          )))
        const metadataById = new Map(targetWorkingShots.map((shot, index) => [shot.id, expectedMetadata[index]]))
        const generationShots = targetWorkingShots.filter((shot, index) =>
          !canReuseVideoClip(shot, expectedMetadata[index]))
        const generationImages = generationShots.map((shot) => shot.assetPath!)
        const clipResult = generationShots.length > 0
          ? await videoGenProvider.generateClips(
              generationShots,
              generationImages,
              outputDir,
              options
            )
          : { success: true as const, clips: [] }

        const generatedClips = clipResult.success ? clipResult.clips : clipResult.completed
        const failures = clipResult.success ? [] : clipResult.failures
        const failureById = new Map(failures.map((failure) => [failure.shotId, failure.message]))
        const clipPathById = new Map(generatedClips.map((clip) => [clip.shotId, clip.clipPath]))
        const clipShots = workingShots.map((shot) => {
          const failure = failureById.get(shot.id)
          const generatedClipPath = clipPathById.get(shot.id)
          const metadata = metadataById.get(shot.id)
          if (failure) {
            return { ...shot, status: 'failed' as const, errorMessage: failure }
          }
          if (generatedClipPath && metadata) {
            return {
              ...shot,
              videoClipPath: generatedClipPath,
              videoClipMetadata: metadata,
              status: 'ready' as const,
              errorMessage: undefined
            }
          }
          if (metadata && canReuseVideoClip(shot, metadata)) {
            return { ...shot, status: 'ready' as const, errorMessage: undefined }
          }
          return shot
        })
        const savedWithClips = await store.saveProject(mergeGeneratedShots(project, clipShots))
        const completed = targetWorkingShots
          .filter((shot) => {
            const updated = clipShots.find((candidate) => candidate.id === shot.id)
            return updated?.videoClipPath && !failureById.has(shot.id)
          })
          .map((shot) => ({
            shotId: shot.id,
            clipPath: clipShots.find((candidate) => candidate.id === shot.id)!.videoClipPath!
          }))

        if (failures.length > 0) {
          return res.json({
            provider: providerName,
            projectId: project.id,
            updatedShots: clipShots.filter((shot) => requestedIds.has(shot.id)),
            errors: failures,
            failures,
            completed
          })
        }

        const allShots = savedWithClips.storyPackage?.shots ?? []
        const allMetadata = await Promise.all(allShots.map((shot) =>
          createVideoClipMetadata(
            shot,
            shot.assetPath || '',
            videoGenProvider.name,
            videoGenProvider.model,
            options
          )))
        const allReady = allShots.length > 0 && allShots.every((shot, index) =>
          canReuseVideoClip(shot, allMetadata[index]))
        if (!allReady) {
          return res.json({
            provider: providerName,
            projectId: project.id,
            updatedShots: clipShots.filter((shot) => requestedIds.has(shot.id)),
            errors: [],
            completed
          })
        }

        const syntheticProject = {
          ...savedWithClips,
          storyPackage: savedWithClips.storyPackage && { ...savedWithClips.storyPackage, shots: allShots }
        }
        const result = await createVideoProvider('local_ffmpeg', outputDir, ffmpegPath).generate({
          project: syntheticProject,
          provider: 'local_ffmpeg'
        })
        await store.saveProject(mergeGeneratedShots(savedWithClips, result.updatedShots))
        return res.json({ ...result, provider: providerName, completed, failures: [] })
      }

      // local_ffmpeg：先生图（如已配置），再合成视频
      const imageProvider = createImageProvider()
      if (!imageProvider) {
        return res.status(400).json({ message: '未配置图片生成 API Key，无法生成镜头画面' })
      }

      const imageShots: typeof shots = []
      const targetImageShots = shotId ? shots.filter((shot) => shot.id === shotId) : shots
      try {
        const imagePaths = imageProvider.generateImages
          ? await imageProvider.generateImages(targetImageShots, outputDir)
          : await Promise.all(targetImageShots.map((shot) => imageProvider.generateImage(shot, outputDir)))
        const imagePathById = new Map(targetImageShots.map((shot, index) => [shot.id, imagePaths[index]]))
        imageShots.push(...shots.map((shot) => {
          const imagePath = imagePathById.get(shot.id)
          return imagePath
            ? {
                ...shot,
                status: 'ready' as const,
                assetPath: imagePath,
                videoClipPath: undefined,
                videoClipMetadata: undefined,
                errorMessage: undefined
              }
            : shot
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片生成失败'
        const targetIds = new Set(targetImageShots.map((shot) => shot.id))
        imageShots.push(...shots.map((shot) => targetIds.has(shot.id)
          ? { ...shot, status: 'failed' as const, assetPath: undefined, errorMessage: message }
          : shot
        ))
        await store.saveProject(mergeGeneratedShots(project, imageShots))
        return res.status(502).json({
          message: `镜头生图失败：${message}`,
          errors: targetImageShots.map((shot) => ({ shotId: shot.id, message }))
        })
      }

      const videoProvider = createVideoProvider('local_ffmpeg', outputDir, ffmpegPath)
      const syntheticProject = {
        ...project,
        storyPackage: project.storyPackage && { ...project.storyPackage, shots: imageShots },
      }
      const result = await videoProvider.generate({
        project: syntheticProject,
        provider: 'local_ffmpeg',
        shotId,
      })
      await store.saveProject(mergeGeneratedShots(project, result.updatedShots))
      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}
