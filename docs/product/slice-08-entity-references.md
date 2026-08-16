# Slice 08：实体参考图进生图

状态：已实现。依赖实体 JSON + 生图 adapter。决策见 [ADR 022](../decisions/022-entity-reference-images.md)。

## 目标

1. 角色 / 地点 / 道具 / 服饰可上传参考图，写入 `visual.references` 与 `assets/images/<entityId>/`。
2. 生漫画页时，把出场实体的参考图**作为图片**发给 Image API。
3. 无参考图则退回文字 identity lock，不报错。

## 非目标

- 自动生成角色设定表
- 视频、PDF
- 产品次数上限

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/studio/projects/:projectId/entities/:entityId/references` | multipart `file` → 更新 entity |
| GET | `/api/studio/projects/:projectId/files/assets/images/...` | 读参考图 |

## 测试

磁盘写入真实 PNG，驱动 adapter：请求 URL 为 `/images/edits`，body 含该 PNG 字节，不只含路径字符串。
