# 分阶段交付、实现约束与验收

> 对应原规范第 15–20 章；章节编号与规范关键词保持不变。

## 15. MVP 分阶段实现顺序

每一阶段完成后必须通过验收条件再进入下一阶段。不要一开始同时接入多个媒体 Provider。

### Phase 0：领域骨架与数据不变量

实现：

- 项目、文档、Scene、稳定 ID 与 revision；
- Entity、Alias、Fact、EvidenceSource；
- schema registry；
- 审计事件、outbox、optimistic concurrency；
- 基础 API 和迁移。

验收：

- Scene 重排后 ID 不变；
- Fact 修改产生 supersede 链而非覆盖；
- 跨项目 ID 无法读取或关联；
- migration、schema validation 和并发版本测试通过。

### Phase 1：实体识别与 Scene Link

实现：

- Scene 级异步分析任务；
- Character/Location/Prop 三类 mention；
- exact alias resolver；
- entity draft/stub；
- candidate/confirmed/rejected SceneEntityLink；
- UI 中的实体卡和链接审核。

暂不实现：Organization、复杂 Event、向量检索。

验收：

- 输入已知角色名可在目标 Scene 生成 confirmed link；
- 同名歧义不会自动 confirmed；
- 旧 revision 的分析结果不会覆盖新 revision；
- 删除文本后相关 mention 进入 stale/失效流程。

### Phase 2：Canon / Inferred / Pending Patch

实现：

- Fact extractor；
- Inference 独立存储；
- Pending Patch 状态机；
- accept/edit/reject；
- conflict detector；
- provenance UI。

验收：

- 模型不能直接写 Canon；
- 接受“银色耳钉”Patch 后可追溯到具体文本；
- 冲突事实不会 last-write-wins；
- 删除来源文本可生成 revalidation/retract 建议；
- Patch accept 并发重试保持幂等。

### Phase 3：Base / Scene State 与连续性

实现：

- Character Base 字段；
- Scene-specific state；
- carry-forward state resolver；
- 当前 Scene resolved state API；
- 换装、受伤、持有道具三类 state patch；
- 基础 continuity group。

验收：

- Scene 7 的西装不会污染 Scene 1；
- Scene 17 无 explicit wardrobe 时可按规则继承最近状态；
- 闪回 continuity group 不继承主时间线状态；
- 同优先级冲突能阻止生成并返回来源。

### Phase 4：Context Builder 与可检查快照

实现：

- confirmed links 确定性装配；
- purpose-based context policy；
- Base + State 解析；
- missing/conflict/warning；
- immutable Context Snapshot；
- Context Inspector UI。

验收：

- 同版本同 policy 生成相同 content hash；
- Context 中每个关键字段能回溯来源；
- 用户能看到被包含、遗漏和降级的内容；
- Story Bible 更新不会改变已启动任务的 Snapshot。

### Phase 5：Storyboard、Shot 与单 Provider 视频链路

实现：

- Storyboard/ShotSpec；
- Prompt Compiler；
- 一个视频 Provider Adapter；
- 文本 + 参考图两种输入路径；
- Generation Manifest、任务状态、结果资产和重试。

验收：

- 同一角色无需用户重复粘贴完整描述；
- Provider 不支持参考图时可明确降级为文本；
- 每个结果可查看完整输入快照、模型和参数；
- 外部重试不重复计费提交（在 Provider 能力允许范围内）。

### Phase 6：RAG 与更多实体/Provider

实现：

- Scene/Event chunk 和向量索引；
- hybrid retrieval + structured filters；
- 历史剧情策略；
- Organization、Event、Relationship 强化；
- character ID/voice ID bindings；
- 第二个 Provider 以验证适配层抽象。

验收：

- 关闭 RAG 时当前 Scene 的确定性上下文仍完整；
- RAG 不会跨项目召回；
- 第二 Provider 不要求修改 Story Bible schema；
- character ID 可优先于冗长文本，并在缺失时按规则降级。

### Phase 7：跨模态复用

实现：

- 续写、剧本、分镜、生图、视频、配音的独立 context policy；
- 视觉与声音 reference lifecycle；
- 生成结果回链到 Entity/Scene/Shot；
- 质量、成本和一致性评估。

验收：

- 同一 Canon 更新能按版本被多个下游消费；
- 每个下游只读取其所需字段；
- 生成资产不会未经确认反向成为 Canon。

---

## 16. Codex 实现注意事项与明确约束

### 16.1 开工顺序

Codex 执行本规范时 MUST：

1. 先检查仓库现状、`AGENTS.md`、技术栈、迁移和测试约定。
2. 若仓库为空，先建立最小模块化单体，不先建微服务。
3. 先实现领域类型、schema、迁移和不变量测试，再实现 LLM/Provider 调用。
4. 每次只推进一个 Phase 或一个明确 vertical slice。
5. 保留用户已有改动，不重写无关代码或配置。
6. 所有外部模型输出先经 schema validation；无效输出进入可观测失败状态。
7. 所有副作用操作支持 idempotency key、超时、有限重试和错误分类。
8. 新增核心字段或状态前同步更新本文、schema、migration、API type 和测试夹具。

### 16.2 明确禁止

Codex MUST NOT：

- 让 LLM 直接执行 SQL 或获得数据库写权限；
- 将 Canon 和 Inferred 放入同一无类型文本字段；
- 把整个 Story Bible 拼进每次 Prompt；
- 在生成时临时用 LLM 猜测 Scene 中有哪些角色；
- 用角色名称作为外键；
- 覆盖旧 Fact、Context Snapshot 或 Generation Manifest；
- 将 Scene 临时服装写成唯一的角色默认服装；
- 把 provider-specific character ID 放入通用 Character attributes；
- 依赖模型置信度作为唯一自动接受依据；
- 把 vector database 当事务数据库；
- 在日志中记录 Provider secret、未脱敏凭证或不必要的完整用户文本；
- 因分析/Provider 失败而阻止文档保存。

### 16.3 测试要求

至少覆盖：

**单元测试**

- alias normalization 与歧义；
- Patch 状态机和 conflict rules；
- state precedence/carry-forward；
- context budget 和字段排序；
- capability-based compiler fallback；
- provider error normalization。

**集成测试**

- revision -> analysis -> patch -> accept -> Story Bible；
- Scene link -> context snapshot -> compile -> manifest；
- 并发接受同一 Patch；
- Entity merge 后历史 link/fact 查询；
- 跨项目数据隔离；
- webhook 重放和任务幂等。

**Golden tests**

- 固定 Story Bible + Scene + capability profile 产生稳定 compiler output；
- 模型 schema 输出夹具覆盖缺字段、错 ID、越权 predicate、过期 revision；
- 中英文 alias、姓名重名、代词歧义和闪回案例。

### 16.4 可观测性

每个异步和模型步骤至少记录：

- request/trace ID；
- project/document/scene ID（遵循隐私策略）；
- revision 和 analyzer/compiler version；
- latency、token/费用、重试次数；
- input/output schema validation 状态；
- Patch 数、冲突数、接受率；
- Context 缺失/裁剪/warning；
- Provider job ID 和归一化错误类别。

指标不得把模型“输出了内容”当成功；成功必须由领域结果和验收条件定义。

### 16.5 安全与隐私

- 外部 Provider 调用前显示或记录实际发送的数据类别。
- 项目可配置哪些字段/资产允许发送给哪些 Provider。
- 导出/删除必须覆盖向量索引、缓存、任务 payload 和对象存储。
- 对人物参考图、声音和人脸/声纹绑定保留来源、授权和用途 metadata。
- 模型输出和上传内容执行适当的内容安全检查，但安全标记不得无痕改写作者原文。

### 16.6 性能目标（MVP 建议值）

- 文档保存接口 p95 < 300 ms，不等待 LLM。
- 唯一 alias 的本地解析 p95 < 100 ms。
- 普通 Scene Context Build（不含 RAG）p95 < 1 s。
- 分析任务允许异步数秒完成，UI 提供状态。
- Scene Context 查询避免 N+1；按 link、fact、state 批量加载。

这些值是工程目标，不是硬 SLA；实现应建立基准测试后调整。

### 16.7 Definition of Done

一个功能只有在以下条件全部满足时才算完成：

- 领域不变量和权限检查已实现；
- schema、migration、API 类型同步；
- 正常、冲突、过期和重试路径有测试；
- UI/接口能解释来源、缺失和错误；
- 关键异步步骤可观测；
- 不泄漏 Provider 特定字段到领域模型；
- 文档已更新；
- 无需手工修改数据库即可演示完整 vertical slice。

---

## 17. 关键验收场景

以下场景用于端到端验收。

### 场景 A：角色卡随写作补全

作者先写：

```text
林默推开酒吧的门。他还是穿着那件洗得发白的黑色风衣。
```

期望：

1. 创建或链接 `林默` Character；
2. SceneEntityLink 为 `appears`；
3. 提出 `wardrobe.current = 洗得发白的黑色风衣` 的 Scene State Patch；
4. 不把风衣无条件覆盖为永久 Base；
5. Patch 带原文 anchor 和 Scene revision。

随后作者写：

```text
林默下意识摸了摸左耳的银色耳钉。
```

期望：

1. 提出 `appearance.distinctive_features += 左耳银色耳钉`；
2. 若无冲突，显示为 Canon Patch；
3. 接受后事实可追溯到本句；
4. 拒绝后相同 revision 不重复弹出。

### 场景 B：Base 与 State 不互相污染

Scene 1 林默穿黑色风衣，Scene 7 换黑色西装，Scene 17 淋雨后湿发。

期望：

- 重新生成 Scene 1 时使用黑色风衣；
- Scene 7 使用黑色西装；
- Scene 17 使用按连续性解析的当前服装 + 湿发；
- `appearance.hair` 的 Base 不被“湿发”覆盖。

### 场景 C：模型能力差异

对同一 Shot：

- Provider A 支持 character ID：使用 Binding + 当前 Scene State；
- Provider B 仅支持参考图：附角色 reference assets + 简短 identity/state 文本；
- Provider C 仅支持文本：编译完整但受预算控制的 visual identity + state；
- 三条路径引用同一 Context Snapshot，差异只存在 compiler/adapter 输出。

### 场景 D：必要历史剧情

当前 Scene 中夏禾质问林默此前隐瞒的事故。

期望：

- 当前出镜角色、地点、道具从 confirmed links 读取；
- “事故”若有已确认 Event link，直接读取；
- 只有为补充事故经过时才检索相关旧 Scene；
- RAG 结果携带 Scene/revision/source，且不自动成为 Canon。

---

## 18. 首个 Vertical Slice 建议

为降低实施风险，第一个可演示闭环只覆盖：

```text
一个项目
  -> 一个剧本文档
  -> 多个稳定 Scene
  -> Character/Location/Prop 实体识别
  -> SceneEntityLink
  -> 一个角色外观 Fact Patch
  -> 一个 wardrobe Scene State Patch
  -> 用户接受
  -> Context Inspector
  -> 一个 ShotSpec
  -> 一个 Provider 的文本/参考图编译预览
  -> 保存 Generation Manifest
```

首个闭环可以先不真正调用收费 Provider；Adapter 使用 fake provider 也必须走完整 validate/prepare/submit/result 接口。完成该闭环后，再接真实 Provider，避免在领域模型未稳定时被外部 API 细节牵引。

---

## 19. 待决策项

以下问题不阻塞 Phase 0，但进入相关阶段前必须形成 ADR：

1. 编辑器文档模型与稳定 text anchor 方案（ProseMirror、Lexical 或其他）。
2. screenplay 标准格式与 Fountain/Final Draft 导入边界。
3. 复杂时间线、闪回和平行世界的统一建模深度。
4. Fact predicate schema 是代码生成、数据库注册还是混合方式。
5. 自动接受策略是否开放给用户，以及允许的 predicate 白名单。
6. 参考图批准、版本和角色一致性评估方法。
7. Provider capability profile 的维护、探测和回滚流程。
8. Context Snapshot 的保留周期与敏感内容删除语义。
9. 生成结果是否允许一键反向提出 Story Bible Patch；默认只能提出，不能自动写入。
10. 多人协作下 Patch 审核权限与 Canon owner 模型。

---

## 20. 实现摘要

系统的关键不是“每次生成前让模型重新理解整个剧本”，而是建立一条可审计的数据路径：

```text
作者文本
  -> 稳定 Scene / revision
  -> mention 与实体解析
  -> Canon / Inferred / Pending Patch
  -> confirmed SceneEntityLink
  -> Base + Scene State
  -> deterministic Context Builder
  -> optional bounded RAG
  -> ShotSpec
  -> capability-aware Prompt Compiler
  -> Provider Adapter
  -> immutable Generation Manifest
```

只要 Canon 边界、Scene 确定性关联、Base/State 分层和 Context Snapshot 四个基础不变量正确，后续增加模型、媒体类型和工作流时不需要重建核心 Story Bible。
