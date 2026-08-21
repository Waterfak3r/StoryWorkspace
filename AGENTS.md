# AI Story Development Platform 协作说明

## 优先级
- 本文件只记协作。Grok 已自动注入，不要为仪式再通读；改过则以磁盘最新文本为准。全文（不含 next 自动块）不得超过 100 行。
- **构思 / 路线 / 讨论**：对照 `docs/product/concept.md` 与用户当场表达。`mvp.md` 的必做、限制、切片表不是思考上限，不得用它们结束尚未写进基线的想法。
- **写代码 / 派切片**：以 `docs/product/mvp.md` 为唯一实现基线。`concept.md` 与旧切片不得单独当作实现许可，但可以作为构思材料。不要双栈 SQLite。
- 用户改口后先改 `mvp.md` 必做/限制（必要时 ADR）再实现。最新用户覆盖优先于旧句。换芯见 `docs/decisions/014-visual-workflow-rebuild.md`。
- `main` 仍以旧 README / `docs/architecture.md` / 代码为准。数据不变量或模块边界冲突时先停，记 ADR 或问用户。
- 用户在网页终端里看程序：起 `npm run dev`（127.0.0.1:5173，Caddy 已反代），用户打开 https://dev.wonderfaker.online（basic auth `pad`）。不要改用 3000。需要看时再起，看完可停。

## 角色
- 主代理：Antigravity（Gemini 3.7 Flash，kind `agy`）。主导产品设计、范围定义、体验迭代、切片规划、前端审美与交互审查，以及最终质量验收。
- 执行协调：主 Grok（Grok 4.6）。负责具体代码架构设计、模块建构与任务拆解。主 Grok 自身不负责具体编码与自审，而是派发 `subagent` 执行后端编码，并派出独立 `subagent` 进行后端代码审查与测试验证。
- 前端审查：由 Antigravity 统一负责前端审美、交互流畅度、视觉层级与文案审查。
- 分工协同：Antigravity 使用全英文（English）下发切片合同与通用契约（ADR 030）→ 主 Grok 架构拆解并派发子代理实现/后端自审 → Antigravity 进行前端审查与终审验收。
- 切片合同：由主 Grok 编写技术实现层合同（文件归属、接口设计、测试策略），Antigravity 审查合同的方向性问题（是否为测试特例扭曲了通用工作流代码、是否违反 ADR 030）。
- 后端审查分工：深度逻辑与架构审查由 Grok 的独立审查子代理负责。Antigravity 跑自动化门禁脚本（`typecheck` / `vitest` / `git grep`），并人工审查代码是否存在为通过测试而特殊化生产逻辑的行为。
- 前端视觉方向由 Antigravity 主导定义，具体前端代码实现由 Grok 子代理编码。
- 提问：只有真正的产品分叉才问，一次一个。已说清的指令直接执行。
- 共享工作区：不得覆盖、回滚或整理与当前任务无关的他人改动。

## Herdr
- 先 `test "${HERDR_ENV:-}" = 1`。不在 Herdr 里就说明并停手，不得去控当前 session。用法以 `herdr --skill` 为准，语法以已装 binary 为准：`herdr --help`、`herdr agent`、`herdr pane`。不要裸跑 `herdr`（会进 TUI）。
- 先拆 pane 再 `agent start`：start 不建布局。默认当前 tab 兄弟 pane、cwd 仓库根、`--no-focus`。先 `herdr pane layout --pane "$HERDR_PANE_ID"`：宽向右拆、窄/高向下拆。从 JSON 读 `.result.pane.pane_id`，不要猜侧栏。
- 目标 pane 须在交互提示符且前台无命令/编辑器/代理。`herdr agent start <name> --kind <kind> --pane <paneId>`；name 匹配 `[a-z][a-z0-9_-]{0,31}` 且现场唯一。只对 `--current`、明确 paneId 或唯一 agent 名操作。
- 已识别代理用 `herdr agent prompt <name> "…" --wait`，读 `agent get` / `agent read --source recent-unwrapped`。`--wait` timeout 与 `agent_prompt_stalled` 只表示本次等待结束。`idle`/`done` 才是可接收下一句；`blocked` 先读再送键；`unknown` 不是完成。
- start 超时但 pane 已是 agent 界面：改 `pane send-text` + Enter。别屏读不到全文时，让它把结论写文件再读盘。测试/命令用 `pane run` / `pane wait-output`，不要误走 agent 面。
- **单切片单会话（防降智）**：主 Grok 每次完成并验收完一个切片任务后，Antigravity 负责关闭旧 session 并新开全新 session 承接下一任务，杜绝长会话 compact 导致智力衰减。
- 不得关自己没建的 workspace/tab/pane；自己建的也要等完成、取消或确认无需继续才关。禁止 `herdr server stop`、禁止杀主 Herdr 进程。

## 工作流
1. 产品讨论从用户原话和 `concept.md` 起；需要落地时才对照 `mvp.md` 与仓库改动。
2. Antigravity 给出产品方向与用户故事（英文），主 Grok 编写技术切片合同（文件、接口、测试策略），Antigravity 审查合同方向后确认。
3. 主 Grok 在全新的干净 session 中执行合同，派发 `subagent` 编码并派发独立子代理跑测试与后端审查。
4. **中途阻塞**：Grok 发现合同无法按原样执行时，必须立刻暂停并向 Antigravity 报告阻塞原因与建议修改，由 Antigravity 决定调整合同还是变更范围。
5. 交付门禁：Antigravity 跑自动化门禁（`typecheck` / `vitest` / `git grep`）+ 人工审查代码是否为测试特殊化了生产逻辑。前端视觉由 Antigravity 审查。
6. 验收完成后，Antigravity 清理当前 Grok session，为下一个任务新开 session。
7. 未通过 Antigravity 审查与全量测试验收严禁宣称完成。用户当场纠正产品后写入 `mvp.md`。

## 领域原则
- 文本是证据；结构化数据要有稳定 ID 与 Provenance。
- Canon / 用户确认 与 AI 推断必须可区分；模型不得静默覆盖 Canon。
- LLM 输出先做 schema validation。永久身份、跨章 Story State、镜头 Continuity 分层。
- **反硬编码与通用契约（ADR 030）**：生产代码（`src/studio/**`、`src/features/**`）严禁出现任何特定测试故事的人名、专名、道具、台词或情节正则；专名只准留在 `test/` 夹具。代码只负责结构、时序、引用完整性与落盘，所有分场、状态演进、说话人与分镜判断必须走 `Prompt → LLM (JSON) → Zod`。无 Provider 时只能返回空推断或保守 fallback，严禁在本地用假规则伪造推断结果。
- Context Resolver 产出可检查快照；Provider 参数只留在 Binding / Compiler / Adapter。
- 外部副作用使用幂等键、超时、有限重试和归一化错误。

## 质量与汇报
- 提交前必须经 agy 代码审查确认无专有词/假规则注入。违反硬编码直接判定无效交付，审查（agy）拥有一票否决权。
- 新核心字段同步更新 schema、夹具和 `docs/product`。密钥不进客户端、日志、项目 JSON、截图或提交。
- 修改聚焦当前切片；保留他人改动。子代理跑与改动相称的测试。
- 关键决定写入 `docs/decisions/`。汇报含完成内容、修改文件、验证结果、风险、未完成项。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
