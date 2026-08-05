import { Global, Module } from '@nestjs/common'
import { CheckpointService, DatabaseService } from './persistence.service'

@Global()
@Module({
  providers: [DatabaseService, CheckpointService],
  exports: [DatabaseService, CheckpointService]
})
export class PersistenceModule {}
