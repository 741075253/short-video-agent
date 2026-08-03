# 短视频智能体

本地 Web 工具：小说文本 → AI 动画分镜 → 万相关键帧 → HappyHorse 动态片段 → FFmpeg 成片。

## 启动

安装依赖：

```bash
pnpm install
```

启动后端：

```bash
pnpm dev
```

后端地址：`http://127.0.0.1:5174`

启动前端：

```bash
pnpm web
```

前端地址：`http://127.0.0.1:5173`

## Token Plan

在 `.env` 中配置 Token Plan 个人版密钥：

```dotenv
TOKEN_PLAN_API_KEY=sk-sp-xxx
TOKEN_PLAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com
```

为兼容已有配置，也支持使用 `qian_wen_api_key` 保存同一密钥。页面可选择套餐内的文本、万相图片和 HappyHorse 视频模型。

## 能力

- 输入小说文本
- 生成摘要、角色、场景、分镜、提示词、字幕
- 编辑生成结果
- 保存项目到本地 JSON 文件
- 重新打开项目
- 导出 JSON / Markdown
- 使用 Token Plan 文本模型生成结构化分镜
- 使用 Wan 2.7 生成连续关键帧
- 使用 HappyHorse 1.1 生成 T2V / I2V / R2V 视频片段
- 使用 FFmpeg 叠加字幕并合成整片

页面生成流程分为“生成分镜”“生成分镜图片”“生成视频”三个独立操作。I2V、R2V 和本地 FFmpeg 缺少分镜图片时不会自动生图。

## FFmpeg

如果 FFmpeg 未加入系统 PATH，可以指定便携版路径：

```bash
$env:FFMPEG_PATH="E:\\workspace\\tools\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe"
pnpm dev
```

如果本机没有安装 FFmpeg，`LocalFfmpegProvider` 会把镜头标记为失败并提示：

```text
FFmpeg 不可用，请安装 FFmpeg 或切换 MockProvider。
```

没有 FFmpeg 时可以使用 MockProvider 验证主流程。

## 验收步骤

1. 打开前端页面。
2. 输入项目名称。
3. 粘贴至少 10 个字符的小说文本。
4. 点击“新建项目”。
5. 点击“生成分镜”。
6. 修改任意镜头的画面、字幕或提示词。
7. 点击“保存修改”。
8. 点击“导出 JSON”。
9. 点击“导出 Markdown”。
10. 点击“Mock 生成视频”。
11. 确认页面提示生成完成。
12. 点击“FFmpeg 生成视频”；如果未安装 FFmpeg，确认页面显示清晰错误。

## 后续接入第三方平台

新增平台时实现统一接口：

```ts
interface VideoProvider {
  name: VideoProviderName
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>
}
```

主流程只调用 provider，不直接依赖具体平台。
