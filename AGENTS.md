# AI Story Development Platform 协作说明

## 优先级
- 本文件只记协作。Grok 已自动注入，不要为仪式再通读；改过则以磁盘最新文本为准。全文（不含 next 自动块）不得超过 100 行。
- **构思 / 路线 / 讨论**：对照 `docs/product/concept.md` 与用户当场表达。`mvp.md` 的必做、限制、切片表不是思考上限，不得用它们结束尚未写进基线的想法。
- **写代码 / 派切片**：以 `docs/product/mvp.md` 为唯一实现基线。`concept.md` 与旧切片不得单独当作实现许可，但可以作为构思材料。不要双栈 SQLite。
- 用户改口后先改 `mvp.md` 必做/限制（必要时 ADR）再实现。最新用户覆盖优先于旧句。换芯见 `docs/decisions/014-visual-workflow-rebuild.md`。
- `main` 仍以旧 README / `docs/architecture.md` / 代码为准。数据不变量或模块边界冲突时先停，记 ADR 或问用户。
- 用户在网页终端里看程序：起 `npm run dev`（127.0.0.1:5173，Caddy 已反代），用户打开 https://dev.wonderfaker.online（basic auth `pad`）。不要改用 3000。需要看时再起，看完可停。

## 角色
- 主代理：Grok 4.6，effort 用会话默认（`xhigh`）。负责产品构思、架构、范围、路线、接口、拆解、分发、验收。先形成产品判断，再决定问不问、派不派。
- 实现：`spawn_subagent` `general-purpose`，模型 **grok-4.6**，effort **medium**。按已锁定合同编码并跑测试/lint/typecheck（及合同要求的 Playwright），回报文件/命令/阻塞。不得再探产品、再派生子代理、自认主代理、改范围或核心架构。
- 主代理必须自己想清再派。禁止把整仓实现读进主上下文；**必须**读当前问题会错的那几处（生成、导演、Outputs、相关 schema）。
- 提问：只有真正的产品分叉才问，一次一个。已说清的指令直接执行。先给判断与推荐，再问。
- 用户把主代理放在 Herdr 里，就是为了和 Antigravity（Gemini 3.7 Flash，kind `agy`）对抗性合作：互相挑错、交叉审查。不是单向派活、主代理盖章。不使用 Claude。
- 分工：schema、生成、导演、落盘由 Grok / 4.6 实现。agy 不能改后端，只审查并给建议。前端审美、布局、层次、对照别人界面、文案观感派给它，并让它审 Grok 的界面。能拆就派。界面观感优先信它；后端建议由主代理判断。界面审查未过不得宣称完成。
- 共享工作区：不得覆盖、回滚或整理与当前任务无关的他人改动。

## Herdr
- 先 `test "${HERDR_ENV:-}" = 1`。不在 Herdr 里就说明并停手，不得去控当前 session。用法以 `herdr --skill` 为准，语法以已装 binary 为准：`herdr --help`、`herdr agent`、`herdr pane`。不要裸跑 `herdr`（会进 TUI）。
- 先拆 pane 再 `agent start`：start 不建布局。默认当前 tab 兄弟 pane、cwd 仓库根、`--no-focus`。先 `herdr pane layout --pane "$HERDR_PANE_ID"`：宽向右拆、窄/高向下拆。从 JSON 读 `.result.pane.pane_id`，不要猜侧栏。
- 目标 pane 须在交互提示符且前台无命令/编辑器/代理。`herdr agent start <name> --kind agy --pane <paneId>`；name 匹配 `[a-z][a-z0-9_-]{0,31}` 且现场唯一。只对 `--current`、明确 paneId 或唯一 agent 名操作。
- 已识别代理用 `herdr agent prompt <name> "…" --wait`，读 `agent get` / `agent read --source recent-unwrapped`。`--wait` timeout 与 `agent_prompt_stalled` 只表示本次等待结束。`idle`/`done` 才是可接收下一句；`blocked` 先读再送键；`unknown` 不是完成。
- start 超时但 pane 已是 agy 界面：改 `pane send-text` + Enter。别屏读不到全文时，让它把结论写文件再读盘。测试/命令用 `pane run` / `pane wait-output`，不要误走 agent 面。
- 不得关自己没建的 workspace/tab/pane；自己建的也要等完成、取消或确认无需继续才关。禁止 `herdr server stop`、禁止杀主 Herdr 进程。

## 工作流
1. 产品讨论从用户原话和 `concept.md` 起；需要落地时才对照 `mvp.md` 与仓库改动。
2. 先给出产品判断。真正分叉才问；问清后再写合同。
3. 合同写清用户故事、切片、接口、文件归属、验收。改范围先改 `mvp.md`。
4. 核心后端切片派 4.6 / medium。界面审美与前端呈现派 Antigravity（走 Herdr），能并行就并行。
5. 先打通文件真相上的前后端闭环，再扩展同一能力。
6. 架构、代理依赖、冲突由主代理处理。对抗审查单向：agy 审界面并对 Grok 后端给建议；Grok 不审 agy 的后端。
7. 切片后主代理审报告与测试输出。主代理不跑测试；合同验证缺失或相关测试失败才退回补跑。界面切片还要过 agy 观感审查。禁止为小问题整仓重跑。
8. 未满足验收不得宣称完成。
9. 不要在已经很长、刚压缩过、或余额不足的会话上开 `/goal`。产品理解在主会话谈完，再派短合同。用户当场纠正产品后写入 `mvp.md`。

## 领域原则
- 文本是证据；结构化数据要有稳定 ID 与 Provenance。
- Canon / 用户确认 与 AI 推断必须可区分；模型不得静默覆盖 Canon。
- LLM 输出先做 schema validation。永久身份、跨章 Story State、镜头 Continuity 分层。
- Context Resolver 产出可检查快照；Provider 参数只留在 Binding / Compiler / Adapter。
- 外部副作用使用幂等键、超时、有限重试和归一化错误。

## 质量与汇报
- 新核心字段同步更新 schema、夹具和 `docs/product`。密钥不进客户端、日志、项目 JSON、截图或提交。
- 修改聚焦当前切片；保留他人改动。子代理跑与改动相称的测试。
- 关键决定写入 `docs/decisions/`。汇报含完成内容、修改文件、验证结果、风险、未完成项。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
