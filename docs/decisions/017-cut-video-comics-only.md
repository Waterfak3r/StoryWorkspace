# ADR 017：撤回 Kling 视频，多模态只做漫画静帧

## 背景

用户明确要求砍掉视频模块，多模态只做漫画。ADR 016 曾把单镜 Kling 文生视频作为切片后补接入 studio；该决策被用户撤回。

## 决策

1. **撤回** studio Kling / 视频生成切片：删除 adapter、假 video adapter、generate-video、video HTTP 路由、Settings Video API、Workflow/Outputs 视频 UI 与 i18n 相关文案。
2. Studio 多模态只保留漫画静帧 / 分镜生图（钠 API gpt-image 等 Image adapter）；**不做**视频、配音、音乐、混音、成片合成。
3. 不做漫画页排版、分镜网格或新的 comics compiler；本决策只砍视频，不另建漫画编译管线。
4. 不恢复 Phase 5 / SQLite Fake Video 产品路径。
5. Schema 严格：shot / workflow node / run 去掉 `selected_video` 与 video 字段；旧磁盘 `providers.json` 可只读时忽略 leftover `video`，写入时丢弃。

## 后果

- `mvp.md` 切片 05 标为已撤回；「当前限制」按用户决策补充为：多模态只做漫画静帧，不做视频。
- ADR 016 顶部标注已撤回。
- 测试与本地 JSON 中的 video 键需清理，避免 strictObject 校验失败。
