# Slice 02：粘贴解析 + 人工确认

状态：已实现。本文件是解析切片的实现合同。不要做 Director / 生图。不要把 SQLite 当项目真相。不要回归 Slice 01。

## 目标

用户把一段文本贴进项目后：

1. AI（测试用假 Provider）抽出 **proposed** Scene 与 Entity
2. 提案在确认前**不是**项目记录
3. 人工确认后才写入 Volume/Chapter 下的 Scene JSON 与 `entities/`
4. 已确认 / Canon 字段再次解析时不得被静默覆盖

## 非目标

- Director、Storyboard 编辑器、Context Resolver、生图、Workflow 执行
- 导入 DOCX / PDF（本切片只做粘贴文本）
- 旧 SQLite 或 `@/server/db/**`

## 架构

```
src/studio/parse/          提案 schema、假/真 LLM 适配、confirm 写入
src/studio/domain/         增 parse / canon 字段（同步 schema）
src/app/api/studio/projects/[projectId]/parse/
src/features/studio/       Story 或 Overview 上的粘贴 / 确认 UI
```

LLM 输出必须先过 Zod。Provider 参数只留在 parse adapter。密钥不进项目 JSON。

可注入 `completeJson(schema, prompt)`。测试传入假实现，不需要真 Key。假实现必须走同一条 `parsePastedText` / `confirmParseRun` 入口，禁止测试里重写解析逻辑。

## 磁盘

```
<project>/imports/parse-runs/<runId>.json
```

`runId` 为 slug，如 `parse-01`。

```json
{
  "id": "parse-01",
  "status": "pending",
  "sourceText": "Jill waits on the harbor…",
  "proposedScenes": [
    {
      "key": "scene-a",
      "title": "Harbor watch",
      "script": "Jill waits on the harbor.",
      "intent": "Establish Jill at night.",
      "characterNames": ["Jill"],
      "locationName": "Harbor",
      "propNames": ["Lantern"],
      "costumeNames": ["Watch coat"]
    }
  ],
  "proposedEntities": [
    { "key": "ent-jill", "kind": "character", "name": "Jill", "description": "A night lookout." },
    { "key": "ent-harbor", "kind": "location", "name": "Harbor", "description": "Foggy quay." },
    { "key": "ent-lantern", "kind": "prop", "name": "Lantern", "description": "Oil lamp." },
    { "key": "ent-coat", "kind": "costume", "name": "Watch coat", "description": "Heavy navy coat." }
  ],
  "createdAt": "2026-03-27T00:00:00.000Z",
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`status`: `pending` | `confirmed` | `rejected`。

写入的 Scene / Entity 增加：

```json
"provenance": {
  "source": "parse",
  "parseRunId": "parse-01",
  "confirmedAt": "2026-03-27T00:00:00.000Z"
},
"canonFields": ["title", "script", "intent", "name", "description"]
```

`canonFields` 是已确认、不得被后续 confirm 静默改写的字段名。用户在工作区里手改仍走现有 PATCH。

已有无 provenance 的 Slice 01 记录：一旦用户保存过，或名称已存在，确认时按 Canon 处理（按 `name`/`title` 大小写不敏感匹配）。

## 行为

`parsePastedText(projectId, text, completeJson)`：

- 校验非空文本
- 调 completeJson，Zod 校验模型 JSON
- 场景 `script` 必须保留粘贴原文用词（含全部对白与动作行）；模型不得写成梗概。若模型输出的 script 合计明显短于原文（或原文有对白标记而提案没有），服务端将整段粘贴写入单一场景的 `script`，实体提案不变
- **只写** `imports/parse-runs/<id>.json`，`status: pending`
- 不创建 scene/entity 文件

`confirmParseRun(projectId, runId, input)`：

- `input.overwriteCanon?: string[]` 为 `proposedScenes[].key` / `proposedEntities[].key` 上允许覆盖的字段路径，如 `ent-jill.description`
- 默认：若项目里已有同名同 kind 实体或同 title 场，且该字段已在 `canonFields` 中（或记录已存在），**不改**该字段
- 否则创建实体 / 在选定 Volume/Chapter 下创建场（请求体 `volumeId` + `chapterId`；省略时仍回退 `volume-01` / `chapter-01`），并写上 id 引用（`characters[]` / `location` / `props[]` / `costumes[]`，由 `characterNames` / `locationName` / `propNames` / `costumeNames` 解析）。已有同 title 场仍原地更新（不重写实体链接）。Confirm 不是整本故事覆盖。
- 跑完将 run 标为 `confirmed`
- 再次 confirm 已 confirmed 的 run → 409 或 no-op 错误，不得重复建记录

第二次 parse 生成新的 `parse-02`。对其 confirm 时，若提案改了 Jill 的 description 而该字段已是 Canon，磁盘上的 description 保持第一次确认的值，除非测试/UI 显式传入 `overwriteCanon`。

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/studio/projects/:projectId/parse` | `{ text }` → 201 `{ data: { run } }` |
| GET | `/api/studio/projects/:projectId/parse/:runId` | `{ data: { run } }` |
| GET | `/api/studio/projects/:projectId/parse` | 列表 |
| POST | `/api/studio/projects/:projectId/parse/:runId/confirm` | `{ overwriteCanon?: string[]; volumeId?: string; chapterId?: string }` → `{ data: { run, scenes, entities } }` |
| POST | `/api/studio/projects/:projectId/parse/:runId/reject` | 标 rejected，不写项目记录 |

错误码沿用 Slice 01。无效 LLM JSON → 502/`AI_INVALID_RESPONSE` 或 400，且不写 scene/entity。文本 Provider（completeJson）最长等待 300 秒，与生图 adapter 同档。Chat decode 接受 OpenCode/DeepSeek 的 `reasoning` / `reasoning_content`；provider 文本 JSON 载荷上限 4MiB。normalize 接受中文 kind（角色/人物、地点/场所/场景）以及 snake_case 别名。

## UI

Story 区增加「Paste & parse」：文本框、Parse、待确认列表、Confirm / Reject。文案走 i18n。用户正文不翻译。Confirm 把**新**场写进当前选中的 Volume/Chapter；解析确认不是整本故事覆盖。已匹配 title 的场仍在原位置更新。切换工作区分区时已打开的 Story/parse 保持挂载，不会中止进行中的解析。

## 测试（`src/studio/**/*.test.ts`）

必须驱动 `parsePastedText` 与 `confirmParseRun`（或对应 HTTP handler），禁止在测试里复刻解析：

1. parse 后 `entities/` 与 scenes 目录没有新记录；只有 parse-run JSON
2. confirm 后磁盘出现 Scene + Character + Location，script/name 与提案一致
3. 第二次 parse 改 Canon description；不带 `overwriteCanon` 的 confirm 不改磁盘；带 `overwriteCanon` 才改
4. 不设 `STORY_WORKSPACE_DB_PATH`

## 验收

- 未确认提案不是项目记录
- 确认后可在 Story / Entities 看到并刷新仍在
- 二次解析不静默覆盖 Canon
- 密钥不进 JSON
