# Slice 10：实体×情节活地图

状态：已实现。依赖 Slice 06。决策见 [ADR 025](../decisions/025-living-outline-referenced-dialogue.md)。

## 目标

1. 大纲汇编增加 `timeline.entities[]`：`id`、`kind`、`name`、`description`、`visualBase`、`appearanceEventIds`。角色全部上图；地点上图；被场引用的道具/服饰上图。
2. 保留现有 `events` / `characters` / `intersections` / `connections`，e2e 时间线选择器不坏。
3. 点实体可看出场事件轨迹与人设摘要。点事件仍钻入场。
4. 新写一场并挂已有实体，再 GET outline，该实体 `appearanceEventIds` 自动变长。不写大纲文件。

## 非目标

- 图上拖连
- 状态边（见 Slice 11）
- 组织 / Creature

## 测试

- Last Leaf 摄入后：Sue / Johnsy 在 `entities` 且 `appearanceEventIds.length >= 1`；地点在 `entities`。
- 同一 entity id 出现在两场时，轨迹含两个 event id。
- 磁盘上不出现 `outline.json` 之类第二真相。
