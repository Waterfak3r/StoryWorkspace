# Slice 07：漫画页（一次 API 一张页）

状态：已实现。依赖 Slice 01–04。决策见 [ADR 021](../decisions/021-comics-page-layout.md)。

## 目标

1. `compileComicsPagePrompt` 把同一页 1–4 镜编成**一页连环画**提示：单图、阅读顺序、格间分隔、跨格锁定形象。
2. `generateShot` 对所在页只打 **一次** Image API，写出 `outputs/comics/pages/<pageId>/<runId>.png`；页内未锁定镜共享该路径。
3. 已有多张不同静帧时，汇编合成一张页图（上二下一 / 2×2 等），Outputs 只显示 `page.pageImage`。
4. `GET .../comics` 返回 `{ data: { book } }`；空项目 `pages: []`。

## 非目标

- 对白气泡、描字、出血、PDF / CBZ
- 视频 / 配音 / 音乐
- 产品级生图次数上限

## 磁盘

- 页图：`outputs/comics/pages/<pageId>/<runId>.png` 或 `composed.png`
- 旧单镜静帧仍可在 `outputs/images/...`，汇编时合成进页图

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/studio/projects/:projectId/comics` | `{ data: { book } }`，含 `pageImage` |

## 测试

驱动 `compileComicsPagePrompt`、`generateShot`（一页一文件）、合成器、GET。禁止只测 CSS 四宫格。
