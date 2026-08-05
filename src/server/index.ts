import 'reflect-metadata'
import { json } from 'express'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './nest/app.module'

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 5174)
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.use(json({ limit: '10mb' }))
  app.setGlobalPrefix('api')
  app.enableCors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] })
  app.enableShutdownHooks()
  await app.listen(port, '127.0.0.1')
  console.log(`short-video-agent API listening on http://127.0.0.1:${port}`)
}

void bootstrap()
