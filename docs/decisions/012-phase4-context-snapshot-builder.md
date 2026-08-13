# ADR 012：Phase 4 确定性 Context Builder 与不可变快照

## 背景

Phase 0–3 已建立当前 SceneRevision、confirmed SceneEntityLink、Base Canon Fact 与可解析的 Scene State。Phase 4 需要把这些数据转成下游可消费、可检查且不会在生成途中漂移的输入，但不能在装配时重新让模型猜实体，也不能把候选 Link、Inference、RAG 或 Provider 字段混入确定性上下文。

## 决策

1. SQLite schema v14 新增 `context_snapshots`。Snapshot 固定当前未删除 SceneRevision、purpose、代码拥有的 policy/version、完整结构化 content、input/content hash、latest 标记和创建时间；content 与身份字段不可更新，重建只会创建或复用另一不可变 Snapshot。
2. 首个切片提供 `storyboard-default-v1` 与 `video-default-v1` 两个 provider-neutral policy。请求的 purpose 必须与 policy 匹配，`allowInferred` 固定为 false；RAG、资产、关系和 Event 暂不伪装成已装配能力，内容中的对应集合保持显式为空。
3. Builder 只接受当前保存的 SceneRevision。它按稳定顺序读取该 revision 的 confirmed Link，批量装配同项目 active/draft、未合并 Entity，按 policy 读取 active Canon Base Fact，再对 confirmed Character 调用 Phase 3 resolver。candidate/rejected/stale Link 与 Inference 不参与 included context。
4. Snapshot content 保存 Scene 原文与 hash、Entity/role/link、Base Fact、resolved State、provenance，以及 `missing`、`conflicts`、`warnings`、`omitted`。状态同层同 priority 冲突为 blocking；无 confirmed Character 为 blocking missing；地点或视觉 identity 缺失为 warning，不由 Builder 杜撰 fallback。
5. Budget 是 policy 的结构化限制：Scene 文本、Entity 数和每实体 Base Fact 数分别裁剪，顺序固定；所有因 policy、确认状态或预算未纳入的记录都进入 `omitted`，预算裁剪同时产生 warning。Builder 不使用只有总 token 数的黑盒截断。
6. `contentHash` 对不含 Snapshot ID/createdAt 的 canonical content 做稳定 SHA-256；相同版本、数据和 policy 得到相同 hash。`inputHash` 另固定 Scene、policy 和参与记录的 ID/version。项目内相同 content hash 复用 Snapshot，并在事务内切换同 Scene/purpose/policy 的 latest 标记。
7. `POST /api/projects/:projectId/contexts/build` 使用完整 request fingerprint 和既有 `idempotency_keys`；相同 requestId/相同输入返回原结果，不同输入返回 `IDEMPOTENCY_CONFLICT`。首次持久化同时写 `context.built` audit/outbox。`GET /contexts` 与 `GET /contexts/:contextId` 只做项目隔离读取。
8. Scripts workspace 只允许对已保存 revision build；Context Inspector 展示 included、missing、conflict、warning、omitted 和 provenance，不将 Snapshot 自动提交给 Provider。Phase 5 的 Storyboard/Shot/Compiler/Manifest 必须引用这里产生的 Snapshot ID，不能重新读取实时 Story Bible 代替它。

## 迁移与影响

- v13→v14 是 additive migration，不重建 Phase 0–3 表；现有项目无需数据回填，首次 build 时才产生 Snapshot。
- Snapshot latest 只是可变索引元数据，不改变已冻结 content。旧 Snapshot 仍可按 ID 读取，Story Bible、Link 或 State 后续变化不会修改它。
- 当前没有全局 Story Bible revision，因此 input identity 显式列出参与的 Link/Entity/Fact/State ID 与 version；后续若引入聚合 revision，可追加到 cache key，但不能替换细粒度 provenance。
- Context Builder 不调用 Provider、不写 Canon、不运行 RAG。Phase 5 只消费 Snapshot，Provider 能力差异仍留在 Compiler/Adapter。

## 验收

- 同一 SceneRevision、数据与 policy 重建得到同一 content hash，request/semantic retry 不重复创建。
- 每个 included Base/State 字段可追溯到 record 与 Evidence；candidate Link、Inference 与跨项目记录无法进入 Snapshot。
- missing、blocking State conflict、policy omitted 与 budget warning 在 API/UI 中可见；blocking 不被 last-write-wins 消解。
- 新 Fact/State/Link 产生的新 Snapshot 不修改旧 content，并使旧 Snapshot 不再 latest。
- stale/deleted revision、requestId 冲突、跨项目读取和直接 SQL 篡改由 repository/DB 测试拒绝。
