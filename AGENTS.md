# AI Story Development Platform 协作说明

## 必读与优先级
- 任何代理在分析、规划、编码或审查前，必须完整读取本文件。
- 每次新任务都重新读取；本文件更新后以最新版本为准。
- 本文件必须保持精炼，不得超过 100 行。
- 已实现现状以 `README.md`、`docs/architecture.md`、`docs/api-contract.md` 和代码为准。
- 目标设计以 `docs/story-bible-engineering/README.md` 及其分卷为准。
- 数据不变量或模块边界冲突时，先停止扩展，记录 ADR 或请主代理决策。

## 产品方向
- 产品是面向长篇叙事的 AI-native 创作工作区。
- 核心价值是让正文、人物、设定、情节、场景状态与下游生成保持一致。
- 当前可运行基线是本地单用户 MVP；后续在其上演进 Story Bible、Context 和生成链路。
- 每次只推进一个 Phase 或清晰的 vertical slice，不因目标规格存在而默认扩大当前任务。

## 当前基线
- 技术栈为 Next.js App Router、TypeScript、Zod、SQLite、Vitest 和 Playwright。
- 已有路径：项目 → 故事圣经 → 大纲 → 章节 → AI 审核 → 改编 → Markdown 导出。
- 保存、自动恢复、版本历史、显式上下文和现有导出行为不得在演进中退化。
- PostgreSQL、队列、对象存储和真实媒体 Provider 是目标能力，不是当前已完成事实。

## 角色与职责
- subagent不可认为自己是主代理模型
- 主代理模型是gpt-5.6-sol effort为xhigh, 是产品构思者与架构负责人，负责范围、路线、接口、拆解、分发任务给subagent luna-max和claude code、协调和最终验收。
- `luna-max` 是主要实现代理，负责按任务说明编码、测试并报告变更。
- Claude Code 通过 Herdr 使用，负责重复性或机械性工作、批量处理及独立审查；启动时必须传入 `--permission-mode auto`（即 `herdr agent start <name> --kind claude --pane <paneId> -- --permission-mode auto`）。
- Claude Code 不自行改变产品范围或核心架构；发现问题时提交证据与建议。
- Claude Code 调用完成、取消或确认无需继续后，主代理立即关闭对应 Herdr pane。
- Herdr 的 prompt/wait timeout 只表示本次等待结束，不是取消或关闭依据；主代理必须继续检查 agent 状态和可见/最近输出，判断是否仍在工作、思考、组合结果、等待输入或已完成。
- 不得仅因耗时、单次或多次 timeout 关闭仍有进展证据的 pane。遇到 `working`、`blocked` 或 `unknown` 时先读取输出并处理提问、权限、进程或环境问题；必要时通过非破坏性交互请求状态或结果。
- 只有代理已交付并进入 `done/idle`、明确取消、确认无需继续，或经反复状态/输出检查与恢复尝试后有充分证据证明进程退出、损坏或无法继续时，才可关闭 pane；异常关闭必须记录证据和未完成项。
- 所有代理共享工作区，不得覆盖、回滚或整理与当前任务无关的他人改动。

## 标准工作流
1. 主代理读取本文件，检查仓库、已有改动和与任务相关的分卷。
2. 明确用户故事、当前 Phase、技术方案、文件归属与验收条件。
3. 将边界清晰的实现任务分发给 `luna-max`；机械处理或交叉审查可交给 Claude Code。
4. 先实现贯穿前后端的最小闭环，再扩展同一能力的广度。
5. 主代理处理架构决策、代理依赖、冲突、迁移和风险。
6. 审查全部结果，运行与风险相称的单元、集成和端到端检查。
7. 未满足验收条件不得宣称完成；发现缺陷时继续修复或明确报告阻塞。

## 领域与实现原则
- 文本是证据；结构化数据必须有稳定 ID、版本与 Provenance。
- Canon、Inferred 和 Pending Patch 必须可区分，模型不得静默覆盖 Canon。
- LLM 输出先做 schema validation；事实变更默认进入可审核 Patch。
- Scene 确定性关联优先，RAG 仅补充开放式历史上下文。
- Character Base、Scene State 与 Event 分层，临时状态不得污染永久设定。
- Context Builder 产出可检查快照；生成任务绑定不可变 Manifest。
- Provider 特定 ID、能力和参数只留在 Binding、Compiler 或 Adapter 层。
- 文档保存不等待 AI；分析或 Provider 失败必须可降级、可重试且不损坏正文。
- 外部副作用使用幂等键、超时、有限重试和归一化错误。

## 变更与质量门槛
- 新核心字段同步更新 schema、迁移、API 类型、测试夹具和相关文档。
- 迁移与批量改写先确认目标、跨项目隔离、并发策略和恢复路径。
- 密钥仅来自环境变量，不进入客户端、日志、Manifest、截图或提交记录。
- 保留用户已有改动；修改聚焦当前任务，旁支问题只记录不顺手扩大。
- 至少运行相关测试、lint、typecheck；高风险路径补 build 或 Playwright。
- 完成功能需覆盖正常、冲突、过期、重试和权限/项目隔离路径。

## 决策与汇报
- 关键决定记录背景、选择、取舍、迁移与影响，存入 `docs/decisions/`。
- 汇报包含完成内容、修改文件、验证结果、风险和未完成项。
- 显著改变范围、数据模型、持久化或用户体验的歧义，由主代理决策或询问用户。
