import { Module } from '@nestjs/common'
import { PersistenceModule } from './persistence/persistence.module'
import { ProjectsModule } from './projects/projects.module'
import { WorkflowModule } from './workflow/workflow.module'

@Module({
  imports: [PersistenceModule, ProjectsModule, WorkflowModule]
})
export class AppModule {}
