# Kling 图生视频集成设计

## 概述

将当前 FFmpeg 幻灯片模式（`-loop 1` 静态图+字幕）升级为真实 AI 视频生成。引入 Kling（可灵）图生视频 API，每个镜头"静态图 → 5s 视频片段 → FFmpeg 拼接+字幕 → 成片"。

## 架构

```
小说文本
  │
  ▼
storyGenerator.ts ──── 剧本+分镜（已有，新增 videoPrompt 字段）
  │
  ▼
imageProviders.ts ──── 静态图片生成（已有，DashScope/Wan 2.7）
  │  └─ 产出: shot-N.png + DashScope OSS URL
  │
  ▼
videoGenProviders.ts ─ 🆕 Kling I2V Provider
  │  └─ 输入: shot.videoPrompt + imageUrl
  │  └─ 产出: shot-N-clip.mp4（5s 视频片段）
  │
  ▼
videoProviders.ts ──── ♻️ FFmpeg 拼接 + 字幕叠加
  │  └─ 输入: 多个 clip.mp4 + shot.subtitle
  │  └─ 产出: final.mp4
```

## 模块变更

### 1. schema.ts — 新增字段

```typescript
// Shot 新增
videoPrompt: z.string().optional()  // 图生视频专用 prompt
videoClipPath: z.string().optional() // Kling 生成的视频片段路径

// 新增
VideoGenProviderNameSchema = z.enum(['mock', 'kling'])
```

### 2. config.ts — 新增配置

```typescript
export const klingConfig = {
  accessKey: process.env.KLING_ACCESS_KEY || '',
  secretKey: process.env.KLING_SECRET_KEY || '',
  model: process.env.KLING_MODEL || 'kling-v1.6',
  duration: Number(process.env.KLING_DURATION || '5'),
  mode: process.env.KLING_MODE || 'std',       // std | pro
  cfgScale: Number(process.env.KLING_CFG_SCALE || '0.5'),
  concurrency: Number(process.env.KLING_CONCURRENCY || '3'),
}
```

### 3. storyGenerator.ts — 新增 videoPrompt 生成

```typescript
// 每个 shot 新增
videoPrompt: `${visual}。${action}。${camera}。smooth continuous motion, cinematic movement, consistent character appearance`
```

### 4. videoGenProviders.ts — 🆕 新文件

```
interface VideoGenProvider {
  name: string
  generateClips(shots: Shot[], imageUrls: string[], outputDir: string): Promise<ClipResult[]>
}
```

KlingProvider 实现：
- **JWT 鉴权**：accessKey + secretKey → HS256 JWT，5 分钟有效期
- **异步提交**：POST `/v1/videos/image2video`，传入 imageUrl + prompt + duration + cfg_scale + mode
- **分批并发**：每批最多 3 个（`KLING_CONCURRENCY`），批次内并行提交
- **轮询**：每 3s 查一次 `/v1/videos/{taskId}`，最长 5 分钟
- **全有或全无**：任何片段失败 → 取消所有 pending 任务 → 返回失败原因

失败返回格式：
```typescript
{
  success: false,
  failures: [
    { shotId: 'shot-3', reason: 'Kling 返回错误 40013: 图片内容不符合安全策略' },
  ],
  completed: [
    { shotId: 'shot-1', clipPath: '...' },
  ]
}
```

### 5. videoProviders.ts — ♻️ 改造

`LocalFfmpegProvider` 改造：
- 保留 mock 模式和纯 FFmpeg 静态图模式作为 fallback
- 新增 `renderVideoFromClips()`：从 Kling 视频片段拼接 + drawtext 字幕
- 去掉 `-loop 1`、scale filter（不再需要处理静态图）
- 拼接用 `-c:v libx264` 重新编码（兼容不同片段编码参数）

### 6. routes.ts — ♻️ 串联流程

`POST /projects/:id/generate-video` 改造：
- 如果没生图 → 先调 imageProvider（已有逻辑）
- 如果 provider=kling → 调 KlingProvider.generateClips()
- Kling 失败（全有或全无）→ 返回 502 + 失败原因数组
- Kling 成功 → 调 FFmpeg renderVideoFromClips() 拼接
- 更新 project 上的 shot 状态和 assetPath/clipPath

## 数据流

```
Shot { prompt, videoPrompt, status, assetPath, videoClipPath }
  │
  ├── 1. 生图阶段
  │   ImageProvider.generateImage(shot) → shot.assetPath = './shot-1.png'
  │   同时缓存 DashScope OSS URL → imageUrl
  │   shot.status = 'ready'
  │
  ├── 2. 图生视频阶段（🆕）
  │   Kling I2V API(imageUrl, shot.videoPrompt, params)
  │   → 提交 → 轮询 → 下载
  │   → shot.videoClipPath = './shot-1-clip.mp4'
  │
  └── 3. 拼接阶段（♻️）
      FFmpeg concat(clipPaths) + drawtext(subtitles) → final.mp4
```

## 错误处理

| 环节 | 错误 | 处理 |
|------|------|------|
| JWT 签名 | accessKey/secretKey 未配置 | 400 "未配置 Kling 认证信息" |
| Kling 提交 | 网络/限流/参数错误 | 返回 HTTP 状态+body，不重试 |
| Kling 轮询超时 | 5 分钟内未完成 | 标记 failed，取消任务 |
| 部分片段失败 | 任意片段 failed | 全有或全无，返回所有失败原因 |
| FFmpeg 拼接失败 | 编码错误 | 保留现有错误处理 |

## 环境变量

```bash
# Kling 图生视频（新增）
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
KLING_MODEL=kling-v1.6
KLING_DURATION=5
KLING_MODE=std
KLING_CFG_SCALE=0.5
KLING_CONCURRENCY=3
```
