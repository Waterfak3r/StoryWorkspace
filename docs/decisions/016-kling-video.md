# ADR 016：钠 API 可灵文生视频

**已撤回，见 017**

## 背景

用户要求按 [钠 API 可灵文档](https://naapi.apifox.cn/9268423m0) 配置视频生成。MVP 原文写明「明确不做：视频」，但这是**用户请求覆盖**：只做单镜文生视频闭环，不恢复 Phase 5 Fake Video 页，不做配音/音乐/混音/成片合成，也不做图生视频（该 SDK 仅文生视频）。

## 决策

1. 仅在 `src/studio/` 镜像生图栈：Settings `video`、Kling adapter、假 adapter、`generateVideo`、shot/workflow HTTP、Workflow/Outputs UI。
2. 协议：`POST /videos` 一次提交 → 轮询 `GET /videos/{task_id}`（12s / 总超时 900s）→ `GET .../content` 或 URL 下载 MP4 到 `outputs/videos/<sceneId>/<shotId>/<runId>.mp4`。
3. **防重复计费**：提交成功后立刻把 `videoTaskId` 写入 workflow node；若 node 已有未完成 `videoTaskId`，只轮询、禁止再次 POST。失败后下一次用户显式生成可新开任务。
4. 视频不改 `shot.status` / `selected_image`；成功写 `selected_video`；失败保留旧 `selected_video`。锁定镜与生图同样拒绝。
5. 未配置 key+model 时用仓内 `fakeVideoAdapter` 写非空 `.mp4` 文件（不引用 `src/server/media/fake-video-adapter.ts`）。

## 后果

- Settings 增加 Video API；密钥仍用户级 `providers.json` / 环境变量，永不进项目 JSON 或 GET 明文。
- Workflow 每镜可「生成视频」；Outputs 另列已选视频路径。
- `mvp.md` 将「明确不做：视频」收窄为不做混音/成片；单镜 Kling 作为切片后补。
