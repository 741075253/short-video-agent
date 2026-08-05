# LangGraph + NestJS 短剧生成工作流设计

## 状态

- 日期：2026-08-03
- 状态：已实现，PostgreSQL + Podman 冒烟通过
- 取代范围：现有 Express 同步生成接口、本地 JSON 主存储、产品级 Mock Provider 和手工分步生成流程
- 保留范围：React + Vite 前端、现有真实文本/生图/视频 Provider、FFmpeg 字幕与拼接能力、JSON/Markdown 导出能力

## 背景

当前系统使用 Express 提供同步接口，用户需要分别执行“生成分镜”“生成分镜图片”“生成视频”。项目数据保存在本地 JSON 文件中，长任务无法可靠暂停、恢复或跨服务重启续跑，也缺少角色、剧情、场景之间的明确依赖和导演返工闭环。

本次将后端迁移为 NestJS，并使用 LangGraph.js 将故事理解、导演决策、角色设定、剧情拆分、场景设计、分镜、媒体生成、剪辑和审核组织成可持久化状态机。

## 已确认决策

1. React + Vite 前端保留，Express 后端迁移为 NestJS。
2. Agent 之间不是相互独立的并行关系，按明确依赖串行执行。
3. Director 是状态机中的决策节点，不实现为包办所有工作的“大 Prompt”。
4. 共享状态命名为 `WorkflowState`，各节点只能更新自己拥有的字段。
5. Character、Plot、Scene 分别负责角色设定、剧情结构和世界/场景设定。
6. 角色参考图和分镜各设置一次人工确认，通过 LangGraph `interrupt()` 暂停和恢复。
7. Reviewer 输出结构化审核结果，Director 定向返工指定节点或镜头。
8. 同一节点最多自动返工 2 次，仍未通过则转人工处理。
9. PostgreSQL 同时承载业务数据和 LangGraph checkpoint。
10. 使用官方 `@langchain/langgraph-checkpoint-postgres`，不实现自定义数据库 Saver。
11. 本地开发由 Podman 启动 PostgreSQL；NestJS 和前端继续运行在宿主机。
12. 图片和视频等大文件保存在本地文件系统，数据库只保存元数据、路径和版本关系。
13. 历史产物不可覆盖或自动删除；`stale` 只表示不可作为当前流程输入。
14. 长篇小说分段分析，短故事单次分析，两者输出同一 `StoryAnalysis`。
15. 多集内容使用项目级前期制作状态和独立的剧集 Graph Run。
16. 产品运行时只允许真实 Provider，不保留 Mock Provider 或伪成功降级。
17. 自动化测试使用测试桩隔离网络，但测试桩不进入产品运行代码。
18. 成片仅包含画面和字幕，统一移除片段原生音频；不实现 TTS 和背景音乐。
19. 当前定位为单机单用户工具，只监听 `127.0.0.1`，不实现账号体系。
20. 每次 Run 设置可配置的 Token 和费用预算，超限后进入人工中断。

## 目标与非目标

### 目标

- 用可恢复的状态机执行完整短剧生成流程。
- 明确每个 Agent 的输入、输出、字段所有权和依赖关系。
- 在服务重启、人工确认和局部失败后从 checkpoint 继续执行。
- 仅返工受影响节点或镜头，避免重复消耗模型额度。
- 保留所有历史版本，支持审计和回滚。
- 兼容现有本地 JSON 项目并完成幂等导入。
- 复用现有真实模型和媒体 Provider，不重写成熟的外部 API 调用。

### 非目标

- 不实现多用户、登录、权限和远程协作。
- 不实现 TTS 配音、背景音乐或片段原生音频。
- 不提供 Mock、静态假视频或无密钥降级成功。
- 不在首期接入 BullMQ、Redis 或分布式 Worker。
- 不自动物理清理历史媒体文件。
- 不在迁移过程中更换现有 React 技术栈。

## 总体架构

```text
React + Vite
     |
     | REST + SSE
     v
NestJS API
     |
     +-- Projects / Episodes / Artifacts
     +-- Workflow Runner
     +-- LangGraph StateGraph
     +-- Model / Image / Video Providers
     +-- FFmpeg Editing
     |
     +-------- PostgreSQL
     |           +-- 业务表
     |           +-- LangGraph checkpoints
     |
     +-------- Local Asset Storage
                 +-- 角色参考图
                 +-- 分镜关键帧
                 +-- 视频片段
                 +-- 成片
```

## 工作流设计

### 单集主流程

```text
START
  |
  v
Story Analyzer
  |
  v
Director: 制定 production plan
  |
  v
Character Agent
  |
  v
Character Reference Generator
  |
  v
interrupt: 人工确认角色参考图
  |
  v
Plot Agent
  |
  v
Scene Agent
  |
  v
Storyboard Agent
  |
  v
interrupt: 人工确认分镜
  |
  v
Video Production Subgraph
  |
  v
Editing Agent
  |
  v
Reviewer
  |
  v
Director: 重新决策
  |------------------------------|
  | passed                       | failed
  v                              v
 END                  指定返工节点或人工中断
```

### Director 路由

Director 只读取结构化状态和审核结果，并更新 `directorPlan`、`nextAction` 和返工计数。它不能直接改写角色、剧情、场景、分镜或媒体产物。

```text
reviewResult.targetNode = character   -> Character Agent
reviewResult.targetNode = plot        -> Plot Agent
reviewResult.targetNode = scene       -> Scene Agent
reviewResult.targetNode = storyboard  -> Storyboard Agent
reviewResult.targetNode = production  -> 指定 shotId 的生产子图
reviewResult.targetNode = editing     -> Editing Agent
reviewResult.passed = true            -> END
retryCount > 2                         -> interrupt
```

### Video Production 子图

```text
镜头提示词编译
  |
  v
关键帧生图
  |
  v
关键帧确定性检查
  |
  v
图生视频
  |
  v
视频片段确定性检查
```

专业 Agent 之间保持串行。媒体生成进入镜头层后允许受控并发，默认并发数为 2，并允许按 `shotId` 单独重试。

## Agent 职责

### Story Analyzer

- 识别输入是短故事还是长篇内容。
- 短故事在 Token 限制内单次分析。
- 长篇内容按章节、段落和 Token 上限切分。
- 分段提取人物、地点、事件、时间线和事实。
- 合并同名实体并标记事实冲突。
- 每条事实保留 `sourceRange`，便于追溯原文。

### Director

- 根据 `StoryAnalysis` 和 `ProductionConfig` 制定制作计划。
- 定义整体风格、受众、节奏、剧集拆分和视觉基调。
- 根据 Reviewer 结果决定返工范围。
- 控制返工次数、Token 预算和费用预算。

### Character Agent

- 输出稳定的 `characterId`。
- 定义角色性格、关系、外观、服装和一致性约束。
- 生成参考图提示词和负面约束。
- 不得改变 Story Analyzer 已确认的故事事实。

### Plot Agent

- 依赖 `StoryAnalysis`、`DirectorPlan` 和 `CharacterBible`。
- 拆分剧情节拍、冲突、转折、高潮和剧集边界。
- 明确每个剧情段落涉及的角色和目标。

### Scene Agent

- 依赖角色设定和剧情结构。
- 输出世界观、地点、时间、天气、光线和视觉连续性约束。
- 为剧情段落分配稳定的 `sceneId`。

### Storyboard Agent

- 将剧情段落转换为镜头序列。
- 输出画面、动作、运镜、字幕、关键帧提示词和视频提示词。
- 引用已有 `characterId` 和 `sceneId`，不得重新发明角色或场景。

### Editing Agent

- 使用 FFmpeg 拼接动态视频片段。
- 统一分辨率、帧率和编码参数。
- 叠加字幕。
- 使用 `-an` 移除所有输入片段音轨。
- 不使用 LLM 直接处理媒体文件。

### Reviewer

Reviewer 分为两层：

1. 确定性检查：文件存在性、镜头数量、时长、分辨率、字幕、音轨和 FFmpeg 错误。
2. 多模态检查：抽取关键帧，检查角色外观、场景连续性和画面剧情一致性。

多模态模型不可用时只执行确定性检查，并将视觉审核转为人工确认。

## 状态模型

```typescript
type WorkflowState = {
  projectId: string
  episodeId?: string
  sourceText: string
  productionConfig: ProductionConfig
  storyAnalysis?: StoryAnalysis
  directorPlan?: DirectorPlan
  characterBible?: CharacterBible
  characterReferences?: CharacterReference[]
  plotOutline?: PlotOutline
  sceneBible?: SceneBible
  storyboard?: Storyboard
  generatedAssets?: GeneratedAssets
  editResult?: EditResult
  reviewResult?: ReviewResult
  nextAction?: NextAction
  revisionCount: Record<string, number>
  usageBudget: UsageBudget
  errors: WorkflowError[]
}
```

### 字段所有权

| 字段 | 写入节点 |
| --- | --- |
| `storyAnalysis` | Story Analyzer |
| `directorPlan`、`nextAction`、`revisionCount` | Director |
| `characterBible` | Character Agent |
| `characterReferences` | Character Reference Generator / 人工确认 |
| `plotOutline` | Plot Agent |
| `sceneBible` | Scene Agent |
| `storyboard` | Storyboard Agent / 人工确认 |
| `generatedAssets` | Video Production Subgraph |
| `editResult` | Editing Agent |
| `reviewResult` | Reviewer |
| `usageBudget` | ModelGateway / Director |

### ProductionConfig

```typescript
type ProductionConfig = {
  targetDurationSeconds: number
  episodeCount: number
  aspectRatio: '9:16'
  visualStyle: string
  language: 'zh-CN'
  subtitleEnabled: true
  narrationEnabled: false
}
```

默认值为单集、`9:16`、动画短剧、中文字幕、无旁白音频。

## 版本与失效规则

每个节点产物保存 `inputHash`、`version`、`status`、来源节点和创建时间。产物使用追加写入，不覆盖已有版本。

```text
Character 变化  -> Plot、Scene、Storyboard、媒体、剪辑失效
Plot 变化       -> Scene、Storyboard、媒体、剪辑失效
Scene 变化      -> Storyboard、媒体、剪辑失效
Storyboard 变化 -> 受影响镜头的图片、视频和剪辑失效
媒体变化        -> Editing 失效
```

`stale` 只更新逻辑状态和当前版本指针：

- 不删除数据库历史记录。
- 不删除图片或视频文件。
- 不覆盖旧版本。
- 支持将 `currentVersion` 回滚到任意有效历史版本。
- 物理清理必须由用户单独触发，并只清理无引用版本。

## 多集设计

多集项目分为两个层次：

1. 项目级前期制作 Graph：生成 `StoryAnalysis`、`CharacterBible`、角色参考图、全局剧情结构和世界观。
2. 剧集级 Graph：每集独立执行 Storyboard、媒体生成、剪辑、审核和返工。

项目级 thread 使用 `projectId:preproduction`，剧集级 thread 使用 `projectId:episodeId`。剧集只引用已确认的项目级版本，不复制或擅自修改全局设定。

## NestJS 模块

```text
AppModule
  +-- ProjectsModule
  +-- EpisodesModule
  +-- RunsModule
  +-- WorkflowModule
  +-- AgentsModule
  +-- ModelsModule
  +-- AssetsModule
  +-- ProductionModule
  +-- EditingModule
  +-- ReviewModule
  +-- PersistenceModule
  +-- MigrationModule
```

- `ProjectsModule`：项目 CRUD、制作配置和导出。
- `EpisodesModule`：剧集拆分、状态和全局版本引用。
- `RunsModule`：异步执行、状态查询、SSE、恢复和取消。
- `WorkflowModule`：LangGraph 构建、编译、运行和条件边。
- `AgentsModule`：各 Agent 节点及结构化输出 Schema。
- `ModelsModule`：统一 `ModelGateway`、模型配置、Token 和费用统计。
- `AssetsModule`：媒体路径、版本、哈希和引用管理。
- `ProductionModule`：生图、图生视频和镜头级并发。
- `EditingModule`：FFmpeg 静音合成和字幕。
- `ReviewModule`：确定性检查、多模态检查和审核结果。
- `PersistenceModule`：TypeORM、PostgreSQL 和 `PostgresSaver`。
- `MigrationModule`：旧 JSON 项目幂等导入。

## PostgreSQL 数据模型

首期业务表：

```text
projects
episodes
workflow_runs
artifact_versions
approvals
reviews
usage_ledgers
migration_records
```

LangGraph checkpoint 表由 `PostgresSaver.setup()` 管理，不通过 TypeORM 重复建模。

### WorkflowRun 状态

```text
queued
running
waiting_character_approval
waiting_storyboard_approval
waiting_budget_approval
cancel_requested
cancelled
completed
failed
```

## 异步执行与 API

NestJS 请求不等待完整生成流程完成。首期使用进程内任务调度器，后续可以在不改变 API 的前提下替换为 BullMQ。

```http
POST /api/projects/:id/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/events
POST /api/runs/:runId/resume
POST /api/runs/:runId/cancel
GET  /api/runs/:runId/artifacts
GET  /api/runs/:runId/versions
POST /api/runs/:runId/rollback
```

### 启动 Run

```json
{
  "episodeId": "episode-1",
  "productionConfig": {
    "targetDurationSeconds": 60,
    "episodeCount": 1,
    "aspectRatio": "9:16",
    "visualStyle": "animation_drama",
    "language": "zh-CN",
    "subtitleEnabled": true,
    "narrationEnabled": false
  },
  "budget": {
    "maxTokens": 100000,
    "maxCost": 100
  }
}
```

### 恢复 Run

`resume` 用于：

- 确认或修改角色参考图。
- 确认或修改分镜。
- 批准追加预算。
- 人工处理超过返工次数的节点。

### SSE 事件

```text
run.queued
node.started
node.completed
node.failed
run.interrupted
artifact.created
budget.updated
run.completed
run.cancelled
```

客户端断线后通过 `GET /api/runs/:runId` 恢复当前状态；SSE 仅负责实时通知，不作为唯一状态来源。

## 取消语义

外部媒体任务不保证支持立即终止：

- 取消请求将 Run 标记为 `cancel_requested`。
- 不再调度新的节点或镜头。
- 已提交的外部请求允许完成。
- 取消后返回的产物保存为历史版本，但不设为当前产物。
- 不继续触发 Editing 或 Reviewer。

## ModelGateway 与预算

所有文本 Agent 通过统一 `ModelGateway` 和模型目录调用 OpenAI-compatible 文本模型。每个节点可独立配置：

```text
model
temperature
timeout
retries
maxInputTokens
maxOutputTokens
```

所有 Agent 使用 Zod 结构化输出。节点之间只传递结构化状态，不传递不受约束的模型原始文本。

Token 控制策略：

- Agent 只读取当前节点需要的状态切片。
- 不重复向每个节点发送完整原文。
- 相同 `inputHash` 复用历史产物。
- 确定性校验优先于模型审核。
- 只返工指定节点或镜头。
- 达到 Token 或费用上限后调用 `interrupt()`。

## Provider 策略

### 文本

- 文本、图片和视频模型通过模型目录选择 Adapter、连接与模型 ID。
- 未配置 API Key 时禁止启动 Run，并返回明确配置错误。

### 图片

- 复用现有 Wan 2.7 图片 Provider。
- 角色参考图先生成并人工确认。
- 分镜关键帧必须引用已确认的角色与场景版本。

### 视频

- 复用现有 HappyHorse 和 Kling 真实 Provider。
- 不注册或返回 `mock` Provider。
- 缺少关键帧时失败，不自动伪造图片。
- 成功片段只有在 Provider、模型、输入哈希和配置一致时才可复用。

### FFmpeg

- 只使用真实视频片段生成成片。
- 全部分镜成功后才拼接成片。
- 统一叠加字幕。
- 始终移除输入音轨，不生成静音音轨。
- FFmpeg 不可用时流程失败并保留已有媒体产物。

## JSON 数据迁移

首次启动时扫描现有 `data/projects/*.json`：

1. 读取并通过现有 `ProjectSchema` 校验。
2. 按项目 ID 幂等写入 PostgreSQL。
3. 已存在且 migration hash 相同的项目跳过。
4. 记录源路径、内容哈希、导入时间和迁移版本。
5. 原 JSON 文件保持只读语义，不删除、不覆盖。
6. 导入失败不阻止其他项目迁移，并输出项目级错误。

## Podman 开发环境

项目提供标准 `compose.yaml`，只运行 PostgreSQL。开发命令为：

```powershell
podman compose up -d
```

Windows 上 Podman 仍依赖 WSL2 Podman Machine。建议限制为 2 CPU、2GB 内存，NestJS 和前端不进入容器。

参考：

- [LangGraph.js Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph.js Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Podman Windows 安装说明](https://podman.io/docs/installation)
- [podman compose](https://docs.podman.io/en/stable/markdown/podman-compose.1.html)

## 安全与可观测性

- 服务只监听 `127.0.0.1`。
- API Key 只从服务端环境变量读取。
- 不记录 Authorization、完整原文、完整 Prompt 或模型原始响应。
- 记录 Run ID、项目 ID、节点、模型、Token、费用、耗时、重试次数和错误摘要。
- 错误响应不得包含密钥、请求头或未截断的 Provider 响应。
- 普通日志不作为状态来源，所有 Run 状态写入 PostgreSQL。

## 兼容策略

- 保留现有项目 CRUD 和 JSON/Markdown 导出 URL。
- 前端切换到新的 Run API 和 SSE 状态。
- 旧的同步 `generate-story`、`generate-images`、`generate-video` 接口在迁移完成后移除。
- 现有真实 Provider 先通过 Nest Provider 适配，不在第一阶段重写内部网络调用。
- 产品 Provider 列表不再包含 `mock` 和本地静态假视频入口。
- 前端移除原生音频开关，视频请求固定关闭原生音频。

## 实施阶段

### 第一阶段：NestJS 与持久化基础

1. 建立 NestJS 应用入口和全局错误处理。
2. 建立 TypeORM 数据源和核心实体。
3. 接入 `PostgresSaver`。
4. 实现旧 JSON 幂等导入。
5. 保持现有项目 CRUD 和导出接口兼容。

### 第二阶段：文本工作流

1. 定义 `WorkflowState` 和各节点 Zod Schema。
2. 实现 Story Analyzer 的自适应分段。
3. 实现 Director、Character、Plot、Scene、Storyboard。
4. 实现字段所有权、输入哈希和版本追加。
5. 实现 Director 条件边和最大返工次数。

### 第三阶段：人工中断和 Run API

1. 实现异步 Run 调度器。
2. 实现角色参考图确认。
3. 实现分镜确认。
4. 实现预算超限中断。
5. 实现 SSE、恢复和取消 API。

### 第四阶段：真实媒体流程

1. 将现有图片和视频服务适配为 Nest Provider。
2. 实现角色参考图和分镜生图。
3. 实现镜头级视频生成、并发和单镜头重试。
4. 实现 FFmpeg 静音字幕成片。
5. 实现确定性 Reviewer 和多模态审核接口。

### 第五阶段：前端迁移

1. 将分步按钮改为启动完整 Run。
2. 展示节点进度、预算和错误。
3. 实现角色参考图确认界面。
4. 实现分镜确认和编辑界面。
5. 实现取消、恢复、单镜头返工和版本回滚。
6. 移除 Mock、静态降级和原生音频控件。

### 第六阶段：清理与验收

1. 移除 Express 入口和旧同步生成路由。
2. 移除产品级 Mock Provider。
3. 补充单元、集成、迁移和恢复测试。
4. 执行完整构建和人工真实 Provider 冒烟测试。

## 测试策略

自动化测试不得调用真实外部模型，使用仅存在于测试代码中的网络测试桩。

### 单元测试

- Agent 输入和 Zod 输出校验。
- Story Analyzer 短故事与长篇分段。
- Director 路由和返工次数。
- 字段所有权限制。
- 输入哈希、版本追加和 stale 传播。
- Token/费用预算中断。
- Reviewer 路由结果。

### 集成测试

- PostgreSQL 业务实体和 `PostgresSaver`。
- 服务重启后恢复 interrupted Run。
- 角色参考图和分镜人工确认。
- 取消后不继续调度节点。
- SSE 断线后通过状态接口恢复。
- 旧 JSON 幂等迁移。

### 媒体测试

- 单镜头失败不覆盖成功镜头。
- 相同输入哈希复用成功片段。
- 上游变化只使受影响媒体 stale。
- FFmpeg 成片包含字幕。
- 使用媒体探测确认最终 MP4 不含音轨。

### 真实 Provider 冒烟测试

真实冒烟测试由开发者显式执行，并会产生实际费用：

1. 输入一个短故事。
2. 完成角色参考图确认。
3. 完成分镜确认。
4. 生成至少两个真实视频镜头。
5. 生成最终静音字幕成片。
6. 验证 Reviewer 和 Director 正常结束 Run。

## 验收标准

1. 短故事和长篇小说均能生成统一的结构化分析结果。
2. Agent 严格按 Character -> Plot -> Scene -> Storyboard 的依赖执行。
3. 角色参考图和分镜未经确认时不能进入后续付费生成。
4. NestJS 重启后可以从 PostgreSQL checkpoint 恢复流程。
5. Reviewer 可以将返工定向到具体节点或 `shotId`。
6. 同一节点自动返工超过 2 次后进入人工处理。
7. 上游修改不会删除历史产物，且可以回滚版本。
8. 缺少真实 API Key 时明确失败，不返回伪造结果。
9. 单镜头失败可以单独重试，不重复生成有效镜头。
10. 达到 Token 或费用预算后流程自动暂停。
11. 取消后不再调度新任务，迟到产物只保存为历史版本。
12. 旧 JSON 项目可幂等导入 PostgreSQL，原文件保持不变。
13. 最终 MP4 包含字幕且不含音轨。
14. 产品页面和 API 不再暴露 Mock Provider。
15. 自动化测试不消耗真实模型 Token 或媒体额度。
