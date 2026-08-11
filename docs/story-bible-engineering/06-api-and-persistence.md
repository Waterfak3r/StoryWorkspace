# API、模块边界与持久化

> 对应原规范第 13–14 章；章节编号与规范关键词保持不变。

## 13. API / 模块边界建议

### 13.1 模块职责

| 模块 | 拥有的数据/职责 | 不应负责 |
|---|---|---|
| Document | 文档、revision、Scene 结构、文本 anchor | 写 Story Bible 事实 |
| Analysis | mention/fact/state/event 候选与 model run | 接受 Patch |
| Entity Resolver | alias、消歧、entity candidate | 编译媒体 Prompt |
| Patch | 建议状态机、冲突、原子应用、审计 | LLM 抽取 |
| Story Bible | entity/fact/state/relationship/event 查询与版本 | Provider 网络请求 |
| Scene Link | mention 投影、confirmed link | 临时 RAG 猜实体 |
| Asset | 文件、衍生版本、审批、metadata | 决定剧情 Canon |
| Context Builder | 确定性上下文 + 受控历史补充 | 调用 Provider |
| Storyboard/Shot | 视觉叙事结构与镜头规格 | Provider 鉴权 |
| Prompt Compiler | 按 capability 编译 | 网络重试/轮询 |
| Provider Adapter | 外部 API、错误归一化 | 修改 Story Bible |
| Generation | job、manifest、result、cost | 实体抽取 |

### 13.2 API 形式

外部客户端可用 REST/JSON；模块内部用 TypeScript interfaces 或 command bus。MVP 不要求 GraphQL。

建议端点：

```text
POST   /projects/:projectId/documents
POST   /documents/:documentId/revisions
GET    /documents/:documentId/revisions/:revisionId/analysis-status

GET    /projects/:projectId/entities
POST   /projects/:projectId/entities
GET    /entities/:entityId
PATCH  /entities/:entityId                 # user-authored command, version required
POST   /entities/:entityId/merge

GET    /projects/:projectId/patches?status=pending
POST   /patches/:patchId/accept
POST   /patches/:patchId/reject
POST   /patches/:patchId/accept-edited

GET    /scenes/:sceneId/entities?status=confirmed
POST   /scenes/:sceneId/entity-links
PATCH  /scene-entity-links/:linkId
GET    /scenes/:sceneId/resolved-state

POST   /contexts/build
GET    /contexts/:contextId
POST   /scenes/:sceneId/storyboards
POST   /shots/:shotId/compile
POST   /generations
GET    /generations/:generationId
POST   /generations/:generationId/cancel
```

### 13.3 Command/Query 示例

```ts
interface AcceptPatchCommand {
  patchId: string;
  expectedPatchVersion: number;
  actorUserId: string;
}

interface ResolveSceneContextQuery {
  sceneId: string;
  sceneRevisionId: string;
  purpose: "storyboard" | "image" | "video" | "voice";
  policyId: string;
}
```

所有变更命令 MUST 带 actor、request ID 和期望 version。API 重试用 idempotency key，尤其是 generation submit 和 Patch accept。

### 13.4 领域事件

```text
document.revision.created
scene.changed
analysis.requested
analysis.completed
entity.created
entity.merged
patch.proposed
patch.accepted
patch.rejected
story_bible.changed
scene_links.changed
context.built
storyboard.created
shot.changed
generation.requested
generation.submitted
generation.completed
generation.failed
```

事件 payload 只放 ID、version 和必要 metadata；大文本通过 ID 读取。消费者必须幂等。

---

## 14. 数据库表建议

### 14.1 技术选择

- 主存储：PostgreSQL。
- 对象存储：原始图片、视频、音频和衍生文件。
- 队列：支持至少一次投递；消费者通过幂等键去重。
- 向量：MVP 后期可用 pgvector；不可成为 Story Bible 主存储。
- JSONB：适合 provider metadata 和低频扩展字段；核心可查询字段必须正规化。

### 14.2 主要表

```text
projects
script_documents
document_revisions
chapters
scenes
scene_revisions
beats
dialogue_lines
shots

entities
entity_aliases
entity_mentions
scene_entity_links
facts
inferences
relationships
story_events
event_participants
entity_states
evidence_sources
pending_patches
patch_evidence

assets
asset_versions
entity_asset_links
provider_bindings

analysis_runs
model_runs
context_snapshots
storyboards
generation_manifests
generation_jobs
generation_results
audit_events
outbox_events
```

### 14.3 核心 SQL 示例

以下为结构示意，实际迁移需补齐 enum/check、租户权限和更新时间触发器。

```sql
create table entities (
  id uuid primary key,
  project_id uuid not null references projects(id),
  entity_type text not null,
  canonical_name text not null,
  status text not null default 'draft',
  merged_into_entity_id uuid references entities(id),
  attributes jsonb not null default '{}',
  schema_version integer not null default 1,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entities_project_type_idx
  on entities(project_id, entity_type, status);

create table entity_aliases (
  id uuid primary key,
  project_id uuid not null references projects(id),
  entity_id uuid not null references entities(id),
  alias text not null,
  normalized_alias text not null,
  locale text,
  status text not null default 'active',
  source_id uuid,
  created_at timestamptz not null default now(),
  unique(project_id, entity_id, normalized_alias)
);

create index entity_alias_lookup_idx
  on entity_aliases(project_id, normalized_alias)
  where status = 'active';

create table scene_entity_links (
  id uuid primary key,
  project_id uuid not null references projects(id),
  scene_id uuid not null references scenes(id),
  entity_id uuid not null references entities(id),
  role text not null,
  status text not null,
  resolver text not null,
  confidence numeric(5,4),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scene_id, entity_id, role)
);

create index scene_entity_confirmed_idx
  on scene_entity_links(scene_id, role, entity_id)
  where status = 'confirmed';

create table facts (
  id uuid primary key,
  project_id uuid not null references projects(id),
  subject_entity_id uuid not null references entities(id),
  predicate text not null,
  value jsonb not null,
  value_type text not null,
  scope text not null,
  scene_id uuid references scenes(id),
  valid_from_scene_id uuid references scenes(id),
  valid_to_scene_id uuid references scenes(id),
  source_id uuid not null,
  status text not null default 'active',
  supersedes_fact_id uuid references facts(id),
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create index facts_active_subject_predicate_idx
  on facts(project_id, subject_entity_id, predicate)
  where status = 'active';

create table entity_states (
  id uuid primary key,
  project_id uuid not null references projects(id),
  entity_id uuid not null references entities(id),
  predicate text not null,
  value jsonb not null,
  applies_at_scene_id uuid not null references scenes(id),
  valid_from_scene_id uuid references scenes(id),
  valid_to_scene_id uuid references scenes(id),
  carry_forward boolean not null default false,
  priority integer not null default 100,
  truth_class text not null,
  source_id uuid not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index entity_states_resolution_idx
  on entity_states(project_id, entity_id, predicate, applies_at_scene_id)
  where status = 'active';

create table pending_patches (
  id uuid primary key,
  project_id uuid not null references projects(id),
  operation text not null,
  target_entity_id uuid references entities(id),
  base_version integer,
  payload jsonb not null,
  truth_class text not null,
  confidence numeric(5,4),
  conflict_kind text not null default 'none',
  conflict_payload jsonb not null default '{}',
  status text not null default 'pending',
  proposed_by text not null,
  model_run_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid
);

create index pending_patches_review_idx
  on pending_patches(project_id, created_at)
  where status = 'pending';

create table context_snapshots (
  id uuid primary key,
  project_id uuid not null references projects(id),
  scene_id uuid not null references scenes(id),
  scene_revision_id uuid not null,
  policy_version text not null,
  capability_profile_version text,
  content jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique(project_id, content_hash)
);

create table generation_manifests (
  id uuid primary key,
  project_id uuid not null references projects(id),
  scene_id uuid references scenes(id),
  shot_id uuid references shots(id),
  context_snapshot_id uuid not null references context_snapshots(id),
  provider text not null,
  model text not null,
  compiler_version text not null,
  capability_profile_version text not null,
  compiled_request jsonb not null,
  parameters jsonb not null default '{}',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(project_id, idempotency_key)
);
```

### 14.4 数据不变量

数据库和领域层 MUST 共同保证：

1. Canon Fact 不原地改 value；修改通过 supersede/retract。
2. accepted Patch 不可再次接受。
3. active Entity 不指向自身 `merged_into_entity_id`。
4. confirmed SceneEntityLink 只指向 active/draft 可解析实体，不能指向 merged tombstone。
5. 同一 Generation Manifest 绑定唯一、不可变 Context Snapshot。
6. Inference promotion 创建新 Canon Fact。
7. Provider secret 不出现在业务表、日志或 Manifest。
8. 所有跨项目 ID 引用必须校验 project_id 相同；仅靠 UUID 不足以构成授权。

### 14.5 多租户与删除

- 所有业务查询必须包含 project/workspace scope。
- 可使用 PostgreSQL RLS 作为第二道防线，但不能代替应用权限。
- Entity、Fact、Manifest 默认软删除或状态化；媒体物理删除需经过保留期和引用检查。
- 项目删除应异步执行、可审计，并先撤销外部 Provider 绑定（若 Provider 支持）。

---

