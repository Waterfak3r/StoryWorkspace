# ADR 010：Phase 2 Canon Patch 与 Inference 审核闭环

## 背景

Phase 1 已能从稳定的 SceneRevision 产出实体 mention/link，但模型或规则结果不能直接改写 Story Bible。Phase 2 需要在 SQLite MVP 中提供可追溯的事实候选、审核状态和并发安全的 Canon promotion。

## 决策

1. `model_runs`、`inferences`、`pending_patches`、`patch_evidence` 与 `patch_applications` 使用附加迁移 v9 持久化；v10 收紧 Pending Patch 为 Canon-only，并要求 operation 对应的 target/baseVersion 形状；v11 增加 Fact/Inference scope shape、同项目 `entity_ref` 解析及 accepted Fact/Application provenance guards；v12 要求 accepted Patch 的非空 ModelRun 已 succeeded 且绑定 source revision，并拒绝混入其他 revision/model 的 Patch/Inference evidence；旧的 `facts` 只新增可空 `promoted_from_inference_id`，不修改历史值。
2. 确定性 fact fixture 先写 `ModelRun(succeeded)`、Evidence 和独立 `Inference(inferred)`，再写 `PendingPatch(canon, pending)`。任何模型/规则路径都不能直接写 Canon Fact。
3. Patch 的 payload、evidence、model provenance 是不可变数据；状态只能由 `pending` CAS 到 `accepted`、`rejected`、`expired` 或 `superseded`，每次状态变化递增 version。接受、拒绝和 Canon supersede/retract 在同一 SQLite 事务中完成。
4. `accept` 在事务内重新校验 source SceneRevision、Evidence anchor、target Fact/entity version、predicate registry、scope、cardinality 和当前 active Canon。hard conflict 返回 409，不采用 last-write-wins。`accept-edited` 只允许修改 schema-valid `value`；subject、predicate、valueType、scope 与 scene/range bounds 必须保持原 Patch 不变，并保留原 Patch 与实际 applied payload。
5. Request ID 的幂等记录保存规范化输入 fingerprint；同一请求同输入返回原资源和原 PatchApplication，不同输入返回 409。相同 SceneRevision 的语义候选也通过 fingerprint 去重，避免拒绝后重复建议。
6. 新 Revision 删除已采纳事实的文本证据时，只产生 revision-bound `retract_fact` Pending Patch；不会自动撤回 Canon。证据失效 Patch 需用户审核。
7. Provider/LLM 尚未接入；`deterministic-fixture` 与 `deterministic-revalidation` 仅作为可替换的 ModelRun adapter，禁止把 provider-specific 数据放入 Fact。

## 取舍与影响

- Patch promotion 的业务不变量由事务 repository 负责，数据库 triggers 负责 project guard、immutable payload/provenance、状态/version 和 Junction 约束；PostgreSQL/RLS、分布式 worker 和真实模型留在后续阶段。
- Evidence anchor 的边界和逐字引用由 repository 在提议与接受时按 JavaScript UTF-16 offset 复核；SQLite 层只锁定不可变 SceneRevision、ModelRun 和 evidence 归属。SQLite `length`/`substr` 按 Unicode code point 计数，若在 trigger 中重复 UTF-16 切片规则会误拒绝包含辅助平面字符的正文，因此当前不做不等价的数据库文本切片校验。未来若统一 anchor 为 code-point offset，再将该校验下沉到数据库。
- `truthClass` 明确区分：Inference 永远是 `inferred`，待审核事实候选显示为 `canon` Patch，接受后才创建 `canon` Fact。旧 Fact 通过 supersede/retract 保留历史。
- revalidation 在新 revision 成功提交后由独立事务 best-effort 运行；正文保存不等待它，也不会因建议生成失败而回滚或报错。失败会记录服务端日志，后续可由显式重试命令或 `document.revision.created` 消费者补偿；当前 deterministic path 不依赖外部 AI。

## API

- `GET /api/projects/:projectId/patches?status=&sceneRevisionId=`
- `POST /api/projects/:projectId/scenes/:sceneId/fact-patches`
- `GET /api/projects/:projectId/scenes/:sceneId/patch-review?sceneRevisionId=`
- `GET /api/projects/:projectId/patches/:patchId`
- `POST /api/projects/:projectId/patches/:patchId/accept`
- `POST /api/projects/:projectId/patches/:patchId/accept-edited`
- `POST /api/projects/:projectId/patches/:patchId/reject`
