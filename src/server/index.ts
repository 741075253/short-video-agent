import { join } from 'node:path'
import { createApp } from './app'

const port = Number(process.env.PORT ?? 5174)
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')
const app = createApp({ dataDir })

app.listen(port, '127.0.0.1', () => {
  console.log(`short-video-agent API listening on http://127.0.0.1:${port}`)
})
