import { MemorySaver } from '@langchain/langgraph'
import { describe, expect, it, vi } from 'vitest'
import type { AgentNodesService } from '../nest/workflow/agent-nodes.service'
import { WorkflowGraphService } from '../nest/workflow/workflow-graph.service'
import { defaultProductionConfig } from '../../shared/schema'
import { defaultUsageBudget, WorkflowStateSchema } from '../../shared/workflow'

describe('workflow graph', () => {
  it('compiles the complete durable workflow with current LangGraph APIs', () => {
    const node = vi.fn(async () => ({}))
    const nodes = {
      storyAnalyzer: node,
      director: node,
      character: node,
      characterReference: node,
      characterApproval: node,
      plot: node,
      scene: node,
      storyboard: node,
      storyboardApproval: node,
      production: node,
      editing: node,
      reviewer: node,
      directorReview: node,
      humanReview: node
    } as unknown as AgentNodesService
    const graph = new WorkflowGraphService(nodes, { saver: new MemorySaver() } as never)

    expect(graph.graph).toBeDefined()
    expect(Object.keys(graph.graph.getGraph().nodes)).toEqual(expect.arrayContaining([
      'story_analyzer',
      'director',
      'character',
      'character_reference',
      'character_approval',
      'plot',
      'scene',
      'storyboard_agent',
      'storyboard_approval',
      'production',
      'editing',
      'reviewer',
      'director_review',
      'human_review'
    ]))
  })

  it('streams the complete initial workflow state before node updates', async () => {
    const pass = vi.fn(async () => ({}))
    const nodes = {
      storyAnalyzer: pass,
      director: pass,
      character: pass,
      characterReference: pass,
      characterApproval: vi.fn(async () => ({ nextAction: 'plot' })),
      plot: pass,
      scene: pass,
      storyboard: pass,
      storyboardApproval: vi.fn(async () => ({ nextAction: 'production' })),
      production: pass,
      editing: vi.fn(async () => ({ editResult: { outputPath: 'final.mp4' } })),
      reviewer: pass,
      directorReview: vi.fn(async () => ({ nextAction: 'end' })),
      humanReview: pass
    } as unknown as AgentNodesService
    const graph = new WorkflowGraphService(nodes, { saver: new MemorySaver() } as never).graph
    const initialState = WorkflowStateSchema.parse({
      runId: 'run-1',
      projectId: 'project-1',
      sourceText: '这是一个长度足够的测试故事内容。',
      productionConfig: defaultProductionConfig,
      usageBudget: defaultUsageBudget,
      revisionCount: {},
      errors: []
    })

    const stream = await graph.stream(initialState as never, {
      configurable: { thread_id: 'thread-1' },
      streamMode: 'values',
      durability: 'sync'
    } as never)
    const first = await stream.next()

    expect(first.done).toBe(false)
    expect(WorkflowStateSchema.parse(first.value)).toMatchObject({
      runId: 'run-1',
      projectId: 'project-1',
      sourceText: initialState.sourceText
    })
    const snapshot = await graph.getState({ configurable: { thread_id: 'thread-1' } })
    expect(WorkflowStateSchema.parse(snapshot.values).runId).toBe('run-1')
    await stream.return?.()
  })

  it('pauses after each manual step and resumes without rerunning it', async () => {
    const storyAnalyzer = vi.fn(async () => ({
      storyAnalysis: {
        summary: '摘要',
        facts: [],
        characters: [{ name: '甲', description: '主角' }],
        locations: [],
        events: [{ order: 1, description: '事件', characterNames: ['甲'] }],
        conflicts: []
      }
    }))
    const director = vi.fn(async () => ({
      directorPlan: {
        audience: '大众',
        tone: '紧张',
        pacing: '紧凑',
        visualDirection: '竖屏动画',
        adaptationGoals: ['保留主线'],
        episodeSummaries: [{ episode: 1, summary: '单集', targetDurationSeconds: 60 }]
      }
    }))
    const pass = vi.fn(async () => ({}))
    const nodes = {
      storyAnalyzer,
      director,
      character: pass,
      characterReference: pass,
      characterApproval: pass,
      plot: pass,
      scene: pass,
      storyboard: pass,
      storyboardApproval: pass,
      production: pass,
      editing: pass,
      reviewer: pass,
      directorReview: pass,
      humanReview: pass
    } as unknown as AgentNodesService
    const graph = new WorkflowGraphService(nodes, { saver: new MemorySaver() } as never).graph
    const config = { configurable: { thread_id: 'manual-steps' }, streamMode: 'values' as const }
    const initialState = WorkflowStateSchema.parse({
      runId: 'run-steps',
      projectId: 'project-steps',
      sourceText: '这是一个长度足够的测试故事内容。',
      productionConfig: defaultProductionConfig,
      usageBudget: defaultUsageBudget,
      revisionCount: {},
      errors: []
    })

    for await (const _ of await graph.stream(initialState as never, config)) void _
    let snapshot = await graph.getState(config)
    expect(snapshot.next).toEqual(['director'])
    expect(storyAnalyzer).toHaveBeenCalledTimes(1)
    expect(director).not.toHaveBeenCalled()

    for await (const _ of await graph.stream(null, config)) void _
    snapshot = await graph.getState(config)
    expect(snapshot.next).toEqual(['character'])
    expect(storyAnalyzer).toHaveBeenCalledTimes(1)
    expect(director).toHaveBeenCalledTimes(1)
  })
})
