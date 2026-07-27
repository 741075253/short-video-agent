import express from 'express'
import cors from 'cors'
import { createRoutes } from './routes'

export function createApp(options: { dataDir: string }) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', createRoutes(options.dataDir))
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : '未知错误'
    res.status(400).json({ message })
  })
  return app
}
