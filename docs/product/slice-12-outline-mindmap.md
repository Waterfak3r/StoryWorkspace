# Slice 12：时间作脊的实体-时间-事件导图

状态：已实现。依赖 Slice 06 / 10 / 11。决策见 [ADR 026](../decisions/026-outline-mindmap-time-spine.md)。

## 用户故事

作者打开「故事大纲」，看见一张导图：卷/章沿时间脊展开，事件挂在对应章下，出场实体从事件连出去。点实体看出场轨迹和人设，点事件钻入该场。新写一场并挂已有实体后，再 GET outline，图自动变密。

## 文件归属

| 谁 | 文件 | 做什么 |
|----|------|--------|
| Grok 4.6 | `src/studio/domain/schemas.ts`、`src/studio/domain/index.ts` | 给 timeline 增加 `times` / `containments`，导出类型 |
| Grok 4.6 | `src/studio/outline/build-timeline.ts`、`assemble-outline.ts` 及对应 `*.test.ts` | 汇编时间节点与包含边；补单测 |
| agy | `src/features/studio/OutlinePanel.tsx` | 主视图改成时间作脊导图；去掉货架/横链/矩阵 |
| agy | `src/features/studio/sections.test.ts`、`e2e/studio-outline-workflow.spec.ts` | 断言导图节点与连线，不再断言泳道 |
| agy | `src/features/i18n/translations.ts` | 只改本屏文案 |

不要改生成、导演、Outputs、Workflow 流水线。不要写 `outline.json`。不要双栈 SQLite。

## 接口

`GET /api/studio/projects/:projectId/outline` 仍返回 `{ data: { outline } }`。`timeline` 增加（均带 `.default([])`，旧夹具不炸）：

```ts
times: Array<{
  id: string;                 // volume: 用 volumeId；chapter: `${volumeId}-${chapterId}`，撞车则 slugify
  kind: "volume" | "chapter";
  title: string;
  volumeId: string;
  chapterId: string | null;   // volume 为 null
  parentTimeId: string | null; // chapter → 其卷的 time id；volume → null
}>

containments: Array<{
  fromTimeId: string;
  toTimeId?: string;   // 卷 → 章
  toEventId?: string;  // 章 → 事件；二者恰有一个
}>
```

保留现有 `events` / `entities` / `connections` / `stateChanges` / `characters` / `intersections`。

规则：

- 每个卷、每章各一个 time 节点，按树顺序。
- 每个事件恰好一条章 → 事件包含边。
- 每个章恰好一条卷 → 章包含边。
- 时间节点 id 不得与 `events[].id`、`entities[].id` 碰撞。
- 磁盘不出现 `outline.json`。

## 界面合同

一张画布，三类可点节点、可见连线：

- `[data-outline-map]` 根。保留 `[data-outline-timeline]` 以免旧选择器全死，但主语义用 map。
- `[data-outline-time][data-time-kind=volume|chapter]`
- `[data-outline-event]`（可继续带 `data-timeline-event`）
- `[data-outline-entity]`
- `[data-outline-edge][data-edge-kind=contains|sequence|participates|state]`

布局：卷/章沿阅读顺序作脊（可折叠章）；事件挂在所属章下；实体从参与事件的侧面长出。选中实体高亮其全部出场边与事件。选中后仍用 inspector：实体看人设+轨迹，事件钻入场。

禁止：实体 token 货架当主视图、节拍横链当主视图、角色 × 事件 `<table>` 矩阵、`article[data-outline-scene]` 卡片罗列、图上拖连新建关系。

## 验收

- Last Leaf 摄入后：`times` 含卷与章；每个事件有章包含边；Sue / Johnsy 在 `entities` 且 `appearanceEventIds.length >= 1`；地点在 `entities`。
- 同一 entity id 出现在两场时，参与边/轨迹含两个 event id。
- e2e：新建项目加两场、一场挂角色后，大纲可见时间节点、至少 3 个事件节点、包含边、该角色实体节点与至少一条参与边。不可见泳道表、不可见场卡片。
- `sections.test` 断言 map / time / event / entity / edge，不再要求 `data-timeline-lane` / `data-timeline-cell`。
- 磁盘无第二份大纲真相。

## 非目标

图上拖连、故事世界时钟、组织 / Creature、可编辑脑图文件、视频。

## 验证（Grok 跑与改动相称的测试，不整仓重跑）

```
npx vitest run src/studio/outline/build-timeline.test.ts src/studio/outline/assemble-outline.test.ts src/features/studio/sections.test.ts
npx playwright test e2e/studio-outline-workflow.spec.ts --grep "story outline"
```

agy 不跑后端测试；做完后写观感结论到 `/tmp/outline-mindmap-agy.md`。
