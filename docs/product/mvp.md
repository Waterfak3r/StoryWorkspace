# MVP：可完成的第一垂直切片

本文件是本分支的产品范围与**当前实现基线**。完整方向见 [concept.md](./concept.md)。

**限制随用户补充：** 「当前限制」不是开篇冻结表。用户新声明的不做项写入该节；用户明确要做的能力从限制划出并写入必做/切片。最新用户覆盖优先于本页旧句与 `concept.md` 里的远期条目。`concept.md` 或旧切片不得单独当作实现许可。不要双栈 SQLite。

`Agents.md` 只保留协作规则；基线以本文件最新文本为准。

## 切片状态（已核对仓库）

| 切片 | 状态 |
|------|------|
| [01 JSON 工作区](./slice-01-json-workspace.md) | 已实现：工作区根 + 项目文件夹 JSON + Story 树/剧本 + 角色/地点/道具/服饰 |
| [02 解析确认](./slice-02-parse-confirm.md) | 已实现：粘贴 → 待确认提案 → 人工确认；**AI 划分卷/章/场**，确认时按提案建章，选中章仅作单章回退 |
| [03 分镜 + Context](./slice-03-storyboard-context.md) | 已实现：可编辑 Shot；可检查快照 |
| [04 生图 + Workflow](./slice-04-generate-workflow.md) | 已实现：假/真 Image adapter、锁定、带约束重生成、Workflow/Outputs |
| 05 可灵文生视频 | **已撤回**（见 [ADR 017](../decisions/017-cut-video-comics-only.md)）：studio 不做 Kling/视频生成 |
| Settings / 文本协议 | 已实现（切片后补）：用户级 Provider；`auto` / `chat` / `responses`；OpenCode Go 走 `/chat/completions` |
| Story 选中与实体挂接 | 已实现（切片后补）：卷/章/场可点选；本场检索添加角色/地点/道具/服饰 |
| [Story 删除](./slice-05-story-delete.md) | 已实现：卷/章/场级联硬删 + 确认弹窗；实体不删 |
| [故事大纲栏](./slice-06-story-outline.md) | 已实现：只读汇编卷/章/场 + 情节/环境/实体/镜头节拍；导航「故事大纲」 |
| 全本故事摄入 | 已实现：`test/resource` 长文走 parse→confirm；剧本覆盖原文；环境/实体可复用 |
| 艺术分镜导演 | 已实现：可注入；无镜时至少 2 镜；机位变化且含景别/运动语汇；已配文本模型则 LLM，失败回退 |
| [漫画页](./slice-07-comics-pages.md) | 已实现：Image API **一次生成一整页漫画**；遗留静帧合成一张页图；Outputs 一页一图 |
| [实体参考图](./slice-08-entity-references.md) | 已实现：实体可上传参考图；生图把图片发给 `/images/edits`，保持角色/地点/道具/服饰一致 |

## 当前实现基线

- 运行时：Next.js App Router、TypeScript、Zod、Vitest、Playwright。入口 `/`、`/projects/[id]` 挂 `src/features/studio`，API 前缀 `/api/studio`。领域与落盘在 `src/studio/`。
- 项目真相：`STORY_WORKSPACE_ROOT`（默认 `.data/projects`）下的项目文件夹 + JSON。不设 `STORY_WORKSPACE_DB_PATH` 也能列/建/开项目。`src/server/db/**` 仍在磁盘，不是产品真相，新入口不得引用。
- 密钥：环境变量或用户级 `.data/user/providers.json`（Settings 写入；`STORY_USER_CONFIG` 可改路径）。**不进**项目 JSON、不进 GET 明文、不进 Git。项目树里的 `config/providers.json` 是规划占位，运行时未作为真相。
- 文本 API：OpenAI 兼容优先。`protocol=auto` 时 OpenCode Go（`opencode.ai` / `/zen/go`）走 Chat Completions；其它地址先 `/responses`，404/405 再试 chat。
- 生图：已配 Image key+model 则调 OpenAI-compatible Images API。无参考图时走 `/images/generations`；出场实体若有落盘参考图，必须把**图片字节**发给 `/images/edits`，不得只把路径写进 prompt。Settings 预设钠API 4K：`https://naapi.cc/v1` + `gpt-image-2` + `3840x2160` + quality high + `b64_json`；否则假 adapter 写 1×1 PNG。一次调用生成一整页漫画。本分支多模态只做漫画，不做视频。
- 可沿用：`src/features/i18n/`、`globals.css` token、`start-local.ps1`、工具链、假 Provider 测试夹具。
- 只借概念、已在 `src/studio` 重写：Context Resolver、Entity 身份 vs 场引用、可编辑 Storyboard、Compiler/Adapter、Lock/Retry、Workflow node。
- 不搬进主路径：SQLite schema、章节/大纲/圣经/改编产品页、Phase 0–5C 路由、Fake Video 页。
- 保存正文不阻塞 AI。LLM 输出先过 Zod。Canon 与推断可区分。

## 简历级定位

本地优先的 **AI 结构化内容 → 影像工作流**。

把故事里的角色、地点、状态只描述一次；分镜、生图、重生成时自动复用上下文；支持对单个镜头做带前后一致性约束的重新生成。

## 必做

| 模块 | 职责 |
|------|------|
| 项目管理 | 新建 / 打开本地项目目录 |
| 内容结构 | Volume → Chapter → Scene 树 + 剧本编辑 + **删除**（级联硬删，确认弹窗） |
| 实体管理 | 角色 / 地点 / 道具 / 服饰 的创建、编辑、参考图 |
| 导入解析 | 粘贴文本 → AI 划分 Volume / Chapter / Scene + Entity → 人工确认（确认时自动建缺失的卷/章） |
| Context Resolver | 生成时自动组装实体、状态、风格、Intent、前镜连续性 |
| Storyboard | Scene → 多个可编辑 Shot |
| 生图 | 调用用户自备 Image API，一次出一整页漫画；出场实体参考图作为图片输入，保持形象一致 |
| 单镜头重生成 | 重画该镜所在整页；Agent 带连续性约束 |
| Workflow 面板 | 节点状态：待跑 / 成功 / 失败 / 锁定；可点 Shot 重跑 |
| 故事大纲栏 | 只读可视化整本：卷/章/场、情节、环境、实体、镜头节拍 |
| 全本摄入 | 粘贴长文后确认，得到可复用的环境 / 情节 / 实体，供分镜与生图直接引用 |
| 艺术分镜 | Director 可接大模型；机位有景别与运动，服务情节 |
| 漫画页 | Image API 直接生成一页多格连环画；已有多张静帧则合成一张有阅读顺序的页图；Outputs 一页一图 |

## 当前限制（随用户决策补充）

用户补充：多模态只做漫画静帧 / 分镜生图；不做视频（Kling 已撤回，[ADR 017](../decisions/017-cut-video-comics-only.md)）。

仍有效：

- 配音、音乐、混音、成片合成
- 完整 Version / Stale / 平行世界时间轴
- 组织 / Creature 等扩展实体（道具与服饰已纳入一等实体）
- Electron / Tauri 桌面壳
- 把旧 SQLite 故事库自动迁移进新项目格式
- 对白气泡、描字、出血、印刷 / PDF / CBZ 导出

## 页面

```
Projects
Project Workspace
├── Overview
├── Story
├── Story outline
├── Entities
├── Workflow
├── Outputs
└── Settings
```

Workflow 是演示核心：能看见节点状态，能重跑某个 Shot，能看见 Agent 给出的前后一致性约束。

## 核心链路

```
文本 / 导入
  → AI Parse（Scene + Entity）→ 人工确认
  → Scene 编辑（剧本 + Intent）
  → AI Director → Storyboard（可改）
  → Context Resolver
  → Prompt Compiler（一页多格）→ Image API 一张漫画页
  → 遗留多静帧则合成一张页图
  → 单 Shot：查看自动 Prompt / 连续性约束 / 重画本页 / 锁定
```

## 本地项目格式

数据以 JSON 为主，方便 Git 和调试。密钥不进项目目录。

```
my-project/
├── project.json
├── content/volumes/.../chapters/.../scenes/scene-01.json
├── entities/characters/  locations/  props/  costumes/
├── assets/images/  voices/
├── states/content-states/  continuity/
├── styles/default.json
├── workflow/runs/  nodes/
├── outputs/storyboards/  images/  exports/
└── config/providers.json   # gitignore；优先使用用户级配置
```

## 精简模型

**Scene**：`id`、`title`、`script`、`characters[]`、`location`、`props[]`、`costumes[]`、`intent`、`shots[]`

**Character**：`id`、`name`、`description`、`visual.base`、`visual.references[]`、`states.default`

**Shot**：`id`、`scene_id`、`purpose`、`action`、`camera`、`continuity_from`、`status`、`selected_image`

## 技术约束

- 继续用现有 Next.js App Router + TypeScript + Zod + Vitest + Playwright。本地 Web 即可；桌面壳后期再加。
- 存储为工作区根目录下的项目文件夹 + JSON。不再以 SQLite 为项目真相。
- AI / 生图走 OpenAI 兼容优先的适配层；用户自备 Key（Settings 或环境变量）。
- 「解析 → 分镜 → 生图 → 带约束重生成」主链已通；后续只补本页已写缺口与用户新补的必做/限制。
