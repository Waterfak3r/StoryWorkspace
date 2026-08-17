# Slice 09：确认对白，生图只引用

状态：已实现。决策见 [ADR 025](../decisions/025-living-outline-referenced-dialogue.md)。

## 目标

1. Scene 持久化 `dialogue`：`status`（`unprocessed` | `confirmed`）+ `lines[]`（`id`、`speaker`、`speakerId`、`text`、`shotId`）。
2. `confirmSceneDialogue`：用当前场剧本 + 已挂人物 + 已有分镜抽词赋格，写入确认台词。旧场缺字段视为未处理。
3. 生图、描字、`assembleProjectDialogue` **只读确认行**。未确认 → 无对白。禁止 `extractAttributedDialogue(scene.script)` 出现在 generate / letter / pipeline 成功判定里。
4. Workflow「对话处理」成功 = 每个已有分镜的场 `dialogue.status === "confirmed"`（允许 0 行）。
5. HTTP：`POST .../scenes/:sceneId/dialogue/confirm`；项目级 `POST .../dialogue/confirm` 确认所有已分镜场。

## 非目标

- 对白逐行人工审核台
- 剧本变更后的自动 Stale
- 图上编辑对白

## 测试

- 确认后改 `script`，再 `generateShot`：prompt / 描字仍是确认台词，不是新剧本。
- 未确认但剧本有引号：prompt 不含 `speech:`，描字为空。
- 抽出的 `speakerId` 必须是场上人物实体 id。
- Pipeline：只改剧本不再使 dialogue 阶段变成功；确认后才成功。
