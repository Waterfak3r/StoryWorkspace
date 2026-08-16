# Slice 05：删除 Volume / Chapter / Scene

状态：已实现（2026-08-16）。用户决策：级联硬删；删除前必须弹窗确认；实体不删；已生成图与 workflow 节点一并清掉。

本文件是实现合同。不要做实体删除、项目删除、软删除、回收站、撤销。不要双栈 SQLite。不要改 Director / 生图 / Parse 主链。

## 目标

用户在 Story 树里能删除已创建的 **Volume / Chapter / Scene**。

1. 删前弹出应用内确认框（`role="dialog"`），取消则什么都不改。
2. 确认后硬删磁盘上的结构节点。
3. 父节点级联：删卷带走其下所有章/场；删章带走其下所有场。
4. 场内 `shots[]` 随 scene JSON 一起消失。
5. 清掉这些场对应的 `outputs/images/<sceneId>/` 与 `workflow/nodes/<shotId>.json`。
6. **不删** `entities/`、parse-runs、`workflow/runs/`、项目本身。
7. 允许删到空树；用户可再点「添加卷」。

## 非目标

- 实体 / 项目 / 单 Shot 删除
- 软删除、撤销、回收站
- 清空 `workflow/runs` 历史
- 改卷/章标题编辑（本切片不顺手做）
- 旧 SQLite 或 `@/server/db/**`

## 磁盘

删除前先收集将消失的 `sceneId` 与 `shotId`，再删结构目录/文件，再清产物：

| 目标 | 结构删除 | 产物清理 |
|------|----------|----------|
| Scene | `.../scenes/<sceneId>.json` | `outputs/images/<sceneId>/`；每个 shot 的 `workflow/nodes/<shotId>.json` |
| Chapter | 整棵 `.../chapters/<chapterId>/` | 该章下每个 scene 同上 |
| Volume | 整棵 `content/volumes/<volumeId>/` | 该卷下每个 scene 同上 |

路径必须走现有 `requireVolume` / `requireChapter` / `requireScene` 与 `resolveUnderWorkspace` / `constrainToWorkspaceRoot`。缺文件则 `StudioNotFoundError`。缺产物目录/节点文件则忽略，不 500。

已有 `removePathSafe` 可复用。workflow 节点删除放在 `src/studio/generate/workflow-store.ts`（新增 `deleteWorkflowNode`，文件不存在则 no-op）。

## HTTP

在现有资源路由上加 `DELETE`，无 body。成功 `200 { data: { deleted: true } }`。找不到 `404 NOT_FOUND`。非法 id 仍 `400 VALIDATION_ERROR`，不泄露根外路径。

| 方法 | 路径 |
|------|------|
| DELETE | `/api/studio/projects/:projectId/volumes/:volumeId` |
| DELETE | `/api/studio/projects/:projectId/volumes/:volumeId/chapters/:chapterId` |
| DELETE | `/api/studio/projects/:projectId/volumes/:volumeId/chapters/:chapterId/scenes/:sceneId` |

不要 `expectedUpdatedAt`。不要新 schema 字段。

## 仓库 API

`src/studio/fs/repository.ts` + `src/studio/fs/index.ts` 导出：

- `deleteVolume(projectId, volumeId)`
- `deleteChapter(projectId, volumeId, chapterId)`
- `deleteScene(projectId, volumeId, chapterId, sceneId)`

返回 `{ deleted: true }`。删卷/章时在 `rm` 目录前读出全部子孙 scene/shot。

## UI

只改 `src/features/studio/StoryPanel.tsx` 与 `src/features/studio/api.ts`。

- 树每一行改成「选择按钮 + 删除按钮」，**不要**把 button 嵌 button。
- 删除按钮 `aria-label` 用 `Delete {title}`（已有 i18n key），`title` 为节点标题或 id。
- 点删除：先打开确认框，**不要**先发 DELETE。
- 确认框对齐 `ProjectLibrary.tsx` 的 Dialog：`role="dialog"`、`aria-modal`、Escape / 点遮罩 / Cancel 关闭；不要 `window.confirm`。
- 标题：`Delete {title}?`（已有）。说明按类型三选一（见文案）。主按钮 `Delete`（危险色），次按钮 `Cancel`（已有）。
- 确认后才 `DELETE`。若目标是当前选中或其祖先：不必 flush。否则先 flush 当前场，flush 失败则中止删除。
- 成功后 `refreshTree()`；已删选中则走现有 `firstStorySelection`（可空）。
- 删除中禁用树操作；失败写入现有 `treeError`。

文案（English key = 源文；写入 `zhTranslations`）：

| Key | zh |
|-----|----|
| `Delete volume` | 删除卷 |
| `Delete chapter` | 删除章 |
| `Delete scene` | 删除场 |
| `Delete` | 删除 |
| `This will permanently delete this volume, including its chapters, scenes, shots, generated images, and workflow nodes.` | 将永久删除该卷，以及其中的章、场、分镜、已生成图片和工作流节点。 |
| `This will permanently delete this chapter, including its scenes, shots, generated images, and workflow nodes.` | 将永久删除该章，以及其中的场、分镜、已生成图片和工作流节点。 |
| `This will permanently delete this scene, including its shots, generated images, and workflow nodes.` | 将永久删除该场，以及其中的分镜、已生成图片和工作流节点。 |

## 测试

只跑与本切片相称的测试，禁止整仓重跑旧 SQLite / phase 套件。

**`src/studio/fs/repository.test.ts`**

- 多卷一章一场：删场后 JSON 不在、tree 无该场、兄弟仍在。
- 场上预置 `outputs/images/<sceneId>/shot-01/run-01.png` 与 `workflow/nodes/shot-01.json`：删场后二者不在。
- 删章：其下场文件与产物消失；同卷其他章仍在。
- 删卷：其下章/场消失；另一卷仍在。
- 同项目实体 JSON 仍在。
- 另一项目同名 `scene-01` 不受影响。
- 可删最后一卷，`readTree` 为 `{ volumes: [] }`。
- 缺 id → `StudioNotFoundError`。

**`src/studio/http/routes.test.ts`**

- `DELETE` 场/章/卷 → 200 `{ deleted: true }`，随后 GET tree 不再包含。
- 缺资源 → 404。
- 非法 id 仍 400，响应不含工作区外路径。

**`e2e/studio-workspace.spec.ts`**

新增一条（可与现有 serial 并列，自建项目，勿破坏现有「Untitled scene」断言）：

1. 打开 Story，再添加一场。
2. 点该场删除：出现 dialog；点 Cancel：两场都还在。
3. 再删：点 Delete：该场从树消失；默认场仍在。
4. reload：删除仍生效。

## 验证命令

```
npx vitest run src/studio/fs/repository.test.ts src/studio/http/routes.test.ts
npx tsc --noEmit
npm run build
npx playwright test e2e/studio-workspace.spec.ts
```

Windows 可用 `;` 连接。不要 `npm test` 整仓。不要改 `playwright.config.ts` 的 `testMatch`。

## 启动提示

实现 Slice 05。合同是 `docs/product/slice-05-story-delete.md`。按合同编码、跑所列命令、回报文件/输出/阻塞。不要改范围或架构。不要碰无关已改文件。
