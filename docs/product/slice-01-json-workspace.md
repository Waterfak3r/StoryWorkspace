# Slice 01：JSON 工作区闭环

状态：已实现（2026-08-14）。本文件是该切片的实现合同；不要在后续会话里重做，也不要把范围扩到解析 / Director / 生图。

新会话可直接粘贴文末「启动提示」。

## 目标

用户能：

1. 在本地工作区根目录里**新建 / 打开**一个 JSON 项目
2. 在 **Story** 里看到 Volume → Chapter → Scene 树，编辑并保存某场剧本和 Intent
3. 在 **Entities** 里创建、打开、编辑角色和地点

产品入口换到这条文件真相。旧 SQLite 叙事工作区不再作为运行时。

## 非目标

- 导入解析、AI Director、Context Resolver、生图、单镜重生成、Workflow 执行
- 视频 / 配音 / 音乐
- 旧 `.db` 迁移
- Electron / 系统文件夹选择器（根目录用环境变量）
- 删除整棵旧 `src/server/db` / Phase 路由（本切片不编译它们即可，不强制大删）
- 双栈：禁止新页面再调用 `getNarrativeWorkspace` 或 `@/server/db/**`

## 架构锁定

同仓换芯，新代码全部放在新命名空间，避免和旧 `@/domain/*` 撞车。

```
src/studio/
  domain/          Zod 与类型（本切片的数据合同）
  fs/              工作区根目录读写、路径安全
  http.ts          本切片错误映射（可从旧 http.ts 抄校验包络，不要 import 旧 error class）
src/app/api/studio/        新 API
src/features/studio/       新 UI
src/app/page.tsx           改为挂新项目库
src/app/projects/[projectId]/page.tsx  改为挂新工作区（可改为 client 拉 studio API）
```

旧文件可留在磁盘。`npm test` / 首页 / 项目页不得再依赖它们。

Next.js 16 写任何 route / page 前先读 `node_modules/next/dist/docs/`。

## 磁盘合同

环境变量：`STORY_WORKSPACE_ROOT`，默认 `.data/projects`（相对进程 cwd）。Playwright 用独立目录，例如 `.tmp/playwright/projects`。

每个子目录若含合法 `project.json` 即一个项目。`id` = 文件夹名 = slug：`^[a-z][a-z0-9-]{0,62}$`。

新建项目时写入：

```
<id>/
  project.json
  content/volumes/volume-01/volume.json
  content/volumes/volume-01/chapters/chapter-01/chapter.json
  content/volumes/volume-01/chapters/chapter-01/scenes/scene-01.json
  entities/characters/
  entities/locations/
  entities/props/
  entities/costumes/
  styles/default.json
```

实体 kind：`character` | `location` | `prop` | `costume`。目录见 `ENTITY_KIND_DIRS`。

路径必须 `realpath` 后仍落在工作区根下。`..`、绝对路径、盘符、UNC 一律 400。

### `project.json`

```json
{
  "schemaVersion": 1,
  "id": "harbor-night",
  "title": "Harbor Night",
  "createdAt": "2026-03-27T00:00:00.000Z",
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

### `volume.json` / `chapter.json`

```json
{ "id": "volume-01", "title": "Volume 1", "updatedAt": "2026-03-27T00:00:00.000Z" }
```

```json
{ "id": "chapter-01", "title": "Chapter 1", "updatedAt": "2026-03-27T00:00:00.000Z" }
```

### `scene-01.json`

```json
{
  "id": "scene-01",
  "title": "Untitled scene",
  "script": "",
  "intent": "",
  "characters": [],
  "location": null,
  "props": [],
  "costumes": [],
  "shots": [],
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`characters` / `props` / `costumes` 是实体 `id` 数组。`location` 是实体 `id` 或 `null`。本切片保存剧本时**不校验**实体是否存在（下一刀再绑）。`shots` 本切片只读保留空数组，UI 不编镜头。缺省 `costumes` 的旧 JSON 解析为 `[]`。

### `entities/characters/<id>.json`

```json
{
  "id": "jill",
  "kind": "character",
  "name": "Jill",
  "description": "",
  "visual": { "base": "", "references": [] },
  "states": { "default": { "outfit": "", "condition": "" } },
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

地点：`kind: "location"`，同样有 `visual` + `states.default`，没有 `shots`。`references` 本切片只存相对项目根的字符串，不做上传。

### `styles/default.json`

```json
{ "id": "default", "label": "Default", "visual": "", "updatedAt": "2026-03-27T00:00:00.000Z" }
```

本切片 UI 不编辑风格，只创建默认文件。

## 并发与 ID

- 写文件用 `expectedUpdatedAt`（ISO）。磁盘上的 `updatedAt` 不一致 → 409，body 带当前记录。
- 写成功则刷新 `updatedAt`。
- 创建实体 / 卷 / 章 / 场：客户端可传 `id`；缺省则 `character-01` / `scene-02` 这类已占用则递增。
- 重名 `id` → 409。不改文件夹来改 `id`。
- 标题可改，文件夹名（`id`）创建后不变。

## HTTP

前缀 `/api/studio`。`runtime = "nodejs"`。JSON 包络：`{ data }` 或旧形 `{ error: { code, message, fieldErrors?, retryable } }`。

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/studio/workspace` | `{ root, projects: [{ id, title, updatedAt }] }` |
| POST | `/api/studio/projects` | `{ title }` → 201 `{ project }`，slug 由标题生成，冲突则 `-2` |
| GET | `/api/studio/projects/:projectId` | `{ project }` |
| PATCH | `/api/studio/projects/:projectId` | `{ title, expectedUpdatedAt }` |
| GET | `/api/studio/projects/:projectId/tree` | 卷/章/场节点（场含 `title`，不含全文） |
| POST | `/api/studio/projects/:projectId/volumes` | `{ title?, id? }` |
| PATCH | `/api/studio/projects/:projectId/volumes/:volumeId` | `{ title, expectedUpdatedAt }` |
| POST | `.../volumes/:volumeId/chapters` | `{ title?, id? }` |
| PATCH | `.../chapters/:chapterId` | `{ title, expectedUpdatedAt }` |
| POST | `.../chapters/:chapterId/scenes` | `{ title?, id? }` |
| GET | `.../scenes/:sceneId` | 完整 scene JSON |
| PATCH | `.../scenes/:sceneId` | `{ title?, script?, intent?, characters?, location?, props?, costumes?, expectedUpdatedAt }` |
| GET | `/api/studio/projects/:projectId/entities?kind=character\|location\|prop\|costume` | 列表 |
| POST | `/api/studio/projects/:projectId/entities` | `{ kind, name, id? }` |
| GET | `/api/studio/projects/:projectId/entities/:entityId` | |
| PATCH | `/api/studio/projects/:projectId/entities/:entityId` | 名称/描述/visual/states + `expectedUpdatedAt` |

错误码：`VALIDATION_ERROR` 400、`NOT_FOUND` 404、`EDIT_CONFLICT` 409、`ID_CONFLICT` 409、`INTERNAL_ERROR` 500。

跨项目或越出根目录：404 或 400，不泄露根外路径。

## UI

保留：`layout.tsx`、`globals.css`、`src/features/i18n` 运行时、`loading.tsx` / `error.tsx` 骨架。

替换：

- `/` → 新项目库：列表、新建（只要标题）、打开。不要 premise/genre/归档。
- `/projects/[projectId]` → 新壳，分区：`overview | story | entities`。`workflow` / `outputs` 可显示 “Coming in a later slice”，不可点进旧 Scripts。

**Overview**：标题、根相对路径、卷/章/场/角色/地点计数、进入 Story / Entities。

**Story**：左树（卷/章/场，可添加），中栏剧本 + Intent + 标题，保存用 debounce 800ms + `expectedUpdatedAt`。冲突时展示服务器文本并允许覆盖或放弃。右栏本切片只列出本场已引用的 character / location id（可空）。

**Entities**：角色 / 地点两个列表，创建、打开、编辑 name / description / visual.base / default outfit+condition。

导航在离开脏编辑器前先 flush。

文案走 i18n；用户写的剧本和实体内容不翻译。

## 测试门槛

改 `vitest.config.ts` 的 `include` 为 `src/studio/**/*.test.ts`。旧 44 个测试留盘，不跑。

至少覆盖：

- slug / 路径穿越被拒
- 创建项目落盘且 tree 含默认 volume/chapter/scene
- scene PATCH 乐观并发：过期 `expectedUpdatedAt` → 409，再读再写成功
- 实体创建、列表按 kind 过滤、跨项目读不到
- 两个项目目录互不污染

Playwright（本切片建议有一条，可与实现同会话）：

- 设 `STORY_WORKSPACE_ROOT` 为一次性目录
- 新建项目 → 打开 → 写一场剧本 → reload 还在 → 建一个角色 → reload 还在

不要再要求旧 `e2e/mvp.spec.ts` / `phase*.spec.ts` 变绿。

`start-local.ps1`：增加 `-WorkspaceRoot`，设置 `STORY_WORKSPACE_ROOT`；SQLite 参数可留着但不作为启动前提。`.env.example` 写上新变量。

## 实现顺序（给实现会话拆 subagent）

1. `src/studio/domain` + `src/studio/fs` + 单测（不碰 UI）
2. `/api/studio/*` 路由 + 路由测试
3. 新项目库 + 工作区壳 + Story + Entities；改两个 page
4. i18n 新键、`start-local` / env、一条 Playwright

主代理写清验收后再派 `general-purpose`。子代理禁止改 `docs/product/concept.md` / `mvp.md` 范围，禁止复活 SQLite 作为项目真相。

## 验收清单

- [ ] 不设 `STORY_WORKSPACE_DB_PATH` 也能列出/创建/打开项目
- [ ] 项目是根目录下的文件夹 + 上述 JSON，可用资源管理器打开核对
- [ ] Story 保存与 Entities 保存刷新后仍在
- [ ] 过期保存 409，不丢磁盘上的新内容
- [ ] 不能用 `../` 读出工作区外文件
- [ ] `npm test`（新 include）绿
- [ ] `npm run typecheck` 绿（旧文件若仍被 tsconfig 包含，不要为迁就旧类型而改新合同；可把旧目录暂时排除出本次检查，或保证旧文件仍自洽但不被新入口 import）
- [ ] 首页不再出现 Story bible / Outline / Chapters / Adaptations 作为主 IA
- [ ] 密钥不出现在任何项目 JSON

typecheck 策略：优先让新代码自洽。若整仓 `tsc` 仍包含旧文件，保持旧文件可编译，但新入口零引用 `@/server/db` 与 `@/features/workspace/*`。

## 下一会话启动提示

```
你是本仓库主代理。先完整读 Agents.md、docs/product/mvp.md、docs/product/slice-01-json-workspace.md。

只实现 Slice 01（JSON 工作区闭环）。不要做解析、Director、生图。不要把 SQLite 当项目真相。不要用 Grok subagent 当自己；实现用 spawn_subagent general-purpose。

按 slice 文档的实现顺序分发，验收清单全过才能说完成。写代码前读 node_modules/next/dist/docs/。
```
