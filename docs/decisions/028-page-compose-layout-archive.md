# ADR 028：生图单位分叉、可变版式、空间锁、一键开始与旧稿归档

## 背景

Live soak 把 `pageSize` 写死为 2，导演一场最少两镜，编译器只锁人设不锁房间。人看到的是永远两张图、床和窗左右对不上，并推测主链是「单张再拼」。主链其实已是一次 API 出一整页（ADR 021），但缺项目级分叉、缺空间 Canon、缺按情节切页、Workflow 不能一键跑完全书缺页，旧 `run-N` 还和当前图堆在同一页目录。

## 决策

1. **生图单位是项目分叉。** `styles/default.json` 增加 `compose`: `page` | `panels`，默认 `page`。`page`：一页一次 Image API。`panels`：一格一次，再合成页图。改档后须重跑该页。
2. **版式是项目分叉。** `layout`: `2` | `3` | `4` | `auto` | `marvel`，默认 `auto`。固定档按格数切页；`auto` 由导演按情节切 2–4 格，禁止再「每 N 镜一刀」；`marvel` 仍切 2–4 格，但 prompt 要求不规则分格，且只在 `compose=page` 时生效，与 `panels` 同时选则降为整齐格再拼。不做格子几何编辑器。
3. **地点有空间 Canon。** 地点 `visual.spatial` 是可编辑短句。Compiler 每页复读；跨页 continuity 带左右关系。不自动出地点设定图。
4. **当前书与旧稿分家。** 当前页只写 `outputs/comics/current/<pageId>.png`。写出或重跑前把旧当前图（及逐格工作图）搬进 `outputs/archive/<batchId>/`。Outputs 只汇编 current。本决策不做归档浏览 UI。
5. **一键开始跑缺口。** `POST .../workflow/start`：无镜则导演，对白未确认则确认，再生成所有没有当前页图的未锁页。不替人确认解析。已有 current 的页不重画。

## 后果

- ADR 021「一次 API 一张页」仍是默认；`panels` 是可选贵路径，遗留合成器只为这一档服务。
- 漫画工作流草案里「导演按场切页」第一次进实现基线（`auto`/`marvel`）。
- soak / 测试不得再写死 `pageSize: 2` 当产品默认。
