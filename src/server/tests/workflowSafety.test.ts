import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultProductionConfig } from '../../shared/schema'
import { defaultUsageBudget, type WorkflowState } from '../../shared/workflow'
import { RunsService } from '../nest/runs/runs.service'
import { AgentNodesService } from '../nest/workflow/agent-nodes.service'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function baseState(): WorkflowState {
  return {
    runId: 'run-1',
    projectId: 'project-1',
    sourceText: '这是一个长度足够的测试故事内容。',
    productionConfig: defaultProductionConfig,
    revisionCount: {},
    usageBudget: defaultUsageBudget,
    errors: []
  }
}

describe('workflow safety', () => {
  it('clears stale downstream state after an upstream rollback', () => {
    const state: WorkflowState = {
      ...baseState(),
      storyboard: { summary: '旧分镜', characters: [], scenes: [], shots: [] },
      generatedAssets: { outputDir: 'old', shots: [] },
      editResult: { outputPath: 'old.mp4' },
      reviewResult: { passed: true, scopeIds: [], issues: [], severity: 'info' }
    }
    const service = Object.create(RunsService.prototype) as unknown as {
      clearDownstreamState(state: WorkflowState, kind: string, ownerId: string | null): void
    }

    service.clearDownstreamState(state, 'storyboard', null)

    expect(state.storyboard).toBeDefined()
    expect(state.generatedAssets).toBeUndefined()
    expect(state.editResult).toBeUndefined()
    expect(state.reviewResult).toBeUndefined()
  })

  it('requires human review when deterministic checks pass', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'short-video-review-'))
    const outputPath = join(tempDir, 'final.mp4')
    await writeFile(outputPath, 'video')
    const recordReview = vi.fn()
    const nodes = new AgentNodesService(
      {} as never,
      { recordReview } as never,
      {} as never
    )
    const state = {
      ...baseState(),
      generatedAssets: {
        outputDir: tempDir,
        shots: [{
          id: 'shot-1',
          index: 1,
          durationSeconds: 5,
          sceneId: 'scene-1',
          characterIds: [],
          visual: '测试画面',
          action: '测试动作',
          narration: '',
          subtitle: '测试字幕',
          camera: '固定镜头',
          prompt: 'test',
          status: 'ready' as const,
          videoClipPath: 'shot-1.mp4'
        }]
      },
      editResult: { outputPath }
    }

    const result = await nodes.reviewer(state as never)

    expect(result.reviewResult).toMatchObject({ passed: false, severity: 'warning' })
    expect(result.reviewResult?.issues[0]).toContain('人工确认')
    expect(recordReview).toHaveBeenCalledOnce()
  })
})
