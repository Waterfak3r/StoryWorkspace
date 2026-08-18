# ADR 029：实体状态按情节时刻分开

## 背景

《麦琪的礼物》开场页把 Della 画成短卷发。人设 JSON 写了「后来剪了发」，参考图锁死短发；场后补丁又挂在上一场，Resolver 只叠「本场之前」。用户判断：实体在故事不同时间的状态没有分开对应相应的情节。

这覆盖 [slice 11](../product/slice-11-story-state-context.md)「补丁写在变化发生的场、只向后叠」的读法。

## 决策

1. **身份 ≠ 时刻。** `entity.visual.base` / 参考图是首次稳定外观。剪发、负伤、卖掉不得写进人设。
2. **状态按场、对应本场情节。** `content-states/<volume>/<chapter>/<scene>.json` 描述**这一场里已经成立**的 outfit / condition，不是「这场结束才生效」。
3. **Resolver 读此刻。** `state = default + 本场之前的补丁 + 本场补丁`。开场没有剪发补丁就是长发；烫发等 Jim 的场自己挂短发。
4. **推断写在状态已经为真的场。** 下一场剧本已是 close-lying curls，补丁落在那一场，不落到还在放长发的上一场。

## 后果

- 场 A 的 snapshot 不再吃「本场结束才发生」的补丁。
- 生图 Compiler 继续只吃叠后 `state`，但叠法改为此刻。
- 镜头级 Continuity（一场内发型中途变化）仍不做。
