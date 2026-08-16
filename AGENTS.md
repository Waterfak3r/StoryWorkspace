# AI Story Development Platform 协作说明

## 必读与优先级
- 任何代理在分析、规划、编码或审查前，必须完整读取本文件。
- 每次新任务都重新读取；本文件更新后以最新版本为准。
- 本文件必须保持精炼，不得超过 100 行。
- 产品方向以 `docs/product/concept.md` 为准；本分支范围与实现基线以 `docs/product/mvp.md` 为准；换芯决策见 `docs/decisions/014-visual-workflow-rebuild.md`。
- `mvp.md` 的必做与限制随用户决策即时补充或改写；最新用户覆盖优先。不得用过期「明确不做」否决用户刚锁定的范围。改完写入 `mvp.md`（必要时 ADR）。
- `main` 仍以旧 README / `docs/architecture.md` / 代码为准。本分支不继续加 SQLite 叙事功能。
- 数据不变量或模块边界冲突时，先停止扩展，记录 ADR 或询问用户。

## 角色与职责
- 我是本仓库的主代理：Grok 4.6（xAI）。负责产品构思、架构、范围、路线、接口、任务拆解、分发、协调和最终验收。合同写清后再派活；不把大段实现读进自己的上下文。
- 实现交给 Grok `spawn_subagent`（默认 `general-purpose`，模型 `grok-4.5`）。子代理是 executor：按已锁定合同编码、跑测试/lint/typecheck（及合同要求的 Playwright），回报文件/命令输出/阻塞。不得再探产品、不得再派生子代理、不得自认主代理、不得改范围或核心架构。
- 歧义交回给我决策或问用户。4.6 + medium effort 足够执行；主代理不得把未想清的任务丢给子代理去“想”。
- Claude Code 只通过 Herdr 协作。文案/批量/机械改动必须先派 Claude，不得因 4.5 也能做就跳过。每个实现切片交付后必须再派 Claude 做独立审查（只交证据与建议，不得改范围或架构）。未在 Herdr 环境则如实说明，不得假装已审。
- 使用 Herdr 前先加载 `herdr` skill（用户级：`~/.grok/skills/herdr`）。未在 Herdr 环境中（`HERDR_ENV` 不为 1）时不得假装控制 session。
- 启动 Claude 必须传入 `--permission-mode auto`：`herdr agent start <name> --kind claude --pane <paneId> -- --permission-mode auto`。
- Windows 下若 npm shim 报 `%1 is not a valid Win32 application`，保留 pane 并用 `herdr pane run <paneId> "claude.cmd --permission-mode auto"` 恢复；确认 Herdr 已识别 Claude、界面显示 `auto mode on` 后再命名 agent 并派发任务。
- 调用完成、取消或确认无需继续后，立即关闭对应 Herdr pane。
- Herdr 的 prompt/wait timeout 只表示本次等待结束，不是取消或关闭依据；必须继续检查 agent 状态和可见/最近输出。
- 不得仅因耗时或 timeout 关闭仍有进展证据的 pane。遇到 `working`、`blocked` 或 `unknown` 时先读输出并处理提问、权限或环境问题。
- 只有代理已交付并进入 `done/idle`、明确取消、确认无需继续，或有充分证据证明进程无法继续时，才可关闭 pane；异常关闭必须记录证据和未完成项。
- 所有代理共享工作区，不得覆盖、回滚或整理与当前任务无关的他人改动。

## 标准工作流
1. 我读取本文件、仓库改动和 `docs/product/mvp.md`。
2. 实现任何用户需求前，向用户一次只问一个问题，直到有 ≥90% 把握理解需求，再写合同、改代码或派子代理。
3. 我明确用户故事、当前切片、接口、文件归属与验收条件。用户改范围时先更新 `mvp.md` 的必做/限制。
4. 实现切片用 `spawn_subagent` 分发给 Grok 子代理（`grok-4.6`）。文案、批量重命名、机械修补、i18n 填表等走 Herdr Claude。
5. 先打通文件真相上的前后端闭环，再扩展同一能力。
6. 我处理架构决策、代理依赖、冲突和风险。
7. 切片交付后：Herdr Claude 交叉审查 → 我审报告与测试输出。主代理不亲自跑测试。仅当合同验证缺失或相关测试失败时退回补跑。
8. 未满足验收条件不得宣称完成。

## 领域与实现原则
- 文本是证据；结构化数据要有稳定 ID 与 Provenance。
- Canon / 用户确认 与 AI 推断必须可区分；模型不得静默覆盖 Canon。
- LLM 输出先做 schema validation。
- 永久身份、跨章 Story State、镜头 Continuity 分层。
- Context Resolver 产出可检查快照；Provider 参数只留在 Binding / Compiler / Adapter。
- 外部副作用使用幂等键、超时、有限重试和归一化错误。

## 变更与质量门槛
- 新核心字段同步更新 schema、夹具和 `docs/product`。
- 密钥不进客户端、日志、项目 JSON、截图或提交记录。
- 保留工作区已有改动；修改聚焦当前切片。
- 子代理跑与改动相称的测试：新切片/核心路径跑相关套件；文案、文档、单测断言、小修补只跑直接相关的那几条，禁止为小问题整仓重跑。主代理只审报告，不亲自跑。

## 决策与汇报
- 关键决定写入 `docs/decisions/`。
- 汇报包含完成内容、修改文件、验证结果、风险和未完成项。
- 显著改变范围时：先按用户决策改写 `mvp.md`（限制只增补或按用户改写），再实现；数据模型/持久化歧义仍由我决策或询问用户。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
