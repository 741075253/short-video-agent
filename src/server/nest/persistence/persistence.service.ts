import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { DataSource } from 'typeorm'
import { persistenceConfig } from '../../config'
import { entities } from './entities'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private initialization: Promise<DataSource> | null = null

  readonly dataSource = new DataSource({
    type: 'postgres',
    url: persistenceConfig.databaseUrl,
    entities,
    synchronize: persistenceConfig.synchronize,
    logging: false
  })

  async onModuleInit(): Promise<void> {
    await this.ready()
  }

  ready(): Promise<DataSource> {
    if (!this.initialization) this.initialization = this.dataSource.initialize()
    return this.initialization
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy()
  }
}

@Injectable()
export class CheckpointService implements OnModuleInit, OnModuleDestroy {
  readonly saver = PostgresSaver.fromConnString(persistenceConfig.databaseUrl, {
    schema: 'langgraph'
  })

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.ready()
    await this.database.dataSource.query('CREATE SCHEMA IF NOT EXISTS langgraph')
    await this.saver.setup()
  }

  async onModuleDestroy(): Promise<void> {
    await this.saver.end()
  }
}
