# Slice 13：原剧本抽对白/旁白并对齐后生图

状态：已实现。依赖 Slice 09 / 11 / 12。决策见 [ADR 027](../decisions/027-script-dialogue-lettering-fork.md)。

## 用户故事

作者把《最后一片叶子》这类原文确认进场后，点 Workflow「对话处理」，系统从原文抽出谁说了什么和短旁白，对到本场人物、大纲事件和分镜格。再点生成：生图 API 只引用这些行。项目可选「模型画字」或「后期描字」。

## 文件归属

| 谁 | 文件 | 做什么 |
|----|------|--------|
| Grok 4.6 | `src/studio/domain/schemas.ts`、`index.ts` | lines 加 `kind`/`eventId`；style 加 `lettering`；lettering 加 `kind`/`anchor` |
| Grok 4.6 | `src/studio/dialogue/**`、`generate/compile-prompt.ts`、`style/**`、相关 HTTP | 原文抽取+匹配；confirm 可 async；Compiler 按 lettering 分叉 |
| Grok 4.6 | `src/studio/dialogue/dialogue.test.ts`、`generate/compile-prompt.test.ts`、style 测试 | 验收单测 |
| agy | `WorkflowPanel.tsx`、`OutputsPanel.tsx`、`OverviewPanel.tsx` 或 Settings、`translations.ts`、`sections.test.ts` | 对齐卡片；页内文字选择；overlay 四角气泡/旁白条；model 不叠字 |

不要改导演算法、大纲导图、SQLite、视频。不要写 `outline.json`。

## 接口

`POST .../dialogue/confirm`（场级与项目级）仍确认已分镜场；实现改为 async。

`dialogue.lines[]` 增加：

```
kind: "speech" | "narration"   // 缺省 speech
eventId: string                 // timelineEventId(volume, chapter, scene)
```

`speech` 的 `speakerId` 必须是本场 `characters[]`。`narration` 的 `speakerId` 为 null，正文 ≤40 汉字（按 Unicode 字计数即可）。

`styles/default.json`：

```
lettering: "model" | "overlay"   // default "model"
```

`PATCH` 风格：可只改 `lettering`，改画风预设时保留已选 `lettering`。

`lettering` 气球：`kind: "speech" | "narration"`，`anchor: "tl"|"tr"|"bl"|"br"`。`assembleProjectDialogue` 把 `kind`/`eventId` 和场景 `eventId`/title 带给前端。

Compiler：

- `model`：含确认原文；要求在对应格画出对白气泡/旁白条；**不得**出现 “Do not letter the words in the pixels”。
- `overlay`：留白、不要画字（可保留现有那句）。
- 两种都只引用确认行，不扫 `script`。

抽取：

- 有文本模型：LLM + Zod。注入本场人物 id+名、intent、各 shot id/purpose/action。`speakerId` 必须在场上人物里；`text` 规范化后必须是剧本子串（防润色）。
- 失败回退正则：保留现有文学引语；**不再**丢弃 `旁白:` / narrator；`she said` 仅在本场只有一名可匹配女性人物时才猜，否则不抽该行。
- 赋格：每格最多 2 句 `speech` + 1 句 `narration`，超出进 `unassigned`（`shotId = null`）。
- `eventId` 一律本场 `timelineEventId`。

## 界面合同

- Workflow 对话阶段：每行能看见种类、说话人（或「旁白」）、事件标题、格号、原文。`data-dialogue-line` 保留；增加 `data-line-kind`、`data-line-event`、`data-line-shot`。
- Overview 或 Settings：`data-lettering-mode` 选择 `model` / `overlay`。
- Outputs：`style.lettering === "overlay"` 才渲染描字层；对白气泡 vs 旁白条外形不同；按 `anchor` 停在格的四角，不要整页居中一张网。`model` 时不渲染 `data-testid="comics-lettering"`。

## 验收

- Last Leaf **原文**（`test/resource/test_The Last Leaf.txt` 进场，不改成 `Sue:` 台词本）确认后：Sue/Johnsy 带引号台词抽出且 `speakerId` 为人物；至少一条短旁白可为 `narration`（若原文有时空句），长描写不进。
- `"I want to live," she said.` 在 Johnsy 在场时归到 Johnsy。
- 每行有本场 `eventId`；一格不超过配额。
- 确认后改 `script` 再 `generateShot`：prompt 仍是确认行。
- `lettering=model` 的 prompt 含确认原文，不含 “Do not letter the words in the pixels”。
- `lettering=overlay` 的 prompt 要求勿画字；assemble 页的 lettering 有 `kind`/`anchor`。
- 磁盘无第二份对白库。

## 非目标

图上拖气泡、逐行审核台、`monologue` kind、Stale、配音、PDF/CBZ、双重字。

## 验证（Grok 只跑相称测试）

```
npx vitest run src/studio/dialogue/dialogue.test.ts src/studio/generate/compile-prompt.test.ts src/studio/style/style.test.ts
```

agy 跑：

```
npx vitest run src/features/studio/sections.test.ts
```

agy 观感结论写 `/tmp/slice-13-agy.md`。
