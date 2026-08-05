import { Inject, Injectable } from '@nestjs/common'
import { END, START, StateGraph } from '@langchain/langgraph'
import { CheckpointService } from '../persistence/persistence.service'
import { AgentNodesService } from './agent-nodes.service'
import { WorkflowAnnotation, type GraphState } from './workflow-state'

export const manualReviewNodes = [
  'story_analyzer',
  'director',
  'character',
  'plot',
  'scene',
  'production',
  'editing'
] as const

@Injectable()
export class WorkflowGraphService {
  readonly graph

  constructor(
    @Inject(AgentNodesService) nodes: AgentNodesService,
    @Inject(CheckpointService) checkpoints: CheckpointService
  ) {
    const retryPolicy = { maxAttempts: 2, initialInterval: 1000, backoffFactor: 2 }
    this.graph = new StateGraph(WorkflowAnnotation)
      .addNode('story_analyzer', nodes.storyAnalyzer.bind(nodes), { retryPolicy })
      .addNode('director', nodes.director.bind(nodes), { retryPolicy })
      .addNode('character', nodes.character.bind(nodes), { retryPolicy })
      .addNode('character_reference', nodes.characterReference.bind(nodes), { retryPolicy })
      .addNode('character_approval', nodes.characterApproval.bind(nodes))
      .addNode('plot', nodes.plot.bind(nodes), { retryPolicy })
      .addNode('scene', nodes.scene.bind(nodes), { retryPolicy })
      .addNode('storyboard_agent', nodes.storyboard.bind(nodes), { retryPolicy })
      .addNode('storyboard_approval', nodes.storyboardApproval.bind(nodes))
      .addNode('production', nodes.production.bind(nodes), { retryPolicy })
      .addNode('editing', nodes.editing.bind(nodes), { retryPolicy })
      .addNode('reviewer', nodes.reviewer.bind(nodes))
      .addNode('director_review', nodes.directorReview.bind(nodes))
      .addNode('human_review', nodes.humanReview.bind(nodes))
      .addEdge(START, 'story_analyzer')
      .addEdge('story_analyzer', 'director')
      .addEdge('director', 'character')
      .addEdge('character', 'character_reference')
      .addEdge('character_reference', 'character_approval')
      .addConditionalEdges('character_approval', (state: GraphState) => state.nextAction ?? 'character', {
        character: 'character',
        plot: 'plot'
      })
      .addEdge('plot', 'scene')
      .addEdge('scene', 'storyboard_agent')
      .addEdge('storyboard_agent', 'storyboard_approval')
      .addConditionalEdges('storyboard_approval', (state: GraphState) => state.nextAction ?? 'storyboard', {
        storyboard: 'storyboard_agent',
        production: 'production'
      })
      .addConditionalEdges('production', (state: GraphState) => {
        if (state.reviewResult?.targetNode !== 'production') return 'editing'
        return (state.revisionCount.production ?? 0) >= 2 ? 'human_review' : 'production'
      }, {
        production: 'production',
        editing: 'editing',
        human_review: 'human_review'
      })
      .addConditionalEdges('editing', (state: GraphState) => state.editResult && !state.reviewResult
        ? 'reviewer'
        : 'director_review', {
        reviewer: 'reviewer',
        director_review: 'director_review'
      })
      .addEdge('reviewer', 'director_review')
      .addConditionalEdges('director_review', (state: GraphState) => state.nextAction ?? 'human', {
        character: 'character',
        plot: 'plot',
        scene: 'scene',
        storyboard: 'storyboard_agent',
        production: 'production',
        editing: 'editing',
        human: 'human_review',
        end: END
      })
      .addConditionalEdges('human_review', (state: GraphState) => state.nextAction ?? 'human', {
        character: 'character',
        plot: 'plot',
        scene: 'scene',
        storyboard: 'storyboard_agent',
        production: 'production',
        editing: 'editing',
        end: END
      })
      .compile({ checkpointer: checkpoints.saver, interruptAfter: [...manualReviewNodes] })
  }
}
