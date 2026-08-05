# 短视频智能体

本地短剧制作工作台：故事输入 -> LangGraph Agent 工作流 -> 角色参考图 -> 分镜 -> 真实 AI 视频片段 -> 静音字幕成片。

## 技术栈

- React + Vite
- NestJS
- LangGraph.js
- PostgreSQL + TypeORM + `PostgresSaver`
- Wan 2.7、HappyHorse 1.1、Kling
- FFmpeg

## 架构

```text
浏览器（127.0.0.1:5173）
  |
  | REST + SSE
  v
NestJS API（127.0.0.1:5174）
  |
  +-- LangGraph 工作流
  +-- 文本 / 图片 / 视频 Provider
  +-- FFmpeg 剪辑
  +-- PostgreSQL（业务数据 + checkpoint）
  +-- data/outputs（图片、视频和成片）
```

本地开发采用混合架构：Podman 只运行 PostgreSQL，NestJS 和 Vite 直接运行在 Windows 宿主机。

## 本地启动

### 前置条件

- Node.js、pnpm
- Podman Desktop（已完成 WSL2 Podman Machine 初始化并启动）
- FFmpeg（已加入 PATH，或通过 `FFMPEG_PATH` 指定可执行文件）

### 1. 安装依赖

```powershell
pnpm install
```

### 2. 配置环境变量

```powershell
Copy-Item .env.example .env
```

默认数据库配置可直接配合 `compose.yaml` 使用。至少填写 `QIAN_WEN_API_KEY`；选择 Kling 时还需填写 `KLING_API_KEY`。详细变量见下方“配置”章节。

### 3. 启动 PostgreSQL

```powershell
pnpm db:up
```

该命令仅启动 PostgreSQL，并使用具名卷 `postgres-data` 持久化数据。脚本会自动探测 PATH 或 `%LOCALAPPDATA%/Programs/Podman/podman.exe` 中的 Podman CLI。

### 4. 启动 NestJS API

```powershell
pnpm dev
```

API 地址：`http://127.0.0.1:5174/api`

首次启动会自动创建业务表和 LangGraph checkpoint 表，并幂等导入旧的 `data/projects/*.json`。

### 5. 启动 Vite 前端

```powershell
pnpm web
```

访问：`http://127.0.0.1:5173`

NestJS 和 Vite 需要在两个终端中持续运行。结束开发后，先按 `Ctrl+C` 停止二者，再关闭数据库：

```powershell
pnpm db:down
```

`db:down` 不会删除 `postgres-data` 中的数据。

## 配置

| 变量 | 用途 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接 | 默认值与 `compose.yaml` 一致 |
| `QIAN_WEN_API_KEY` | 千问文本、Wan 图片、HappyHorse 视频 | 使用阿里云百炼模型时必填 |
| `QIAN_WEN_BASE_URL` | 阿里云百炼连接地址 | 默认 `https://dashscope.aliyuncs.com` |
| `KLING_API_KEY` | Kling 视频 | 选择 Kling 时必填 |
| `MODEL_CATALOG_PATH` | 模型目录文件 | 默认 `./config/model-catalog.json` |
| `FFMPEG_PATH` | FFmpeg 可执行文件 | FFmpeg 不在 PATH 时填写 |
| `DATA_DIR` | 本地数据目录 | 默认 `./data` |
| `PORT` | NestJS 端口 | 默认 `5174` |

服务端启动时自动读取项目根目录的 `.env`，系统环境变量优先级更高。密钥只保存在 `.env` 中，不写入模型目录。

文本、图片和视频模型分别配置在 `config/model-catalog.json` 的 `text`、`image`、`video` 列表中，三类模型互不复用配置。更换同协议模型只需新增或修改对应列表项；接入新协议时新增该类型的 Adapter，LangGraph 工作流无需修改。修改目录后需要重启 NestJS。

- `text`、`image`、`video`：分别维护模型 ID、显示名称、Adapter 和厂商模型名称。
- `apiKeyEnv`、`baseUrlEnv`、`baseUrl`：由每个模型独立声明连接配置。
- `basePath`：模型协议相对连接地址的路径，例如 OpenAI-compatible 的 `/compatible-mode/v1`。
- `capabilities`：声明视频模型支持的输入模式、时长和分辨率，前后端共用该约束。

产品运行时不提供 Mock Provider。缺少 API Key、FFmpeg 或真实媒体输入时，流程会明确失败并保留已有产物。

## 工作流

```text
Story Analyzer
  -> Director
  -> Character Agent
  -> 角色参考图确认
  -> Plot Agent
  -> Scene Agent
  -> Storyboard Agent
  -> 分镜确认
  -> Video Production
  -> Editing
  -> Reviewer
  -> Director 返工或结束
```

- 短故事单次分析，长篇内容分段分析后归并。
- `启动制作` 只执行 Story Analyzer；每个计费步骤完成后暂停，人工检查产物并点击下一步才继续。
- Agent 仍按角色、剧情、场景、分镜的依赖顺序执行，但等待期间不会调用后续模型。
- 角色参考图和分镜通过 LangGraph `interrupt()` 等待人工确认。
- PostgreSQL checkpoint 支持服务重启后恢复。
- Reviewer 可定向返工节点或单个镜头。
- 同一节点自动返工最多 2 次，之后转人工处理。
- 多集项目为每集创建独立 Run 和 checkpoint。
- 达到 Token 或费用预算时暂停，确认追加后继续。

## 产物与版本

- 项目、Run、审核、预算和版本元数据保存在 PostgreSQL。
- 图片和视频保存在 `data/outputs/`。
- 历史产物只追加，不覆盖、不自动删除。
- 上游修改使下游版本变为 `stale`，但文件仍可回滚。
- 旧 `data/projects/*.json` 会在首次启动时幂等导入，原文件保持不变。

## 手机竖屏

- 画面和成片统一使用 `9:16`。
- FFmpeg 等比缩放后裁切到 `1080x1920`，不会拉伸画面。
- 提示词要求主体位于中央安全区域，并为底部字幕保留空间。
- 成片统一移除输入片段音轨，只包含画面和字幕。

## 验收

1. 创建项目并输入至少 10 个字符的故事内容。
2. 选择文本、生图、视频模型和目标时长。
3. 启动制作，检查“故事理解”产物后手动执行下一步。
4. 逐项检查导演规划、角色设定、剧情拆分和场景设计；每次确认后只执行一个后续步骤。
5. 检查并确认角色参考图。
6. 编辑并确认分镜。
7. 确认后生成真实关键帧和视频片段，再手动进入剪辑与审核。
8. 确认成片审核结果或提交定向返工。
9. 下载最终 MP4，确认画面为 `9:16`、字幕可见且没有音轨。
10. 重新进入项目，确认故事内容和步骤产物可以回显。
11. 重启 NestJS，确认等待中的 Run 可以从 checkpoint 继续。

## 验证命令

```powershell
pnpm test
pnpm build
```

自动化测试使用测试桩隔离外部网络，不消耗真实模型 Token 或媒体额度。

详细设计见 `docs/superpowers/specs/2026-08-03-langgraph-nestjs-workflow-design.md`。
