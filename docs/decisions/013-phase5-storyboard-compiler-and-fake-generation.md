# ADR 013：Phase 5 不可变镜头输入、能力编译与 Fake Provider 生成链

## 背景

Phase 4 已把当前正文、confirmed link、Base Canon 与 Scene State 冻结为 provider-neutral Context Snapshot。首个 Vertical Slice 还需要把一个 Snapshot 转成可审核 Storyboard/ShotSpec，按目标能力编译，经过与真实 Provider 相同的 Adapter 边界，并保存不可变 Generation Manifest。若 Shot、编译结果或 Provider 参数仍在提交时读取实时 Story Bible，本次生成将失去可复现性。

## 决策

1. Phase 5 分三个可独立提交的单元交付：5A Storyboard + ShotSpec；5B capability-aware compiler + Fake Provider 编译预览；5C Generation Manifest + Fake Provider job/result。每个单元通过自身测试后提交并推送。
2. Storyboard 是绑定一个 Context Snapshot 的不可变内容版本。创建请求一次性提交标题和有序 ShotSpec；修改不原地覆盖，而是创建带 `supersedesStoryboardId` 的新 Storyboard，并以 expected version 原子地把旧版本标记为 superseded。draft Storyboard 可用 CAS approve，ShotSpec 内容始终不可更新。语义去重只复用 draft/approved 活动版本；历史 superseded 版本永久保留，但不阻止作者之后显式重新创建相同内容。
3. 每个 ShotSpec 有稳定 ID、ordinal、叙事目的、主体/action/framing role、地点、道具、机位、时长与约束。主体、地点和道具必须存在于所绑定 Snapshot 的 included entities，且类型匹配；同一 Storyboard ordinal 唯一。Manifest 只接受 approved Storyboard 的不可变 ShotSpec。
4. Phase 5B 引入代码拥有且带版本的 `fake-video` capability profile，以及项目内 approved reference-image metadata。Compiler 输入只包含 Context Snapshot、ShotSpec、capability profile 与明确选择的 reference asset IDs；输出 provider-neutral prompt segments、asset inputs、参数、warning 和 omitted context，不负责提交或重试。
5. Fake profile 支持文本与最多两张 reference image、4/6/8 秒、16:9 或 9:16。reference asset 不足或超过能力时，Compiler明确降级/裁剪并记录 warning；不存在、未批准、跨项目或与 Shot 实体无关的 asset 拒绝编译。Provider-specific 字段只出现在 capability/compiler/adapter 模块。
6. Compiler output 使用 canonical JSON + SHA-256，固定 compiler version 和 capability profile version。相同 Snapshot + ShotSpec + profile + asset versions + 参数产生相同 compiled hash；预览可持久化为不可变 compiled request，供 Manifest 精确引用。
7. Phase 5C 的 Generation Manifest 是唯一提交输入，绑定 Context Snapshot、ShotSpec、compiled request、Fake provider/model/profile/compiler version 和完整参数；身份及内容不可更新。提交命令使用完整 request fingerprint 和项目级幂等键，在同一事务内创建 Manifest/job/audit/outbox 后调用 Fake Adapter。
8. Fake Adapter 实现与真实 Adapter 相同的 validate/prepare/submit/getStatus/normalizeResult 边界，但不联网、不收费、不读取环境密钥。默认确定性完成并生成 `fake://` result；显式测试参数可产生归一化失败。重试同一 requestId 不创建第二个 Manifest/job/result，也不产生第二次 fake submit。
9. UI 从当前 Context Inspector 选择/创建 Storyboard，审核并 approve ShotSpec，预览实际 prompt/asset/fallback，再提交 Fake generation。dirty Scene revision 不阻止消费已经冻结且明确选中的 Snapshot，但从当前 Scene 自动创建新 Storyboard时要求 Snapshot 与所选 Scene/revision一致。

## 迁移与影响

- v15 additively 增加 Storyboard/ShotSpec；v16 增加 reference asset 与 compiled request；v17 增加 Generation Manifest/job/result。旧表不重建。
- Context、Storyboard、ShotSpec、compiled request 和 Manifest 形成逐层不可变引用链。Story Bible 或 Scene 后续修改不会改变已提交任务；用户需要显式以新 Snapshot 创建新链路。
- 首个 Adapter 仅为本地 Fake Provider。真实上传、webhook、计费、取消、对象存储和 Provider secret 不在本 ADR 的完成声明中。

## 验收

- Storyboard/ShotSpec 正常创建、修改留历史、approve CAS、request replay、stale/跨项目/非法实体引用均有测试。
- 固定 Snapshot + Shot + capability 产生 golden compiler output；文本和参考图路径以及能力降级都可检查。
- 每个 Fake result 可读取其 Snapshot、Shot、完整编译输入、模型和参数；Manifest 不随上游变化。
- Fake submit 的成功、归一化失败和幂等重试有测试；文档保存与现有 Phase 0–4 流程不受影响。
