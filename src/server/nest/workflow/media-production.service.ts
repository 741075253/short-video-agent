import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import type { Project, Shot } from '../../../shared/schema'
import type { CharacterReference, WorkflowState } from '../../../shared/workflow'
import {
  persistenceConfig,
  resolveFfmpegPath
} from '../../config'
import { createImageProvider } from '../../services/imageProviders'
import { createVideoGenProvider } from '../../services/videoGenProviders'
import { createVideoProvider } from '../../services/videoProviders'
import { resolveImageModel, resolveVideoModel } from '../../services/modelCatalog'
import { ArtifactService } from './artifact.service'
import { ProjectsService } from '../projects/projects.service'

@Injectable()
export class MediaProductionService {
  constructor(
    @Inject(ArtifactService) private readonly artifacts: ArtifactService,
    @Inject(ProjectsService) private readonly projects: ProjectsService
  ) {}

  ensureConfigured(state: WorkflowState): void {
    const image = resolveImageModel(state.productionConfig.imageModel)
    if (!image.apiKey) throw new Error(`图片模型 ${image.id} 缺少环境变量 ${image.apiKeyEnv}`)
    const video = resolveVideoModel(state.productionConfig.videoProvider)
    if (!video.apiKey) throw new Error(`视频模型 ${video.id} 缺少环境变量 ${video.apiKeyEnv}`)
  }

  async generateCharacterReferences(state: WorkflowState): Promise<CharacterReference[]> {
    this.ensureConfigured(state)
    if (!state.characterBible) throw new Error('缺少角色设定')
    const image = resolveImageModel(state.productionConfig.imageModel)
    const provider = createImageProvider({
      adapter: image.adapter,
      apiKey: image.apiKey,
      baseUrl: image.baseUrl,
      model: image.model,
      size: image.size
    })
    if (!provider) throw new Error('未配置图片生成 API Key')

    const revision = (state.revisionCount.character ?? 0) + 1
    const outputDir = join(
      persistenceConfig.dataDir,
      'outputs',
      state.projectId,
      state.runId,
      'characters',
      `v${revision}`
    )
    await mkdir(outputDir, { recursive: true })

    const references: CharacterReference[] = []
    for (let index = 0; index < state.characterBible.characters.length; index++) {
      const character = state.characterBible.characters[index]
      const referenceInput = {
        character,
        imageModel: state.productionConfig.imageModel,
        aspectRatio: state.productionConfig.aspectRatio
      }
      const reusable = await this.artifacts.findReusable(
        state.projectId,
        'character_reference',
        character.id,
        referenceInput
      )
      if (reusable?.filePath && existsSync(reusable.filePath)) {
        references.push({
          characterId: character.id,
          version: reusable.version,
          imagePath: reusable.filePath,
          approved: false
        })
        continue
      }

      const shot: Shot = {
        id: `character-${character.id}-reference-v${revision}`,
        index: index + 1,
        durationSeconds: 5,
        sceneId: 'character-reference',
        characterIds: [character.id],
        visual: `${character.name}角色标准设定图`,
        action: '自然站立，正面全身展示',
        narration: '',
        subtitle: '',
        camera: '正面全身固定镜头',
        prompt: [
          character.referencePrompt,
          `外观：${character.appearance}`,
          `服装：${character.wardrobe}`,
          '单人角色标准设定图，正面全身，纯净背景，手机竖屏 9:16，主体位于中央安全区域',
          `禁止：${character.negativeConstraints.join('、')}`
        ].join('。'),
        videoPrompt: '',
        status: 'pending'
      }
      const imagePath = await provider.generateImage(shot, outputDir)
      const artifact = await this.artifacts.append({
        projectId: state.projectId,
        runId: state.runId,
        kind: 'character_reference',
        ownerId: character.id,
        input: referenceInput,
        data: { characterId: character.id, characterName: character.name },
        filePath: imagePath
      })
      references.push({
        characterId: character.id,
        version: artifact.version,
        imagePath,
        approved: false
      })
    }
    return references
  }

  async generateShots(state: WorkflowState): Promise<WorkflowState['generatedAssets']> {
    this.ensureConfigured(state)
    if (!state.storyboard) throw new Error('缺少分镜')
    const outputDir = join(persistenceConfig.dataDir, 'outputs', state.projectId, state.runId, 'shots')
    await mkdir(outputDir, { recursive: true })
    const previousShots = state.generatedAssets?.shots ?? state.storyboard.shots
    const previousById = new Map(previousShots.map((shot) => [shot.id, shot]))
    const requestedIds = state.reviewResult?.targetNode === 'production' && state.reviewResult.scopeIds.length > 0
      ? new Set(state.reviewResult.scopeIds)
      : new Set(state.storyboard.shots.map((shot) => shot.id))

    const image = resolveImageModel(state.productionConfig.imageModel)
    const imageProvider = createImageProvider({
      adapter: image.adapter,
      apiKey: image.apiKey,
      baseUrl: image.baseUrl,
      model: image.model,
      size: image.size
    })
    if (!imageProvider) throw new Error('未配置图片生成 API Key')

    const workingShots: Shot[] = []
    for (const sourceShot of state.storyboard.shots) {
      const previous = previousById.get(sourceShot.id)
      if (!requestedIds.has(sourceShot.id) && previous) {
        workingShots.push(previous)
        continue
      }
      const imageInput = {
        prompt: sourceShot.prompt,
        characterReferences: state.characterReferences,
        imageModel: state.productionConfig.imageModel
      }
      const reusable = await this.artifacts.findReusable(
        state.projectId,
        'shot_image',
        sourceShot.id,
        imageInput
      )
      let assetPath = reusable?.filePath && existsSync(reusable.filePath) ? reusable.filePath : undefined
      if (!assetPath) {
        assetPath = await imageProvider.generateImage(sourceShot, outputDir)
        await this.artifacts.append({
          projectId: state.projectId,
          runId: state.runId,
          kind: 'shot_image',
          ownerId: sourceShot.id,
          input: imageInput,
          data: { shotId: sourceShot.id },
          filePath: assetPath
        })
      }
      workingShots.push({
        ...sourceShot,
        assetPath,
        videoClipPath: previous?.videoClipPath,
        videoClipMetadata: previous?.videoClipMetadata,
        status: 'pending',
        errorMessage: undefined
      })
    }

    const targets = workingShots.filter((shot) => requestedIds.has(shot.id))
    const targetImages = targets.map((shot) => shot.assetPath ?? '')
    const provider = createVideoGenProvider(state.productionConfig.videoProvider)
    const toGenerate: Shot[] = []
    const toGenerateImages: string[] = []
    const reusableClips = new Map<string, string>()

    for (let index = 0; index < targets.length; index++) {
      const shot = targets[index]
      const videoInput = {
        prompt: shot.videoPrompt || shot.prompt,
        imagePath: targetImages[index],
        provider: state.productionConfig.videoProvider,
        options: state.productionConfig.videoOptions
      }
      const reusable = await this.artifacts.findReusable(state.projectId, 'shot_video', shot.id, videoInput)
      if (reusable?.filePath && existsSync(reusable.filePath)) {
        reusableClips.set(shot.id, reusable.filePath)
      } else {
        toGenerate.push(shot)
        toGenerateImages.push(targetImages[index])
      }
    }

    const result = toGenerate.length > 0
      ? await provider.generateClips(
          toGenerate,
          toGenerateImages,
          outputDir,
          { ...state.productionConfig.videoOptions, nativeAudio: false }
        )
      : { success: true as const, clips: [] }
    const clips = result.success ? result.clips : result.completed
    const failures = result.success ? [] : result.failures
    const clipById = new Map([...reusableClips, ...clips.map((clip) => [clip.shotId, clip.clipPath] as const)])
    const failureById = new Map(failures.map((failure) => [failure.shotId, failure.message]))

    for (const shot of targets) {
      const clipPath = clipById.get(shot.id)
      if (!clipPath || reusableClips.has(shot.id)) continue
      await this.artifacts.append({
        projectId: state.projectId,
        runId: state.runId,
        kind: 'shot_video',
        ownerId: shot.id,
        input: {
          prompt: shot.videoPrompt || shot.prompt,
          imagePath: shot.assetPath,
          provider: state.productionConfig.videoProvider,
          options: state.productionConfig.videoOptions
        },
        data: { shotId: shot.id, provider: state.productionConfig.videoProvider },
        filePath: clipPath
      })
    }

    const updatedShots = workingShots.map((shot) => {
      const failure = failureById.get(shot.id)
      const clipPath = clipById.get(shot.id)
      if (failure) return { ...shot, status: 'failed' as const, errorMessage: failure }
      if (clipPath) return { ...shot, videoClipPath: clipPath, status: 'ready' as const, errorMessage: undefined }
      return shot
    })
    return { outputDir, shots: updatedShots }
  }

  async edit(state: WorkflowState): Promise<{ outputPath: string }> {
    if (!state.storyboard || !state.generatedAssets) throw new Error('缺少视频制作结果')
    const failed = state.generatedAssets.shots.filter((shot) => shot.status !== 'ready' || !shot.videoClipPath)
    if (failed.length > 0) throw new Error(`仍有 ${failed.length} 个镜头未生成成功`)
    const project = await this.projects.get(state.projectId)
    const storyPackage = { ...state.storyboard, shots: state.generatedAssets.shots }
    const syntheticProject: Project = { ...project, storyPackage }
    const provider = createVideoProvider('local_ffmpeg', state.generatedAssets.outputDir, resolveFfmpegPath())
    const result = await provider.generate({ project: syntheticProject, provider: 'local_ffmpeg' })
    if (!result.outputPath || result.errors.length > 0) {
      throw new Error(result.errors[0]?.message ?? '剪辑合成失败')
    }
    await this.artifacts.append({
      projectId: state.projectId,
      runId: state.runId,
      kind: 'final_video',
      input: { shots: state.generatedAssets.shots, subtitleEnabled: true, audio: false },
      data: { shotCount: state.generatedAssets.shots.length },
      filePath: result.outputPath
    })
    await this.projects.saveWorkflowResult(state.projectId, {
      storyPackage,
      finalOutputPath: result.outputPath
    })
    return { outputPath: result.outputPath }
  }
}
