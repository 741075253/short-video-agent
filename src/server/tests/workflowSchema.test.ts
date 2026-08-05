import { describe, expect, it } from 'vitest'
import {
  defaultProductionConfig,
  ProductionConfigSchema,
  RealVideoGenerationProviderNameSchema
} from '../../shared/schema'
import { WorkflowStateSchema } from '../../shared/workflow'

describe('workflow schema', () => {
  it('defaults to a real, silent, mobile video production configuration', () => {
    expect(defaultProductionConfig).toMatchObject({
      aspectRatio: '9:16',
      subtitleEnabled: true,
      narrationEnabled: false,
      videoProvider: 'happyhorse_i2v',
      videoOptions: {
        resolution: '1080p',
        nativeAudio: false
      }
    })
  })

  it('rejects mock providers and native audio in workflow runs', () => {
    expect(() => RealVideoGenerationProviderNameSchema.parse('mock')).toThrow()
    expect(() => ProductionConfigSchema.parse({
      videoProvider: 'kling',
      videoOptions: { durationSeconds: 5, resolution: '1080p', nativeAudio: true }
    })).toThrow()
  })

  it('accepts the minimum durable workflow state', () => {
    expect(WorkflowStateSchema.parse({
      runId: 'run-1',
      projectId: 'project-1',
      sourceText: '这是一个足够长度的短故事内容。',
      productionConfig: defaultProductionConfig,
      usageBudget: { maxTokens: 1000, maxCost: 10 },
      revisionCount: {},
      errors: []
    })).toMatchObject({
      runId: 'run-1',
      projectId: 'project-1'
    })
  })
})
