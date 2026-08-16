# ADR 019：故事大纲栏与全本摄入

## 背景

用户要求增加故事大纲栏，对整个项目做可视化梳理；用 `test/resource` 长文反复验证，使解析结果成为工作流可复用的环境、情节、实体，并生成前后风格/人物一致的漫画静帧。当时说的「生图最多 50 次」是给代理的测试预算，不是产品配额。

## 决策

1. 大纲是**只读汇编**：`assembleStoryOutline(projectId)` 读已落盘的 tree + scene 情节 + 实体链接 + shots，不另存一份大纲真相。
2. UI 增加分区 `outline`（文案 Story outline / 故事大纲）。HTTP `GET /api/studio/projects/:projectId/outline`。
3. 解析仍走 parse → normalize → preserve scripts → confirm。模型剧本若覆盖不足，按场次切分原文写入各场 `script`，实体提案保留。
4. Director 可注入。默认导演给出变化的艺术机位语汇；已配文本模型时 HTTP 导演走 LLM + Zod，失败回退默认导演。
5. 项目默认 comics 风格写入 `styles/default.json`。新建实体若有描述则写入 `visual.base`，供 Compiler 跨镜锁定形象。
6. 真 Images API 不设产品次数上限；用户按自己的 Key 与套餐使用。

## 后果

- 不恢复 `main` 的 SQLite Outline 产品。
- 「不做漫画页排版 / 分镜网格」已被 [ADR 021](./021-comics-page-layout.md) 取代。
- 全本呈现靠大纲 + 结构化情节/环境/实体；代理联调时自行控制真图调用次数。
