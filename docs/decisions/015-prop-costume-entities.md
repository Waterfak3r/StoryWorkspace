# ADR 015：道具与服饰一等实体

## 背景

Slice 01 磁盘树已有 `entities/props/`，但 `entityKindSchema` 与 `entityKindDir` 只识别 `character` / `location`。非角色实体会落到 `locations/`，场景也只有 `props[]` 而没有可复用服饰链接。用户需要可复用的道具与服饰实体：解析可抽出、确认可写入、场景可挂接、Context 在被引用时纳入。

## 决策

1. MVP 一等实体 kind 为：`character` | `location` | `prop` | `costume`。
2. 磁盘目录：`entities/characters|locations|props|costumes/`，由 `ENTITY_KIND_DIRS` 映射。
3. Scene 增加 `costumes[]`（实体 id）；缺省 JSON 解析为 `[]`。`props[]` 继续用。
4. 解析提案场景字段增加 `propNames` / `costumeNames`；确认时按 kind+name 解析为 id 链接。
5. 角色 `states.default.outfit` 仍为自由文本，**不被**场景级 costume 实体替代。
6. 组织 / Creature / 武器独立 kind 等仍不在 MVP。

## 后果

- Entities UI、Story 挂接、Overview 计数、Context 引用加载覆盖四 kind。
- 旧场景无 `costumes` 字段仍可读；新项目创建时写入 `entities/costumes/`。
- 不改变 character outfit 文本模型，场景挂接的 costume 是独立可复用实体。
- 解析时服装按 costume 实体抽取/复用，并向模型提供已有实体 name 目录（`{kind}: {name}`）；生图编译把 costume 的 `visual.base` 与 `visual.references` 以文本 reference 行写入 prompt，不向 Image adapter 做 multipart 参考图。
