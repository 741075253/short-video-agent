import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HappyHorseConfigSchema, KlingConfigSchema } from '../shared/schema'

// ========== .env 文件加载（优先级最低，不会覆盖已有环境变量） ==========

function loadEnvFile(): void {
  try {
    const envPath = join(process.cwd(), '.env')
    if (!existsSync(envPath)) return
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch { /* ignore */ }
}

loadEnvFile()

// ========== 配置读取顺序：环境变量 > .env 文件 > 默认值 ==========

/** ffmpeg 配置 */
export const ffmpegConfig = {
  /** 候选便携版路径（自动探测） */
  searchPaths: [
    'E:/workspace/tools/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe',
    'E:/workspace/tools/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe',
  ],
  /** 回退命令（依赖系统 PATH） */
  fallback: 'ffmpeg' as const,
}

const qianWenApiKey = process.env.QIAN_WEN_API_KEY?.trim() || process.env.qian_wen_api_key?.trim() || ''
const qianWenBaseUrl = process.env.QIAN_WEN_BASE_URL || 'https://dashscope.aliyuncs.com'

export const textGenConfig = {
  apiKey: process.env.TEXT_API_KEY || qianWenApiKey,
  baseUrl: process.env.TEXT_GEN_BASE_URL || `${qianWenBaseUrl}/compatible-mode/v1`,
  model: process.env.TEXT_GEN_MODEL || 'qwen3.8-max'
}

export const modelBudgetConfig = {
  inputCostPerThousand: Number(process.env.TEXT_INPUT_COST_PER_1K || 0),
  outputCostPerThousand: Number(process.env.TEXT_OUTPUT_COST_PER_1K || 0)
}

/** 图片生成配置（兼容 OpenAI API 与百炼原生 API） */
export const imageGenConfig = {
  apiKey: process.env.IMAGE_API_KEY || process.env.IMAGE_GEN_API_KEY || qianWenApiKey,
  baseUrl: process.env.IMAGE_GEN_BASE_URL || qianWenBaseUrl,
  model: process.env.IMAGE_GEN_MODEL || 'wan2.7-image-pro',
  size: process.env.IMAGE_GEN_SIZE || '1024x1792',
}

/** HappyHorse 视频生成配置 */
export const happyHorseConfig = HappyHorseConfigSchema.parse({
  apiKey: process.env.VIDEO_API_KEY || qianWenApiKey,
  baseUrl: process.env.HAPPYHORSE_BASE_URL || qianWenBaseUrl,
  model: process.env.HAPPYHORSE_MODEL || 'happyhorse-1.1-i2v',
  concurrency: process.env.HAPPYHORSE_CONCURRENCY || '3',
  pollIntervalMs: process.env.HAPPYHORSE_POLL_INTERVAL_MS || '15000',
  pollMaxRetries: process.env.HAPPYHORSE_POLL_MAX_RETRIES || '40'
})

/** Kling 图生视频配置 */
export const klingConfig = KlingConfigSchema.parse({
  apiKey: process.env.KLING_API_KEY || '',
  baseUrl: process.env.KLING_BASE_URL || 'https://api.klingai.com',
  model: process.env.KLING_MODEL || 'kling-v3',
  concurrency: process.env.KLING_CONCURRENCY || '3',
  pollIntervalMs: process.env.KLING_POLL_INTERVAL_MS || '3000',
  pollMaxRetries: process.env.KLING_POLL_MAX_RETRIES || '80'
})

/** 视频输出配置 */
export const videoOutputConfig = {
  width: 1080,
  height: 1920,
  fps: 24,
  crf: 18,
}

/** PostgreSQL 与本地数据目录 */
export const persistenceConfig = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://short_video:short_video@127.0.0.1:5432/short_video_agent',
  synchronize: process.env.DB_SYNCHRONIZE !== 'false',
  dataDir: process.env.DATA_DIR || join(process.cwd(), 'data')
}

/** 字体候选路径（跨平台） */
export const fontSearchPaths = [
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/simsun.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
]

/** 自动探测可用的 ffmpeg 路径 */
export function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  for (const p of ffmpegConfig.searchPaths) {
    if (existsSync(p)) return p
  }
  return ffmpegConfig.fallback
}
