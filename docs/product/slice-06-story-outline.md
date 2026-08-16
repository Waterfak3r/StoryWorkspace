# Slice 06：故事大纲栏 + 全本摄入 + 艺术分镜

状态：已实现。依赖 Slice 01–05。不要视频。不要 SQLite。页排版见 [slice-07](./slice-07-comics-pages.md)。

## 目标

1. 工作区「故事大纲」分区可视化整本：卷 / 章 / 场、情节、环境、实体、镜头节拍。
2. `test/resource` 两篇长文经 parse→confirm 后：场剧本覆盖原文；地点为环境实体；人物/道具/服饰为可复用实体；场用稳定 id 引用。
3. Director 每场至少 2 镜；purpose / action / camera 非空；同场机位不完全相同；camera 含景别或运动语汇。已配文本模型可走 LLM。
4. 同一故事的编译 prompt 复用项目风格与角色 visual identity。

## 非目标

- 视频、配音、页排版、实体删除、项目删除

## 磁盘

不新增大纲文件。风格默认写入 `styles/default.json`。

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/studio/projects/:projectId/outline` | `{ data: { outline } }` |

导演仍 `POST .../director`；无镜时调用 `directSceneAsync`。

## 测试

驱动真实 `test/resource/*.txt` 的 parse/confirm、outline 汇编、director、compile-prompt。
