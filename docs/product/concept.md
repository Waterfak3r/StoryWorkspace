# 产品总纲：故事影像创作工作流

本文件是产品方向真相，供构思与路线使用。来源是桌面《整体构思》v0.2。写进仓库的范围以 [mvp.md](./mvp.md) 为准；读本文件不等于许可扩大当前实现。旧版长篇叙事工作区文档仍描述 `main`，不再约束本分支。

`Agents.md` 只保留协作规则，不再复述本节。讨论整条链时以本文件为准，不要先被 `mvp.md` 的限制表掐掉。

## 定位

本地优先、API 驱动、以故事结构和可复用资产为核心的 AI 漫画 / 影像工作流工具。不是在线 SaaS，也不是模型聚合器。实现时每次只推进一个清晰 vertical slice。讨论整条链（含尚未进 mvp 的视频 / 配音 / 音乐 / 合成）是本文件的用途，不是越权。

核心目标：角色、地点、道具、服饰、对白、风格等信息只描述并确认一次；大纲图随故事变密；分镜与生图只引用这些已确认单元，不另写一套人设或再扫一遍原文。

四条一致性由层保证，不是四句 prompt：风格来自项目 Style；人物来自稳定 Entity + 参考图；情节来自本场在大纲图上的位置；逻辑来自跨场 Story State；对白来自已确认的场×人物台词。

真正的核心不是某个视频模型，而是：

> Story Model + Entity/Asset System + State/Continuity + Confirmed Dialogue + AI Director + Context Resolver + Prompt Compiler + Workflow Engine

图片、视频、TTS、音乐 API 都只是最后接在这套系统后面的执行器。

## 原则

1. 信息只描述一次，且必须持久化。场、页、prompt 只引用 Entity / 确认对白 / 当前状态的 ID，不复制人设，不在生图时重读剧本抽词。
2. AI 负责重复劳动，人负责创作判断。正文、实体、分镜、Prompt、模型、参考图、单节点重跑和锁定结果始终可由用户控制。
3. 自动化不等于黑盒。任何节点都要能打开看输入、上下文、自动 Prompt、覆盖、输出和日志。
4. 漫画、视频、配音、音乐消费同一套故事上下文。
5. Canon / 用户确认 与 AI 推断必须可区分；模型不得静默覆盖用户已确认内容。

## 八层

1. **Story** — Volume / Chapter / Scene / Shot，剧本仍是人工主输入。
2. **Entity** — Character / Location / Prop / Organization。
3. **Asset & Identity** — 视觉参考、声音参考；Entity 与媒体文件分离。
4. **State** — Story State（跨章）与 Continuity State（镜头级）分层。
5. **Style & Intent** — 项目风格 + 局部覆盖 + 创作者语言的 Intent。
6. **AI Intelligence** — Parse / Director / Context Resolver / Prompt Compiler。
7. **Generation** — Image 先做；Video / Voice / SFX / Music 后做。
8. **Composition** — 混音、合成、导出。后期。

外层由 **Workflow Engine** 贯穿：范围、Run、依赖、确认点、重试、版本、Lock、Stale、Provenance。

## 入口

- 从零写大纲或剧本，再补实体。
- 导入已有 TXT / Markdown / DOCX / PDF / 粘贴文本 → AI 解析 → 人工确认。

## 页面

```
Projects
Project Workspace
├── Overview
├── Story        结构树 + 剧本编辑 + 当前上下文
├── Assets       Entities / Media / Style / Music
├── Workflow     可执行流水线（核心演示区）
├── Outputs      按故事结构或媒体类型查看
└── Settings     Provider、默认模型、项目风格
```

## 生产链

```
Story / Script → Parse → Entity Extraction → Scene Analysis
  → AI Director → Storyboard（可人工改）
  → Context Resolver → Prompt Compiler
  → Image → Video → Voice / SFX / Music → Mix → Compose → Export
```

不必每次跑完整条。生成范围（本章 / 本镜）与上下文范围（向前取状态）必须分开。
