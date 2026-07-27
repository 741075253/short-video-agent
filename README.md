# 短视频智能体

本地 Web 工具：小说文本 → 动画短剧分镜脚本包 → Mock / FFmpeg 视频生成流程。

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

## 第一版能力

- 输入小说文本
- 生成摘要、角色、场景、分镜、提示词、字幕
- 编辑生成结果
- 保存项目到本地 JSON 文件
- 重新打开项目
- 导出 JSON / Markdown
- 使用 MockProvider 跑通视频生成流程
- 使用 LocalFfmpegProvider 检查 FFmpeg 并生成本地合成计划

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
