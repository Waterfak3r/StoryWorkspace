# ADR 024：大纲时间线、全链 Workflow、页内对白描字

## 背景

用户覆盖：故事大纲必须是人物-时间-事件时间线，不是卷/章/场卡片；Workflow 必须是 GitHub Actions 式全链（文字生成 → 导入 → 分镜 → 生成漫画）；漫画对白是页内气泡/描字，不是 Outputs 图下的 `panel.caption`。这覆盖 [ADR 021](./021-comics-page-layout.md)「不对白气泡 / 描字」和 `mvp.md` 旧限制。

界面参照：Aeon Timeline / Plottr 的人物泳道×事件交点；GitHub Actions 的 job 图；漫画工具把描字当独立层，因为图像模型会把字画坏。对白数据与描字层来自 [comics-workflow-proposal.md](../product/comics-workflow-proposal.md) 已写的格级 `speech` 与「字在图上」。

## 决策

1. 大纲汇编产出 `timeline`（序列轴、人物泳道、`intersections`）。卡片树可保留作钻入，不是主视图。
2. Workflow 汇编产出固定五阶段图：文字生成、导入阶段、分镜阶段、对话处理、最终生成漫画。镜头节点只作钻入。
3. 对白先从剧本抽说话人+台词，再赋格，再描字。Compiler 消费这些台词，不得把 `shot.action` / `panel.caption` 当对白。默认风格不再禁止气泡。
4. 出血 / PDF / CBZ 仍不做。

## 后果

- ADR 021 第 5 条「不对白气泡 / 描字」作废；其余页图决策仍有效。
- 新项目默认风格为气泡留空，描字由数据层画在页上。
