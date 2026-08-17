# AI-native 剧本编辑器与 Story Bible 工程设计规范

> 文档状态：Draft v0.1  
> 目标读者：实现代理、产品工程师、后端工程师、AI/生成管线工程师  
> 默认技术假设：TypeScript 单体仓库、PostgreSQL、对象存储、异步任务队列；具体框架可替换  
> 规范关键词：**MUST** 表示必须满足，**SHOULD** 表示无充分理由不得偏离，**MAY** 表示可选实现

## 使用说明

本目录由原始单文件工程规范按主题拆分而来。正文保留原章节编号，规范性要求未改写；后续修改应直接落到对应分卷，避免重新维护一份重复的总文档。

仓库现有的 [MVP Architecture](../architecture.md)、[MVP Delivery Plan](../mvp-plan.md)、[API Contract](../api-contract.md) 和 [Workspace UX](../workspace-ux.md) 描述已经实现的本地 SQLite MVP。本目录描述下一阶段目标架构。两者不一致时，不应直接假定代码已经完成迁移。

## 阅读顺序

1. [产品边界与核心原则](./01-product-and-principles.md)：文档目的、目标、非目标与基础原则。
2. [系统架构与核心领域模型](./02-architecture-and-domain.md)：逻辑架构、运行时分层、Entity、Fact、Inference、Relationship、Event 与 Provenance。
3. [Canon、Scene Link 与状态模型](./03-canon-links-and-state.md)：Patch、冲突、Scene-Entity 关系及 Base/State/Event 分层。
4. [写作与视频化工作流](./04-authoring-and-generation-workflows.md)：增量分析、审核体验、Storyboard、Shot 与生成阻断条件。
5. [Context、Provider 与 RAG 边界](./05-context-providers-and-rag.md)：确定性上下文、能力感知编译、适配器和受控检索。
6. [API、模块边界与持久化](./06-api-and-persistence.md)：模块/API、领域事件、表结构、SQL 示例与数据不变量。
7. [分阶段交付、实现约束与验收](./07-delivery-and-acceptance.md)：Phase 0–7、实现约束、测试、验收场景、首个闭环与待决策项。

## 在当前仓库中的采用方式

- 现有 Next.js 模块化单体继续作为演进基础，不为贴合目录示例而先行拆微服务或多包仓库。
- SQLite 是当前可运行基线；切换 PostgreSQL、对象存储或队列前，先记录 ADR、迁移路径、回滚方式和测试策略。
- 先完成一个明确 Phase 或 vertical slice，再推进下一个；未满足该阶段验收条件时不得宣称完成。
- 新领域字段必须同步更新 schema、持久化迁移、API 类型、测试夹具和相关分卷。
- 原规范中的数据不变量优先于临时实现便利；若确需改变，先更新规范和 ADR。
- 首选演进起点是第 18 章的首个 Vertical Slice，但具体开工范围仍由当前任务决定。
- 当前 Phase 0–5C 采用方式：在 SQLite/Next 本地单体内落地稳定 revision、deterministic scene analysis、Canon Patch review、document-scoped continuity group、独立 EntityState resolver、deterministic Context Snapshot/Inspector、绑定 Snapshot 的 immutable Storyboard/ShotSpec、capability-aware Fake Video 编译预览，以及 immutable Manifest + CAS Job + normalized Fake Result 完整本地生成边界；这不是 PostgreSQL、托管队列、RAG、复杂故事时间线、对象存储或真实媒体 Provider 已接入的声明。

## 维护规则

- 分卷之间使用相对链接；不要依赖原文档的外部绝对路径。
- 关键架构选择写入 [decisions](../decisions/)；规格正文保留长期约束，ADR 记录背景与取舍。
- 现状发生变化时同步更新现有架构文档和本索引中的采用说明。
