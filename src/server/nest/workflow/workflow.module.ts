import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { RunEventsService } from '../runs/run-events.service'
import { RunsController } from '../runs/runs.controller'
import { RunsService } from '../runs/runs.service'
import { AgentNodesService } from './agent-nodes.service'
import { ArtifactService } from './artifact.service'
import { MediaProductionService } from './media-production.service'
import { ModelGateway } from './model-gateway.service'
import { ProvidersController } from './providers.controller'
import { WorkflowGraphService } from './workflow-graph.service'

@Module({
  imports: [ProjectsModule],
  controllers: [RunsController, ProvidersController],
  providers: [
    RunEventsService,
    RunsService,
    ArtifactService,
    ModelGateway,
    MediaProductionService,
    AgentNodesService,
    WorkflowGraphService
  ]
})
export class WorkflowModule {}
