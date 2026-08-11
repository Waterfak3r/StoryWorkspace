# Context、Provider 与 RAG 边界

> 对应原规范第 10–12 章；章节编号与规范关键词保持不变。

## 10. Context Builder

### 10.1 职责

Context Builder 负责从结构化领域数据生成模型无关、带来源、受预算约束的 `GenerationContext`。它不负责自然语言润色，不直接调用媒体 Provider。

### 10.2 输入

```ts
interface ContextBuildRequest {
  projectId: string;
  sceneId: string;
  sceneRevisionId: string;
  shotSpecIds?: string[];
  purpose: "continue_writing" | "storyboard" | "image" | "video" | "voice";
  targetProvider?: string;
  targetModel?: string;
  policyId: string;
  allowInferred: boolean;
  historyQuery?: string;
}
```

### 10.3 输出

```ts
interface GenerationContext {
  id: string;
  projectId: string;
  scene: {
    id: string;
    heading?: string;
    text: string;
    summary?: string;
    revisionId: string;
  };
  characters: ResolvedEntityContext[];
  location?: ResolvedEntityContext;
  props: ResolvedEntityContext[];
  organizations: ResolvedEntityContext[];
  events: ResolvedEventContext[];
  history: RetrievedHistoryItem[];
  globalStyle: Record<string, unknown>;
  constraints: string[];
  missing: MissingContextItem[];
  conflicts: ContextConflict[];
  provenance: ContextProvenance[];
  buildPolicyVersion: string;
  contentHash: string;
  createdAt: string;
}
```

### 10.4 装配顺序

Context Builder MUST 按以下顺序装配：

1. 固定 Scene revision 和 context policy；
2. 读取 confirmed SceneEntityLinks；
3. 按 purpose 过滤角色、地点、道具和组织；
4. 解析每个实体的 Base Canon + 当前 Scene State；
5. 读取 Scene 内已确认事件、关系和连续性约束；
6. 读取 approved reference assets 和 provider-neutral asset metadata；
7. 仅对确定性数据未覆盖的历史叙事问题执行 RAG；
8. 去重、排序、预算裁剪；
9. 运行冲突和缺失检查；
10. 保存不可变 Context Snapshot。

### 10.5 默认优先级与预算

从高到低：

1. Shot/Scene 当前动作、对白和明确约束；
2. 当前 Scene explicit state；
3. 出镜角色视觉/声音 identity；
4. 当前地点和关键道具；
5. 延续状态与直接相关事件；
6. 关系和必要历史；
7. 全局风格；
8. 低置信度推断。

预算应按结构字段和 Provider 限制控制，不应只按总 token 粗暴截断。被裁剪项需要进入 Manifest 的 `omitted_context`。

### 10.6 Context Policy 示例

```json
{
  "id": "video-default-v1",
  "purposes": ["video"],
  "include": {
    "base_fact_paths": [
      "appearance.*",
      "visual.default_wardrobe",
      "speech.style"
    ],
    "state_paths": [
      "wardrobe.*",
      "appearance.temporary.*",
      "condition.*",
      "emotion.*",
      "held_props"
    ],
    "relationship_depth": 1,
    "history_top_k": 4
  },
  "allow_inferred": false,
  "fail_on_hard_conflict": true
}
```

### 10.7 缓存与失效

缓存键至少包含：

```text
scene_revision
+ story_bible_revision
+ link_revision
+ context_policy_version
+ target_capability_profile_version
+ shot_spec_hash
```

任何参与事实、状态、link 或资产变更后，旧 Snapshot 不删除，但标记为 not-latest；已启动的生成仍引用旧 Snapshot。

---

## 11. Prompt Compiler / Provider Adapter

### 11.1 分工

`Prompt Compiler`：

- 输入：GenerationContext、ShotSpec、Target Capability Profile；
- 输出：provider-neutral `CompiledGenerationRequest`；
- 负责信息选择、字段映射、文本模板、资产角色分配、fallback 和 warning；
- 不负责网络请求、鉴权、重试、计费回调。

`Provider Adapter`：

- 输入：CompiledGenerationRequest；
- 输出：具体 Provider API 请求和标准化结果；
- 负责鉴权、上传、请求格式、任务轮询、webhook、错误映射和费率限制；
- 不得自行改变故事事实或增加未记录的 Prompt 内容。

### 11.2 能力模型

```ts
interface ProviderCapabilityProfile {
  provider: string;
  model: string;
  version: string;
  modalities: Array<"text" | "image" | "audio" | "video">;
  supports: {
    textPrompt: boolean;
    negativePrompt: boolean;
    referenceImages: boolean;
    maxReferenceImages?: number;
    firstFrame: boolean;
    lastFrame: boolean;
    characterId: boolean;
    styleReference: boolean;
    audioInput: boolean;
    dialogue: boolean;
    seed: boolean;
  };
  limits: {
    promptChars?: number;
    durationSeconds?: number[];
    aspectRatios?: string[];
    maxUploadBytes?: number;
  };
}
```

能力配置必须带版本并可通过测试夹具更新，不应散落为 UI 中的 provider if/else。

### 11.3 Provider Binding

```ts
interface ProviderBinding {
  id: string;
  projectId: string;
  entityId: string;
  provider: string;
  modelFamily?: string;
  bindingType: "character_id" | "voice_id" | "lora" | "reference_token";
  externalId: string;
  metadata: Record<string, unknown>;
  sourceAssetIds: string[];
  status: "active" | "invalid" | "archived";
}
```

外部凭证不得保存在 Binding；只保存 secret reference。

### 11.4 编译决策示例

```text
if provider supports character_id and active binding exists:
    use character_id
    include only scene-specific state and action in text
else if provider supports reference_images and approved references exist:
    attach ranked references
    include concise identity + scene state in text
else:
    compile full visual identity + scene state as text
```

在参考图数量有限时，排序建议为：主角 > 本镜头近景角色 > 场景参考 > 关键道具 > 风格参考。裁剪和降级必须生成 warning。

### 11.5 编译结果

```ts
interface CompiledGenerationRequest {
  capabilityProfileVersion: string;
  promptSegments: Array<{
    role: "scene" | "character" | "state" | "camera" | "style" | "constraint";
    text: string;
    sourceIds: string[];
  }>;
  negativePrompt?: string;
  assetInputs: Array<{
    assetId: string;
    purpose: "character" | "location" | "prop" | "style" | "first_frame" | "last_frame";
    weight?: number;
  }>;
  providerBindings: string[];
  parameters: Record<string, unknown>;
  warnings: string[];
  omittedContext: string[];
}
```

### 11.6 适配器统一接口

```ts
interface MediaProviderAdapter {
  validate(request: CompiledGenerationRequest): Promise<ValidationResult>;
  prepare(request: CompiledGenerationRequest): Promise<PreparedProviderRequest>;
  submit(request: PreparedProviderRequest): Promise<ProviderJobRef>;
  getStatus(job: ProviderJobRef): Promise<NormalizedJobStatus>;
  cancel?(job: ProviderJobRef): Promise<void>;
  normalizeResult(raw: unknown): Promise<NormalizedMediaResult>;
}
```

Provider 错误统一映射为 `invalid_input`、`auth`、`quota`、`rate_limit`、`safety`、`provider_unavailable`、`timeout`、`unknown`。

---

## 12. RAG 应用边界

### 12.1 应使用 RAG 的场景

- 检索与当前 Scene 有关但未通过直接 link 覆盖的历史事件；
- 回答“此前谁知道这个秘密”“上次冲突如何结束”等开放叙事问题；
- 为续写提供主题、伏笔、未解决线索；
- 从长篇历史中选择少量原文证据或摘要；
- 在不确定召回范围时辅助建议候选实体，但结果仍需 resolver 确认。

### 12.2 不应使用 RAG 的场景

- 查询当前 Scene 有哪些 confirmed characters/props/location；
- 读取角色 Canon、Scene State 或 Provider Binding；
- 判断某条 Patch 是否已被用户接受；
- 事务一致性、权限、版本或唯一性约束；
- 获取必须精确的外部 character ID、asset ID、Scene ID；
- 代替关系表或状态解析算法。

### 12.3 检索单元

建议同时建立：

- Scene summary chunk；
- Beat/action/dialogue chunk；
- Event summary chunk；
- 已确认 Fact 的证据 chunk。

每个 chunk 必须携带 project、document、scene、revision、entity IDs、timeline、truth class 和权限 metadata。检索必须先做项目/权限/版本过滤，再做语义排序。

### 12.4 检索策略

```text
structured filter
  -> lexical/entity match
  -> vector similarity
  -> recency/timeline/causal rerank
  -> deduplicate
  -> evidence validation
  -> budget selection
```

RAG 返回内容视为证据候选，不是 Canon。历史摘要必须注明对应 Scene 范围；摘要更新后保留 version。

### 12.5 Prompt Injection 边界

剧本、导入文档和检索文本都视为不可信内容。系统 MUST：

- 把内容放入结构化 data 字段，不把其中指令拼成 system/developer 指令；
- 对 tool invocation 采用 allowlist；
- 不允许模型输出直接触发外部写操作；
- 对跨项目 retrieval 做强制 server-side filter；
- 在日志和 UI 中区分用户文本与系统模板。

---

