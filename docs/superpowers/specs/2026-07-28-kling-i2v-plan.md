# Kling 图生视频 — 实现计划

## 执行顺序

### 1. schema.ts — 数据模型扩展
- `Shot` 新增 `videoPrompt?: string`、`videoClipPath?: string`
- 新增 `VideoGenProviderNameSchema = z.enum(['mock', 'kling'])` 及类型
- 新增 `KlingConfigSchema` 及类型
- 新增 `ClipResultSchema`（{ shotId, clipPath }）及失败返回类型

### 2. config.ts — Kling 配置项
- 新增 `klingConfig` 对象，全部从环境变量读取：
  - `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` — JWT 鉴权
  - `KLING_MODEL` — 默认 `kling-v1.6`
  - `KLING_DURATION` — 默认 `5`
  - `KLING_MODE` — 默认 `std`（`std` | `pro`）
  - `KLING_CFG_SCALE` — 默认 `0.5`
  - `KLING_CONCURRENCY` — 默认 `3`
  - `KLING_POLL_INTERVAL_MS` — 默认 `3000`
  - `KLING_POLL_MAX_RETRIES` — 默认 `80`

### 3. storyGenerator.ts — videoPrompt 生成
- 每个 shot 生成时追加 `videoPrompt` 字段
- 模板：`${visual}。${action}。${camera}。smooth continuous motion, cinematic movement, consistent character appearance`

### 4. videoGenProviders.ts — 🆕 Kling I2V Provider
- 定义 `VideoGenProvider` interface：`generateClips(shots, imageUrls, outputDir) → ClipResult[]`
- `KlingProvider` 实现：
  - **JWT 生成**：`accessKey + secretKey` → HS256，exp=5min，每次请求前刷新
  - **提交**：`POST https://api.kling.kuaishou.com/v1/videos/image2video`，body: `{ model, image, prompt, duration, cfg_scale, mode }`
  - **分批并发**：用 `KLING_CONCURRENCY=3` 分批，批次内 `Promise.all` 并行提交
  - **轮询**：`GET /v1/videos/{taskId}`，每 3s，最多 80 次（4 分钟）
  - **全有或全无**：任意片段 status=failed → 停止轮询、取消所有 pending 任务 → 返回 `{ success: false, failures: [...], completed: [...] }`
  - **下载**：成功的片段下载到 `{outputDir}/{shotId}-clip.mp4`
- `MockVideoGenProvider` 实现：生成空 mp4 文件用于测试

### 5. videoProviders.ts — ♻️ 改造 FFmpeg 拼接
- `LocalFfmpegProvider` 新增方法 `renderVideoFromClips(clipPaths, shots, outputPath)`：
  - 每个片段叠加 drawtext 字幕（保留现有 `escapeDrawtext` 逻辑）
  - concat demuxer + `-c:v libx264` 重新编码
  - 去掉 `-loop 1`、scale filter
- 保留现有静态图 fallback 逻辑（`renderVideo` 方法不动，用于 mock / 无 Kling 时降级）
- `generate()` 方法改为优先走 clips 路径：有 `videoClipPath` → `renderVideoFromClips`，否则 fallback 到现有 `renderVideo`

### 6. routes.ts — 串联流程
- `POST /projects/:id/generate-video` 改造：
  - 新增 `provider` 参数支持 `'kling'`
  - `provider='kling'` 时：
    1. 如果 shot 没有 assetPath → 先调 `imageProvider.generateImages()` 生图
    2. 从 shot 取 `assetPath`，同时用 `lastImageUrl` 作为 Kling 输入
    3. 调 `KlingProvider.generateClips()` 生成视频片段
    4. 如果 Kling 失败 → 返回 502 + failures 详情
    5. 如果成功 → 更新 shot 的 `videoClipPath`
    6. 调 `LocalFfmpegProvider.generate()` 拼接成片
  - 失败时返回每个片段的 `{ shotId, message }`，指导用户如何改进 prompt

### 7. .env — 新增环境变量
```
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
KLING_MODEL=kling-v1.6
KLING_DURATION=5
KLING_MODE=std
KLING_CFG_SCALE=0.5
KLING_CONCURRENCY=3
```

## 不修改的文件
- `imageProviders.ts` — 保持不变
- `exporters.ts` — 保持不变
- `projectStore.ts` — 保持不变
- `app.ts` / `index.ts` — 保持不变
- `App.tsx` / `api.ts` — 保持不变
