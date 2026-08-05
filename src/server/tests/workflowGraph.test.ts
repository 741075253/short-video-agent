import { MemorySaver } from '@langchain/langgraph'
import { describe, expect, it, vi } from 'vitest'
import type { AgentNodesService } from '../nest/workflow/agent-nodes.service'
import { WorkflowGraphService } from '../nest/workflow/workflow-graph.service'

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
})
