# AI 视频 Provider 与 Kling 3.0 Turbo 升级设计

## 状态

- 日期：2026-07-30
- 状态：已实现
- 取代范围：`2026-07-28-kling-i2v-design.md` 中的 Kling 鉴权、默认模型、前端入口、生成配置和失败处理方案

## 背景

当前页面只暴露 `mock` 和 `local_ffmpeg`，用户点击“FFmpeg 生成视频”后走静态图渲染：

```text
shot-N.png -> FFmpeg -loop 1 -> shot-N-clip.mp4 -> concat.txt -> final.mp4
```

该路径不会调用 Kling，因此成片只有静态画面和字幕。虽然服务端已有 `KlingProvider`，但页面 API 类型和按钮均无法选择 `kling`；其默认模型仍为 `kling-v1.6`，提示词中的人物动作也过于抽象。

Kling VIDEO 3.0 已支持 Image-to-Video、明确人物动作、运镜、3-15 秒视频及原生音频。本次升级默认接入 Kling 3.0 Turbo，同时将生成链路改造成可扩展的 Provider 架构。

官方参考：

- [Kling 3.0 Turbo Image-to-Video API](https://klingai.com/document-api/api/video/3-0-turbo/image-to-video)
- [Kling VIDEO 3.0 能力说明](https://app.klingai.com/cn/quickstart/klingai-video-3-model-user-guide)

## 已确认决策

1. 主流程调用 Kling 3.0 Turbo 生成动态视频片段，FFmpeg 只负责字幕和拼接。
2. 保留本地 FFmpeg 静态生成，作为用户明确选择的降级 Provider。
3. 页面使用“视频平台”选择器和统一的“生成视频”按钮。
4. 默认模型为 Kling 3.0 Turbo，并保留 `KLING_MODEL` 环境变量覆盖能力。
5. 页面统一配置时长、分辨率和原生音频，不支持逐分镜配置。
6. 默认配置为 `5 秒 / 1080p / 关闭原生音频`。
7. 页面配置不写入项目；刷新或重新打开项目后恢复默认值。
8. Provider 声明自身能力，页面只展示当前 Provider 支持的配置。
9. 自动生成具体、连续、可观察的人物动作提示词，并允许逐分镜编辑。
10. 旧模板提示词自动升级，用户手动编辑过的提示词不覆盖。
11. 部分分镜失败时保留成功片段，只重试失败分镜。
12. 分镜列表为失败分镜提供单独的“重试”按钮，并沿用当前页面配置。
13. 整片生成默认复用有效的成功片段，不重复消耗 API 额度。
14. 架构必须允许后续接入其他视频生成平台。

## 目标与非目标

### 目标

- 页面实际触发 Kling Image-to-Video，而不是静态 FFmpeg 路径。
- 生成结果包含可见的人物动作和运镜。
- Kling 参数由页面统一配置并传到服务端。
- 成功片段可安全复用，失败片段可单独重试。
- 新增 Provider 时不改项目生成主流程。

### 非目标

- 本次不实现逐分镜独立的时长、分辨率或音频设置。
- 本次不接入第二个外部 AI 视频平台。
- 本次不实现角色 Element Library、多参考图或自定义多镜头编排。
- 本次不把页面生成配置持久化到项目。

## 页面设计

### 顶部生成区

```text
视频平台  [ Kling 3.0 Turbo v ]
时长      [ - ] 5 秒 [ + ]
分辨率    [ 720p | 1080p ]
原生音频  [ ] 生成原生音频
                         [生成视频]
```

- `视频平台`：下拉选择 Provider。
- `时长`：步进输入，Kling 3.0 Turbo 范围为 3-15 秒。
- `分辨率`：分段选择 `720p` 或 `1080p`。
- `原生音频`：复选框，默认关闭。
- 切换 Provider 后，根据能力声明隐藏不支持的配置。
- 选择 `local_ffmpeg` 时明确标注“静态降级”，不展示 AI 专属配置。

### 分镜操作

- `videoPrompt` 可编辑。
- 失败分镜显示错误信息和“重试”按钮。
- 成功分镜显示已生成状态。
- 单镜头重试携带当前页面的 Provider 和统一配置。

## Provider 架构

### 能力声明

```typescript
type VideoProviderCapabilities = {
  duration?: { min: number; max: number; default: number }
  resolutions?: Array<'720p' | '1080p'>
  defaultResolution?: '720p' | '1080p'
  nativeAudio: boolean
  imageToVideo: boolean
  staticFallback: boolean
}

type VideoProviderDescriptor = {
  id: string
  label: string
  capabilities: VideoProviderCapabilities
}
```

服务端提供 Provider 描述列表，前端不硬编码各平台能力：

```http
GET /api/video-providers
```

首期返回：

```json
[
  {
    "id": "kling",
    "label": "Kling 3.0 Turbo",
    "capabilities": {
      "duration": { "min": 3, "max": 15, "default": 5 },
      "resolutions": ["720p", "1080p"],
      "defaultResolution": "1080p",
      "nativeAudio": true,
      "imageToVideo": true,
      "staticFallback": false
    }
  },
  {
    "id": "local_ffmpeg",
    "label": "本地 FFmpeg（静态降级）",
    "capabilities": {
      "nativeAudio": false,
      "imageToVideo": false,
      "staticFallback": true
    }
  }
]
```

### 生成契约

```typescript
type VideoGenerationOptions = {
  durationSeconds: number
  resolution: '720p' | '1080p'
  nativeAudio: boolean
}

type GenerateVideoRequest = {
  provider: string
  options: VideoGenerationOptions
  shotId?: string
  retryFailedOnly?: boolean
}

interface VideoGenProvider {
  readonly name: VideoGenerationProviderName
  readonly model: string
  generateClips(
    shots: Shot[],
    imageSources: string[],
    outputDir: string,
    options: VideoGenerationOptions
  ): Promise<ClipGenerationResult>
}
```

Provider 分为两层：

- `VideoProviderDescriptor` 声明页面能力和生成管线类型。
- `VideoGenProvider` 负责外部平台的图生视频任务。
- 通用路由按 `imageToVideo` 能力执行“图生视频 -> 片段复用 -> FFmpeg 后处理”，不判断 Kling 名称。
- Local FFmpeg Provider 执行“静态图 -> `-loop 1` -> 字幕与拼接”。

Provider 通过注册表创建：

```typescript
const videoProviderRegistry = {
  descriptors: {
    kling: { capabilities: { imageToVideo: true, ... } },
    local_ffmpeg: { capabilities: { staticFallback: true, ... } }
  },
  aiFactories: {
    kling: () => new KlingProvider(klingConfig)
  }
}
```

新增平台只需实现 Provider、注册 descriptor，并补充配置，不修改生成路由的主控制流。

## Kling 3.0 Turbo 接入

### 服务端配置

```bash
KLING_API_KEY=
KLING_BASE_URL=https://api.klingai.com
KLING_MODEL=kling-v3
KLING_CONCURRENCY=3
KLING_POLL_INTERVAL_MS=3000
KLING_POLL_MAX_RETRIES=100
```

- 使用 `Authorization: Bearer <KLING_API_KEY>`。
- API Key 只保存在服务端，不返回前端、不写日志。
- `KLING_MODEL` 默认为 `kling-v3`，环境变量可覆盖。
- 时长、分辨率和原生音频来自本次页面请求，不再使用全局 `KLING_DURATION`、`KLING_MODE`、`KLING_CFG_SCALE`。

### 接口映射

- 创建任务：`POST /v1/videos/image2video`。
- 查询任务：`GET /v1/videos/image2video/{taskId}`。
- 模型字段：`model_name: "kling-v3"`。
- 起始图片字段：`image`，公网 URL 或不带 Data URI 前缀的 Base64。
- 时长字段：`duration`，字符串形式的 `3`-`15`。
- 分辨率映射：`720p -> mode: "std"`，`1080p -> mode: "pro"`。
- 原生音频映射：关闭为 `sound: "off"`，开启为 `sound: "on"`。
- 当前每个项目分镜单独生成，固定 `multi_shot: false`。
- 不发送旧版全局 `cfg_scale`，页面未提供的能力不猜测默认值。

## 动作提示词策略

### 生成原则

`videoPrompt` 重点描述变化，不重复堆砌静态画面信息：

- 明确动作主体。
- 使用可观察的肢体动作，不使用“做出反应”等抽象表达。
- 按时间顺序描述 2-4 个连续动作。
- 明确表情变化和视线方向。
- 明确相机运动，并控制单镜头复杂度。
- 保持角色外观、服装和场景一致。

示例：

```text
林川右手握住门把，向内推开木门，向前迈一步；他抬头望向远处燃烧的城市，
身体短暂停住，表情由警觉转为震惊。镜头从中景缓慢推近到面部近景，动作自然连续，
角色外观、服装和背景保持一致。
```

### 手动编辑保护

新增提示词来源标记：

```typescript
videoPromptSource?: 'generated' | 'manual'
```

- 页面编辑 `videoPrompt` 后写入 `manual`。
- 重新生成故事时只覆盖 `generated`。
- 旧项目没有来源标记时，若命中旧模板“做出反应”或固定英文后缀，则视为 `generated` 并自动升级。
- 未命中旧模板的既有提示词视为 `manual`，不覆盖。

## 片段复用与失败重试

### 输出元数据

只凭 `videoClipPath` 无法判断片段是否匹配当前配置。每个成功片段记录生成元数据：

```typescript
type VideoClipMetadata = {
  provider: string
  model: string
  durationSeconds: number
  resolution: '720p' | '1080p'
  nativeAudio: boolean
  promptHash: string
  imageHash: string
  generatedAt: string
}
```

页面配置本身不持久化，但片段元数据作为输出来源信息随 Shot 保存。

### 复用规则

仅当以下信息全部一致时复用成功片段：

- Provider 和模型。
- 时长、分辨率、原生音频。
- `videoPrompt` 内容哈希。
- 输入图片内容哈希。
- 视频文件仍存在且可读取。

任一项变化都重新生成该分镜，避免混用不同配置的片段。

### 失败策略

- 单个分镜失败不取消其他分镜任务。
- 成功结果正常下载并保存。
- 整片生成结束后返回成功和失败列表。
- 失败分镜保持 `failed`，成功分镜保持可复用状态。
- “重试”只提交当前失败分镜。
- “生成视频”默认提交缺失、失败或元数据不匹配的分镜。
- 全部分镜就绪后再由 FFmpeg 生成最终成片；部分失败时不产出混缺镜头的最终视频。

## FFmpeg 后处理

- Kling 片段路径必须进入 `renderVideoFromClips()`。
- 动态片段路径禁止使用 `-loop 1`。
- 统一转码为当前项目输出规格并叠加字幕。
- 开启原生音频时保留并编码音轨；关闭时不人为生成静音音轨。
- `local_ffmpeg` Provider 保留现有静态图路径，但页面明确标注为降级方案。

## API 与数据变更

### 请求

```http
POST /api/projects/:id/generate-video
Content-Type: application/json

{
  "provider": "kling",
  "options": {
    "durationSeconds": 5,
    "resolution": "1080p",
    "nativeAudio": false
  },
  "shotId": "shot-2",
  "retryFailedOnly": true
}
```

### 响应

```json
{
  "provider": "kling",
  "projectId": "project-id",
  "outputPath": null,
  "completed": [
    { "shotId": "shot-1", "clipPath": "..." }
  ],
  "failures": [
    { "shotId": "shot-2", "message": "..." }
  ],
  "updatedShots": []
}
```

全部分镜成功时 `outputPath` 为最终成片；存在失败时不拼接最终成片。

## 安全与可观测性

- 不记录 `KLING_API_KEY` 或完整 Authorization header。
- 日志记录 Provider、模型、项目 ID、分镜 ID、任务 ID、配置和耗时。
- API 错误保留 HTTP 状态、官方错误码和经过长度限制的消息。
- 前端显示可操作的失败原因，不显示密钥或原始请求头。

## 测试范围

### 单元测试

- Provider 能力声明和配置校验。
- Kling Bearer API Key 鉴权。
- 3.0 Turbo 请求字段映射。
- 具体动作提示词生成。
- 旧模板升级和手动提示词保护。
- 片段配置指纹匹配与失效。
- 部分成功时不取消其他任务。
- 单镜头重试只提交目标分镜。

### 路由测试

- `GET /api/video-providers` 返回能力列表。
- 页面配置正确传入 Provider。
- `provider=kling` 实际进入 Kling Provider。
- 部分失败时保存成功片段且不生成最终成片。
- 全部成功时使用 `renderVideoFromClips()`。
- `local_ffmpeg` 仍可作为静态降级方案。

### 页面测试

- 平台切换动态显示支持的配置。
- 默认值为 `5 秒 / 1080p / 关闭原生音频`。
- 刷新页面后配置恢复默认值。
- 失败分镜显示重试入口。
- 编辑 `videoPrompt` 后标记为 `manual`。

### 人工冒烟测试

使用一个包含单人物明确动作的单镜头项目：

1. 选择 Kling 3.0 Turbo。
2. 设置 `5 秒 / 1080p / 关闭原生音频`。
3. 确认服务端获得真实 Kling task ID。
4. 确认 Shot 保存 `videoClipPath` 和 `VideoClipMetadata`。
5. 用帧差或人工检查确认人物动作可见，不是静态图循环。
6. 确认最终视频来自 `concat-clips.txt`，而不是静态路径的 `concat.txt`。

## 验收标准

1. 页面可选择 Kling 3.0 Turbo 并实际调用 Kling API。
2. 生成的视频片段存在可见的人物动作或运镜，不是 `-loop 1` 静态视频。
3. 时长、分辨率、原生音频配置对请求生效。
4. 页面刷新后配置恢复默认值。
5. 用户手动编辑的 `videoPrompt` 不被自动覆盖。
6. 成功片段在配置和输入未变化时可复用。
7. 失败分镜可以单独重试，且不重复生成成功分镜。
8. Kling 动态片段由 FFmpeg 正确叠加字幕和拼接。
9. 本地 FFmpeg 静态降级仍可显式选择。
10. 新增其他 AI 视频平台时无需改生成路由主流程。
