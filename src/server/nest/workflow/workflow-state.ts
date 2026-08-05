import { Annotation } from '@langchain/langgraph'
import type { WorkflowState } from '../../../shared/workflow'

export const WorkflowAnnotation = Annotation.Root({
  runId: Annotation<WorkflowState['runId']>(),
  projectId: Annotation<WorkflowState['projectId']>(),
  episodeId: Annotation<WorkflowState['episodeId']>(),
  episodeNumber: Annotation<WorkflowState['episodeNumber']>(),
  sourceText: Annotation<WorkflowState['sourceText']>(),
  productionConfig: Annotation<WorkflowState['productionConfig']>(),
  storyAnalysis: Annotation<WorkflowState['storyAnalysis']>(),
  directorPlan: Annotation<WorkflowState['directorPlan']>(),
  characterBible: Annotation<WorkflowState['characterBible']>(),
  characterReferences: Annotation<WorkflowState['characterReferences']>(),
  plotOutline: Annotation<WorkflowState['plotOutline']>(),
  sceneBible: Annotation<WorkflowState['sceneBible']>(),
  storyboard: Annotation<WorkflowState['storyboard']>(),
  generatedAssets: Annotation<WorkflowState['generatedAssets']>(),
  editResult: Annotation<WorkflowState['editResult']>(),
  reviewResult: Annotation<WorkflowState['reviewResult']>(),
  nextAction: Annotation<WorkflowState['nextAction']>(),
  revisionCount: Annotation<WorkflowState['revisionCount']>(),
  usageBudget: Annotation<WorkflowState['usageBudget']>(),
  humanFeedback: Annotation<WorkflowState['humanFeedback']>(),
  errors: Annotation<WorkflowState['errors']>()
})

export type GraphState = typeof WorkflowAnnotation.State
