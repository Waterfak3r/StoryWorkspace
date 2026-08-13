# ADR 011：Phase 3 Scene State 与连续性解析

## 背景

Phase 2 已建立 Base Canon Fact、Inference 与 Pending Patch 的审核边界，但 Scene 中的服装、伤势和持有道具不能作为永久角色设定写入 Base。Phase 3 需要在不引入复杂时间线引擎的前提下，让临时状态可审核、可追溯、可继承并能可靠阻断连续性冲突。

## 决策

1. SQLite schema v13 新增文档级 `continuity_groups` 与独立的 `entity_states`。每个已有 ScriptDocument 迁移出一个默认主时间线；`scenes` 保存当前 group，`scene_revisions` 固化保存时的 group，使 revision-bound 查询不会读取半旧半新的连续性归属。
2. Character Base 继续使用 active Canon `facts(scope=base)`；Scene State 只写 `entity_states`，不得把 `wardrobe.current`、`state.injury` 或 `state.held_prop` 作为新 Fact 接受。`wardrobe.current` 的 Base fallback 显式映射到 `visual.default_wardrobe`，其余字段无 Base 时返回 missing。
3. 复用唯一的 Pending Patch 状态机并扩展 `add_state` operation。接受后在同一事务创建 Canon EntityState、PatchApplication、审计和 outbox 事件，再 CAS Patch；不得另建可绕过审核的 state accept 路径。本切片的 state proposal 是用户显式命令，不伪装成模型 Inference 或 ModelRun。
4. State Patch 绑定当前 SceneRevision 和精确 Evidence，目标实体必须为同项目 active/draft，`entity_ref` 必须解析到同项目可用实体。`accept-edited` 只允许修改 value；predicate、appliesAt Scene、continuity group、carry-forward、priority 和有效范围保持不变。
5. Resolver 仅接受当前、未删除 SceneRevision。对每个 entity/predicate 按 `当前 Scene explicit > 同 continuity group 最近 carry-forward > Base fallback > missing` 解析，且只读取同一文档中 narrative rank 小于等于目标 Scene 的状态；未来 Scene 永不参与。
6. 每一层先取最高 priority。单值字段在同层、同 priority 出现不同值时返回 blocking conflict 和全部 State/Fact/Evidence 来源；相同值可合并来源。`state.held_prop` 是多值字段，按实体 ID 去重聚合，不把正常的多个道具视为冲突。
7. 本阶段只提供基础 continuity group（main/flashback/dream/parallel/custom）和 `add_state`。通用状态替换/撤回、故事时间坐标、跨文档时间线和规则引擎留到后续 ADR；不得通过 last-write-wins 模拟这些能力。

## 迁移与影响

- v13 以 additive tables/columns 和受控重建扩展 `pending_patches`、`patch_applications` 的 operation/result contract；迁移必须保留 v12 Patch、Application 和 Evidence junction，并补从真实 v12 文件升级的测试。
- 旧 Scene 全部进入各自文档的默认 continuity group，保持原有叙事顺序语义。新 Revision 的 content hash 纳入 continuity group ID，调整分组会产生新的不可变输入版本。
- 状态 conflict 是 Phase 4 Context Builder 和 Phase 5 generation 的阻断输入；Phase 3 API 已返回稳定的 `hasBlockingConflicts` 和逐字段 provenance。

## API

- `GET|POST /api/projects/:projectId/documents/:documentId/continuity-groups`
- `POST /api/projects/:projectId/scenes/:sceneId/state-patches`
- `GET /api/projects/:projectId/scenes/:sceneId/resolved-state?sceneRevisionId=&entityId=`
- 既有 Patch accept、accept-edited、reject 和 patch-review 端点同时支持 `add_state` 结果。
