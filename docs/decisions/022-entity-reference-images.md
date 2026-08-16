# ADR 022：生图必须带实体参考图

## 背景

实体已有 `visual.base` 与 `visual.references[]`。生图却只把参考路径写成 prompt 里的一行字，Image API 收不到图。用户要求保持实体一致性。

## 决策

1. `visual.references` 指向项目内真实图片（`assets/images/<entityId>/<file>`）。
2. 编译/生图收集**本页出场实体**的参考图文件（每实体优先一张，角色 > 服饰 > 地点 > 道具，最多 4 张）。
3. 有参考图时 adapter 走 `POST /images/edits`，把文件作为 `image` 上传，并在 prompt 里写明「按附件锁定形象」。无参考图时仍走 `/images/generations` + 文字 identity lock。
4. 不把路径字符串当成已经传图。测试必须断言请求里有图片字节。
5. 人不上传则不强行先生成设定图（后做）。

## 后果

- Entities 可上传/预览参考图。
- `GET /files` 可读取 `assets/images/...`。
- gpt-image-2 不传 `input_fidelity`。
