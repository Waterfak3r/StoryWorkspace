# Canon、Scene Link 与状态模型

> 对应原规范第 5–7 章；章节编号与规范关键词保持不变。

## 5. Canon / Inferred / Pending Patch 机制

### 5.1 三类信息

| 类型 | 含义 | 默认可用于下游生成 | 修改方式 |
|---|---|---:|---|
| Canon | 作者确认、导入确认或明确策略接受的正式事实 | 是 | 新建、supersede、retract，禁止无痕覆盖 |
| Inferred | AI 根据行为、上下文或模式做出的推断 | 否 | 可 dismiss、stale 或 promote |
| Pending Patch | 尚未生效的数据变更建议 | 否 | accept、reject、edit、expire |

### 5.2 Patch 结构

```ts
type PatchOperation =
  | "create_entity"
  | "add_fact"
  | "replace_fact"
  | "retract_fact"
  | "add_alias"
  | "add_relationship"
  | "add_state"
  | "merge_entity";

interface PendingPatch {
  id: string;
  projectId: string;
  operation: PatchOperation;
  targetEntityId?: string;
  baseVersion?: number;
  payload: Record<string, unknown>;
  truthClass: "canon" | "inferred";
  evidenceSourceIds: string[];
  confidence?: number;
  conflict: {
    kind: "none" | "possible" | "hard";
    conflictingFactIds: string[];
    message?: string;
  };
  status: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  proposedBy: "rule" | "model" | "user" | "import";
  modelRunId?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
}
```

### 5.3 Patch 状态机

```text
pending ──accept──> accepted
   │                  │
   ├──reject────> rejected
   ├──newer patch─> superseded
   └──source invalid/version drift──> expired
```

接受 Patch MUST 在单一事务中：

1. 校验 Patch 仍为 pending；
2. 校验目标 entity/fact 的 `baseVersion`；
3. 重新运行权限、schema 和冲突检查；
4. 创建新 Fact/State/Relationship 或 supersede 旧记录；
5. 写入审计事件；
6. 更新 Patch 状态；
7. 发出 `story_bible.changed` 领域事件。

### 5.4 冲突规则

冲突检测至少覆盖：

- 同一主体、同一 predicate、重叠 scope 的单值事实不同；
- 两个实体被建议使用同一强唯一外部绑定；
- Scene state 与同一 Scene 的明确 Canon 相矛盾；
- 新事实的来源文本已被删除或 revision 不匹配；
- Patch 基于旧 entity version；
- 合并实体后仍指向被合并 ID。

冲突时禁止 last-write-wins。系统应生成 hard conflict，并让用户选择保留旧事实、接受新事实、限定 scope 或保留为平行解释。

### 5.5 自动接受策略

MVP 默认关闭事实自动接受。后续 MAY 提供项目级策略：

```ts
interface AutoAcceptPolicy {
  exactAliasLinks: boolean;       // recommended true
  createEntityStubs: boolean;     // recommended true
  explicitFactThreshold?: number; // optional, still audited
  allowedPredicates: string[];
}
```

即使开启自动接受，所有变更仍需生成 Patch 和审计记录，只是由 policy actor 完成接受。

---

## 6. Scene-Entity 关系

### 6.1 关系类型

Scene 与实体的关联不能只是一个 entity ID 数组。至少需要角色职责和来源：

```ts
type SceneEntityRole =
  | "appears"
  | "mentioned"
  | "speaks"
  | "located_at"
  | "used"
  | "carried"
  | "affected"
  | "member_present"
  | "historical_reference";

interface SceneEntityLink {
  id: string;
  projectId: string;
  sceneId: string;
  entityId: string;
  role: SceneEntityRole;
  status: "candidate" | "confirmed" | "rejected";
  sourceMentionIds: string[];
  resolver: "exact_alias" | "rule" | "model" | "user";
  confidence?: number;
  createdAt: string;
}
```

### 6.2 确定性定义

“Scene 与实体建立确定性关联”指：下游模块只依赖 `confirmed` link；同一 Scene 和 entity role 的读取结果在没有版本变更时保持一致，不在生成请求时临时让 LLM 猜测。

确认规则：

1. 用户手动链接：直接 confirmed。
2. 文本命中项目内唯一且已确认的 canonical name/alias：MAY 自动 confirmed。
3. 同名多实体、代词、模糊称谓：必须 candidate，待 resolver 或用户确认。
4. 模型提出的新实体：创建 draft entity + candidate link；不得直接混入 active Canon。
5. rejected mention 应保存负反馈，避免相同 revision 重复建议。

### 6.3 Mention 与 Link 分离

- `EntityMention`：某段文本可能指向某实体，属于文本分析结果。
- `SceneEntityLink`：Scene 确认需要哪个实体，属于领域关系。

一个 Link 可以聚合多个 Mention；删除单个 Mention 不一定删除 Link。只有当所有依据失效时，系统才提出取消 Link 的 Patch。

### 6.4 Scene 稳定性

- Scene 必须有稳定 UUID 和单独的排序字段。
- Scene 重排只更新 rank，不重建 ID。
- Scene 拆分/合并必须产生映射表，旧 source/link 进入待复核状态。
- Context Snapshot 引用 Scene revision，避免生成过程读取到一半新一半旧的数据。

---

## 7. Character Base vs Scene State

### 7.1 分类规则

写入 Base 的典型信息：

- 身份、年龄区间、职业；
- 相对稳定的面部、体型、发色、辨识特征；
- 默认服装和默认声音，仅作为 fallback；
- 长期动机、背景和说话风格。

写入 Scene State 的典型信息：

- 当前服装、发型临时变化、妆容；
- 受伤、污渍、湿发、年龄阶段；
- 情绪、姿态、疲劳程度；
- 当前地点、持有道具、人物关系阶段；
- 伪装、超自然形态或其他临时形态。

判断原则：如果重新生成较早 Scene 时该值不一定成立，则不得只写入 Base。

### 7.2 State 数据结构

```ts
interface EntityState {
  id: string;
  projectId: string;
  entityId: string;
  predicate: string;            // e.g. "wardrobe.current"
  value: unknown;
  appliesAtSceneId: string;
  validFromSceneId?: string;
  validToSceneId?: string;
  carryForward: boolean;
  priority: number;              // explicit scene override > carried state > base fallback
  truthClass: "canon" | "inferred";
  sourceId: string;
  status: "active" | "superseded" | "retracted";
}
```

### 7.3 状态解析算法

对于实体 `E`、Scene `S`、字段 `P`：

1. 读取 `S` 上明确的 active Canon state；
2. 若不存在，按叙事顺序向前读取最近的 `carryForward=true` 且未在后续终止的 Canon state；
3. 若不存在，读取 Character Base Canon；
4. 若调用方允许推断，按相同优先级读取 Inferred，并明确标记；
5. 若仍不存在，返回 missing，不得让 Context Builder 自动杜撰；
6. 多个同优先级单值结果视为数据冲突，阻止最终生成或要求显式选择。

可表示为：

```text
Scene explicit state
  > carried-forward state
  > Base default
  > allowed inference
  > missing
```

### 7.4 Scene 顺序与故事时间

叙事顺序不总等于故事时间。数据层 SHOULD 同时保留：

- `narrative_rank`：剧本中的播放顺序；
- `story_time` 或 `timeline_id`：故事内时间位置；
- `continuity_group_id`：闪回、梦境、平行线等连续性分组。

MVP 若尚不支持复杂时间线，`carryForward` 只允许在同一 continuity group 内解析；无法判断时要求用户显式指定 state，避免跨闪回污染。

---

