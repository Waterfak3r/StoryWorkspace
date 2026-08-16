# ADR 014：按故事影像工作流重建本分支

## 背景

`main` 上的已实现基线是 Next.js + SQLite 的长篇叙事工作区：项目 → 故事圣经 → 大纲 → 章节 → AI 审核 → 改编 → Markdown 导出，并叠了 Phase 0–5C 的 Document/Scene、Canon Patch、Scene State、Context Snapshot、不可变 Storyboard 与 Fake Video 生成链。

新方向见 [concept.md](../product/concept.md) 与 [mvp.md](../product/mvp.md)：本地优先的结构化故事 → 分镜 → 生图工作流。项目真相是用户磁盘上的 JSON 目录，而不是应用内部数据库。两者的产品主路径、持久化和演示对象都不同，不适合在旧 SQLite 模式上继续加表。

本决策只作用于 `refactor/visual-workflow-mvp`。`main` 保持现有可运行基线。

## 决策

1. 在本分支重建产品，而不是继续演进 SQLite 叙事工作区。旧代码按模块评估后搬迁，不整仓复制。
2. 第一刀只做 MVP：[项目管理] → [结构树 + 剧本] → [实体] → [解析确认] → [Director / Storyboard] → [Context Resolver] → [生图] → [单镜带约束重生成] → [Workflow 面板]。视频、配音、音乐、完整 Stale/Version 引擎不做。
3. 运行时保留 Next.js 16 + React 19 + TypeScript + Zod + Vitest + Playwright。MVP 允许纯本地 Web；用服务端读写用户选定的工作区根目录来落地“本地项目”。Electron / Tauri 留到文件夹体验成为阻塞后再加。
4. 持久化改为项目文件夹 + JSON。密钥只来自环境变量或用户级本地配置，不进项目 Git、不进客户端、不进 Manifest。
5. 旧系统里正确的领域原则保留，实现换轻量文件形态：文本是证据；Canon 与推断可区分；LLM 输出先过 schema；Context 可检查；Provider 细节停在 Adapter / Compiler；生成可重试、可锁定、不静默覆盖用户结果。
6. 旧系统里为 SQLite / CAS / 不可变修订链服务的 API、表和页面不作为本分支的默认架构。Storyboard 在 MVP 必须可直接编辑；生成结果保留版本目录，但不先做完整 supersede 图。

## 取舍

- 不把现有 SQLite 库自动迁到新格式。这是新产品形状，不是同构升级。
- 不在本分支同时维护两套产品主路径。旧工作区页面随对应切片被替换时删除，不为兼容而双栈。
- 不把 Phase 5 Fake Video 当作本切片的生成目标。Adapter 边界的思路留下，第一执行器是真实用户 Image API，测试仍可用 fake adapter。

## 可复用

直接搬、改接口后继续用：

- `src/features/i18n/`：语言切换、cookie、英文源文案键。文案表按新 IA 重写。
- `src/server/ai/provider.ts` 的错误分类、超时、OpenAI 兼容 `fetch`。输出从“一段 Markdown 草稿”改为结构化 JSON。
- `src/server/http.ts` 的 Zod → 校验响应形状；去掉对叙事 / Story Bible 错误类的硬编码依赖。
- `src/app/globals.css` 与现有视觉 token、无障碍基线。
- `e2e/fake-openai.mjs` 的本地假 Provider 模式。
- `start-local.ps1` 的 Node 版本与端口检查。
- 工具链：`package.json` 脚本、ESLint、Vitest、Playwright、`tsconfig`。

只复用概念，按新 JSON 模型重写：

- Context Snapshot → Context Resolver（组装 Scene、Entity、State、Style、Intent、前镜连续性，产出可检查快照）。
- Character Base vs Scene State → Entity 永久身份 vs Content State；镜头结束姿态另记 Continuity。
- Storyboard / ShotSpec 字段（purpose、action、camera、subjects、constraints）。
- Prompt Compiler + Adapter 分层；Provider 参数不进领域对象。
- Generation Manifest / Job / retry / lock：收成 Workflow Node 的 run 记录。
- 项目库、三栏工作区、自动保存与冲突提示的交互模式。

## 不搬

- `src/server/db/**` 与全部 SQLite schema / repository。
- 章节、大纲、圣经条目、改编、Markdown 导出作为产品主路径。
- Phase 0–5C 的路由树、修订聚合、Pending Patch 审核台、Fake Video 编译预览页。
- 绑定 UUID 修订链的不可变 Storyboard 写入协议（MVP 要可改 Shot 列表）。

## 迁移与影响

- 本分支的 README、架构说明和 `Agents.md` 改为描述新 MVP。旧 ADR 008–013 保留为历史，不再指导本分支实现。
- 工作区未提交的 i18n 改动跟着本分支走，作为可复用壳，不回滚。
- 第一个可运行切片应先打通：工作区根目录扫描 → 创建/打开 JSON 项目 → Story 树与剧本保存 → 实体读写。解析和生图接在这条文件真相之后。

## 仓库核对（确认换芯）

对照 `src/domain`、`src/server/db`（schema v17 / ~39 表）、69 个 route、旧工作区壳和约 294 个旧用例后确认：

- 不在 SQLite 叙事工作区上演进，也不另开仓库换栈。
- 同仓换芯：留下 Next/Zod/Vitest/Playwright、i18n 运行时、CSS、Provider 传输层。
- 新领域、文件仓库、API、页面从 `src/studio` 长出。旧测试不当新 CI 门槛。

第一实现合同：`docs/product/slice-01-json-workspace.md`。

## 验收

- 文档与 `Agents.md` 指向新定位，且本切片范围可被单独检查。
- 后续每个实现切片都落在 `docs/product/mvp.md` 的必做表内，并带相应测试。
- 密钥扫描与项目 JSON 夹具中不得出现真实 API Key。
