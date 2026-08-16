# Slice 04：生图、带约束重生成、锁定、Workflow

状态：已实现。依赖 Slice 01–03。不要做视频 / 配音。不要 SQLite。

## 目标

1. 用 OpenAI 兼容 Image API（测试用**仓内假 adapter**）给 Shot 生图
2. 单镜可按前后连续性约束重生成
3. 锁定后不得静默覆盖 `selected_image`
4. Workflow 显示节点 待跑 / 成功 / 失败 / 锁定，可对未锁定镜重跑

## 分层

```
Context Resolver（纯快照，Slice 03）
  → Prompt Compiler（把快照编成 adapter 输入；Provider 参数只在这里）
  → Image Adapter（假 / 真）
  → 写 outputs/images/... 与 workflow/nodes/...
```

假 adapter 必须写出一个真实文件（哪怕是 1×1 PNG 或固定字节），并把相对项目根的路径写回 `selected_image`。空结果或抛错算缺陷，测试不得跳过。

真 adapter 请求体含 `quality`、`n: 1`、`response_format: "b64_json"` 与 `moderation: "low"`，超时 300s（同步 Images API，无 polling）。

## 磁盘

```
<project>/outputs/images/<sceneId>/<shotId>/<runId>.png
<project>/workflow/nodes/<shotId>.json
<project>/workflow/runs/<runId>.json
```

节点：

```json
{
  "id": "shot-01",
  "shotId": "shot-01",
  "sceneId": "scene-01",
  "status": "success",
  "statusLabel": "成功",
  "locked": false,
  "selectedImage": "outputs/images/scene-01/shot-01/run-01.png",
  "continuityConstraints": "",
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`status` 与 Shot 对齐：`pending`/`success`/`failed`/`locked`；`statusLabel` 为 待跑/成功/失败/锁定。

## 行为

`generateShot(projectId, scenePath, shotId, { mode: "generate" | "regenerate" })`：

- locked → 拒绝（409），不改 `selected_image`
- 组装 Context snapshot；`regenerate` 时必须把前镜 + 当前镜状态编成 `continuityConstraints` 字符串，写入 snapshot 或 node（测试能读到）
- compiler → adapter → 写图
- 成功：`shot.status=success`，`selected_image` 更新；node 同步
- 失败：`shot.status=failed`，保留旧 `selected_image`

`lockShot` / `unlockShot`：status `locked` 或回到 `success`/`pending`。

`rerunUnlockedShot`：未锁定则走 regenerate；锁定拒绝。

幂等键：`runId`。超时与有限重试只在 adapter。

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `.../shots/:shotId/generate` | `{ mode?: "generate" \| "regenerate" }` |
| POST | `.../shots/:shotId/lock` | `{ locked: true \| false }` |
| GET | `/api/studio/projects/:projectId/workflow` | `{ data: { nodes } }` |
| POST | `/api/studio/projects/:projectId/workflow/nodes/:shotId/rerun` | 未锁定重跑 |

## UI

Workspace 分区启用 **Workflow**（可点）。列出每镜状态，重跑未锁定镜，展示连续性约束。Outputs 列出已选图片路径或缩略。Story bible / Outline / Adaptations 不得回到主 IA。

## 测试

驱动 shipped `generateShot` / `lockShot` / `rerunUnlockedShot` + 假 adapter：

1. generate 后磁盘有图，shot.status=success，selected_image 非空
2. regenerate 的请求或 snapshot 含 continuity 约束
3. lock 后再 generate 被拒，selected_image 不变
4. workflow 节点 statusLabel 为 待跑/成功/失败/锁定 之一；未锁定 rerun 被接受

## 密钥

环境或用户级配置。项目 JSON / 图侧车 / 日志不得出现真实 Key 或 `sk-`。
