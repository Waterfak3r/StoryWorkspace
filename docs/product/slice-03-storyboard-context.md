# Slice 03：可编辑分镜 + 可检查 Context Snapshot

状态：已实现。依赖 Slice 01–02。不要做生图 API 调用。不要 SQLite。

## 目标

1. 一场 Scene 变成多个用户可编辑 Shot
2. Shot 字段：`id`、`scene_id`、`purpose`、`action`、`camera`、`continuity_from`、`status`、`selected_image`
3. Context Resolver 产出可检查 JSON 快照：本场实体身份与状态、项目风格、Intent、前镜连续性

## 非目标

- 真实/假 Image API 写文件（下一刀）
- 视频 / 配音
- 完整 Version / Stale 引擎

## Shot 合同

存在 `scene.shots[]`（替换 Slice 01 的 `unknown[]`）。单镜：

```json
{
  "id": "shot-01",
  "scene_id": "scene-01",
  "purpose": "Establish the quay",
  "action": "Jill stands under a lantern",
  "camera": "wide, slow push-in",
  "continuity_from": null,
  "status": "pending",
  "selected_image": null,
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`status`：`pending` | `success` | `failed` | `locked`（中文展示：待跑 / 成功 / 失败 / 锁定）。

`continuity_from` 为同场前一镜 `id` 或 `null`。

Director（可注入）：`directScene(scene) → Shot[]`。无已有 shots 时至少 2 镜。测试用确定性假 Director，走同一入口。用户可 PATCH 任意镜字段（status/selected_image 本切片可写 pending，生图切片再管锁定）。

## Context Resolver

纯函数 `resolveContext({ project, scene, style, entities, shotId })`：

```json
{
  "scene": { "id": "", "title": "", "script": "", "intent": "" },
  "entities": [
    {
      "id": "",
      "kind": "character",
      "name": "",
      "description": "",
      "visual": { "base": "", "references": [] },
      "state": { "outfit": "", "condition": "" }
    }
  ],
  "style": { "id": "default", "label": "Default", "visual": "" },
  "intent": "",
  "shot": { "id": "", "purpose": "", "action": "", "camera": "" },
  "continuity": {
    "from": "shot-01",
    "prior": { "action": "", "camera": "", "purpose": "" }
  }
}
```

`continuity.from` 为 `null` 若无前镜。快照是数据对象，不是只拼出来的 prompt 字符串。Provider 参数禁止进入快照。

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `.../scenes/:sceneId/director` | 生成/补齐 shots，返回 scene |
| GET | `.../scenes/:sceneId/shots` | `{ data: { shots } }` |
| PATCH | `.../scenes/:sceneId/shots/:shotId` | 可编辑字段 + `expectedUpdatedAt` |
| GET | `.../scenes/:sceneId/context?shotId=` | `{ data: { snapshot } }` |

Scene PATCH 仍不强制改 shots 数组整体替换；改镜走 shot PATCH。若需兼容，scene 读出含完整 shots。

## UI

Story 中栏或右侧：镜列表，编辑 purpose/action/camera。可点「Inspect context」看 JSON 快照。Workflow 仍可先只读展示镜状态。

## 测试

驱动 `directScene` / `updateShot` / `resolveContext`（或 HTTP）：

1. Director 后 `shots.length >= 2`，PATCH 某字段落盘
2. 快照含 entity id/name/state、style.visual、scene.intent、prior-shot continuity（第二镜）
3. 快照可 `JSON.parse` 为对象且含上述键

## 验收

- 多镜可列、可改、刷新仍在
- 快照可读且含实体、状态、风格、Intent、前镜连续性
