# Slice 11：Story State 与前情进编译

状态：后端已实现；场上补丁编辑器未做。决策见 [ADR 025](../decisions/025-living-outline-referenced-dialogue.md)。

## 目标

1. `states/content-states/<volumeId>/<chapterId>/<sceneId>.json`：`volumeId`、`chapterId`、`sceneId`、`patches[]`（`entityId`、可选 `outfit` / `condition` / `note`、`truth`: `canon` | `inferred`）、`updatedAt`。场号只在章内唯一，不能只按 sceneId 落盘。
2. HTTP：读/写一场的场后补丁。缺省文件 = 无补丁。
3. `resolveContext`：实体 `state` = `states.default` 叠加故事顺序里**本场之前 + 本场**的补丁（「此刻」对应本场情节，不是只叠上一场结束之后）。快照增加可检查的 `storyPosition`（前若干事件的 title+summary，截断）。
4. Compiler 写入叠后状态与前情；确认对白仍只来自 Slice 09。
5. 大纲：有补丁的场对应该实体画状态变化（汇编进 timeline，无补丁不画）。

## 非目标

- 通用知识图谱
- 平行世界 / Version / Stale
- 生成后自动推断补丁（可手写或测试写入）

## 测试

- 场 B（情节已是受伤之后）挂 condition=injured，场 B 的 snapshot 为 injured；场 A 仍是 default。补丁挂在状态已经成立的那一场。
- prompt 含叠后 condition，不含把 default 盖过补丁。
- 快照 `storyPosition` 含前场 title，可被测试断言。
