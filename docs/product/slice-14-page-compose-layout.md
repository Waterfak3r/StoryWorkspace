# Slice 14：生图单位分叉、可变版式、空间锁、一键开始、旧稿归档

状态：已实现。依赖 Slice 07 / 08 / 13。决策见 [ADR 028](../decisions/028-page-compose-layout-archive.md)。

## 用户故事

作者选「整页一次出」或「逐格再拼」，再选一页 2/3/4 格、让导演切、或漫威不规则分格。地点写清床和窗在哪，跨页不再对调。Workflow 按一下开始，把缺的分镜、对白、页图跑完。重画时旧图进归档，Outputs 只看当前书。

## 文件归属

| 谁 | 文件 | 做什么 |
|----|------|--------|
| Grok 4.6 | `src/studio/domain/schemas.ts`、`index.ts` | style 加 `compose`/`layout`；地点 `visual.spatial`；shot 加 `pageId` |
| Grok 4.6 | `src/studio/style/**`、`fs/repository.ts` | PATCH 可只改 compose/layout；改画风保留二者与 lettering |
| Grok 4.6 | `src/studio/comics/page-group.ts`、新 `plan-pages.ts` | 按 layout 切页；auto 2–4 不按死 N |
| Grok 4.6 | `src/studio/director/**` | 落盘时写入 `pageId`；读项目 layout |
| Grok 4.6 | `src/studio/generate/compile-prompt.ts`、`generate-shot.ts`、`image-output.ts`、新 `archive.ts` | spatial + 版式句；page vs panels；current/archive |
| Grok 4.6 | `src/studio/workflow/start-workflow.ts`、HTTP `workflow/start` | 一键开始 |
| Grok 4.6 | `src/studio/comics/assemble-pages.ts` | Outputs 只认 `outputs/comics/current/` |
| Grok 4.6 | 对应 `*.test.ts`、更新 soak 去掉写死 `pageSize: 2` | 验收单测 |
| agy | `WorkflowPanel.tsx`、`OverviewPanel.tsx`、`OutputsPanel.tsx`、`api.ts`、`translations.ts`、`sections.test.ts` | 开始按钮；compose/layout 选择；Outputs 只挂 current |

不要改对白抽取、大纲导图、SQLite、视频、lettering 语义。不要做格子拖拽或归档柜。

## 接口

`styles/default.json`：

```
compose: "page" | "panels"     // default "page"
layout:  "2" | "3" | "4" | "auto" | "marvel"   // default "auto"
```

`PATCH`/`PUT` 风格：可只改 `compose` 或 `layout` 或 `lettering` 或 `presetId`。改画风预设时保留已选 compose/layout/lettering。

地点 `visual.spatial`: string，缺省 `""`。旧 JSON 无此字段必须仍能读。

Shot `pageId`: string，缺省 `""`。导演或 `planScenePages` 写入。空则生成时按当前 layout 现算并回写。

当前图：

```
outputs/comics/current/<pageId>.png
outputs/comics/panels/<pageId>/<shotId>.png   # 仅 compose=panels 的工作图
outputs/archive/<batchId>/<pageId>.png
outputs/archive/<batchId>/panels/<pageId>/<shotId>.png
```

`selected_image` 只指向 `outputs/comics/current/<pageId>.png`。

`POST /api/studio/projects/:projectId/workflow/start` → `{ data: { directed: string[], confirmed: string[], generated: string[], skipped: string[] } }`

- 不确认解析。
- 无镜的场：导演。
- 已分镜但对白未确认：确认。
- 按 `planScenePages` 列出页；无 current 且页上无锁镜：生成。
- 已有 current 或有锁：进 `skipped`。

`generateShot` 读项目 `compose`/`layout`。测试仍可传 `pageSize` 覆盖固定格数，但产品路径不靠它。`rerun` 先归档该页旧 current（及 panels 工作图）再写新 current。

Compiler：

- 地点 `visual.spatial` 非空则每页有 `Spatial lock:` 行，continuity 也带。
- `layout=2|3|4|auto` 用整齐分格句（现成 `comicsPageLayoutLabel`）。
- `layout=marvel` 且 `compose=page`：不规则分格句，禁止写死 2×2 / two stacked。
- `marvel` + `panels`：当 auto 整齐格处理。

`compose=page`：一页一次 adapter，prompt 含该页全部 Panel。
`compose=panels`：每格一次 adapter（单格 prompt），再 `composeComicsPagePng` 写成 current。

`resolveProjectStillFile` 必须能读 `outputs/comics/current/*.png`。

## 界面合同

- Workflow 顶栏按钮 `data-workflow-start`，文案「开始」。进行中禁用并显示当前阶段。点它只调 `POST .../workflow/start`，不要再本地循环「空场第一页」。
- Overview：`data-compose-mode`（`page` / `panels`）、`data-page-layout`（`2`/`3`/`4`/`auto`/`marvel`），与页内文字并列。
- Outputs：只渲染 current 页图。`compose=panels` 可标「逐格合成」。不列 archive，不列 `run-N`。

## 验收

- 新项目 `compose=page`、`layout=auto`。
- `compose=page` + `layout=2`：prompt 含 two stacked panels + 地点 spatial（若有），一次 adapter；写出 `outputs/comics/current/<pageId>.png`。
- `compose=panels` + `layout=2`：两次 adapter，有 panels 工作图和 current 合成页；`selected_image` 是 current。
- `layout=4` 一页最多 4 格；`auto` 对 5 镜切成 2–4 的页，不是两个 2 + 一个 1，也不是按死 2。
- `marvel` + `page`：prompt 含 irregular / Marvel-style，不含 “2x2 grid” / “two stacked panels”。
- `marvel` + `panels`：整齐格合成，不把不规则写进单格 prompt。
- 无 `spatial` 的旧地点不炸。
- 一键开始：无镜+有剧本 → 导演、确认对白、每页写出 current；再点一次，已有 current 的页进 skipped。
- 重跑一页：旧 current 出现在 `outputs/archive/<batchId>/`，`current/` 只剩新图；assemble 书里没有旧路径。
- 改 compose/layout 后不自动重画。

## 非目标

格子几何编辑器、出血 / PDF / CBZ、地点设定图工厂、改 lettering、视频、归档浏览 UI、一键重画已有全书、一键确认解析。

## 验证

Grok：

```
npx vitest run src/studio/style/style.test.ts src/studio/generate/compile-prompt.test.ts src/studio/generate/generate.test.ts src/studio/comics/assemble-pages.test.ts src/studio/workflow/assemble-pipeline.test.ts src/studio/director/artistic-director.test.ts
```

若新增 `src/studio/workflow/start-workflow.test.ts` 或 `src/studio/comics/plan-pages.test.ts` 一并跑。再 `npx tsc --noEmit`。

agy：

```
npx vitest run src/features/studio/sections.test.ts
```

观感结论写 `/tmp/slice-14-agy.md`。
