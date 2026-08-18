# ADR 027：原剧本抽对白/旁白，页内文字可选模型或描字

## 背景

用户认为漫画旁白有问题：现在像是在剧本里单独写人物对话。他要工作流从**原剧本**抽出人物对话，对齐场景、实体、事件，再交给生图 API。随后覆盖 ADR 024 的死规定：不再假定「模型会毁字」；人可以选择模型是否在图里画字。

这覆盖 [ADR 024](./024-timeline-pipeline-lettering.md)「字只走描字层、prompt 禁止画字」，以及 [slice 09](../product/slice-09-confirmed-dialogue.md) 只靠正则抽台词本的做法。ADR 025「生图不扫 script、只引用确认行」仍有效。

## 决策

1. **对话处理读原文。** `confirmSceneDialogue` 从 `scene.script` 抽对白与短旁白，对齐本场人物实体、本场 timeline 事件、分镜格。已配文本模型走 LLM + Zod；失败回退正则。人点一次确认，不必把剧本改成 `Sue: "..."`。
2. **两种 kind。** `speech`：说话人必须是本场人物。`narration`：时空/画外短句，`speakerId = null`，≤40 汉字；不是整段环境描写。内心独白有说话人则当 `speech`。
3. **页内文字是项目分叉。** `styles/default.json` 增加 `lettering`: `model` | `overlay`，默认 `model`。模型绘制：prompt 要求按确认行画气泡/旁白条，Outputs 不叠字。后期描字：prompt 留白勿画字，Outputs 按格四角叠气泡/旁白条。禁止双重字。改模式后须重跑生图。
4. **仍禁止生成时扫 script。** Compiler 只吃确认行。

## 后果

- ADR 024 第 3 条「不得把字画进像素」不再是唯一路径；描字层仍是 `overlay` 模式的实现。
- Workflow 对话阶段要能看出「谁 · 哪场事件 · 哪一格 · 对白/旁白」。
