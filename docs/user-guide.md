# Story Workspace 使用说明 / User Guide

界面右上角提供 `中文 / English` 切换。选择会保存在当前浏览器中，刷新或重新打开项目后仍然生效。语言切换只影响系统界面、日期和数字格式，不会翻译或改写作品内容。

Use the `中文 / English` control in the upper-right corner to switch languages. The choice is saved in the current browser and survives refreshes. It changes system copy, dates, and number formatting only; story content is never translated or rewritten.

## 中文节点图

```mermaid
flowchart TD
    A["启动应用"] --> B["项目库"]
    B --> C{"新建或打开项目"}
    C --> D["故事圣经<br/>人物、世界、地点、规则、主题"]
    D --> E["大纲<br/>故事、幕、章节、场景"]
    E --> F["章节<br/>Markdown 写作、自动保存、版本历史"]
    F --> G{"需要 AI 辅助？"}
    G -- "是" --> H["选择显式上下文<br/>构思、续写、改写、摘要、一致性、改编"]
    H --> I["审核 AI 草稿"]
    I --> J{"采用方式"}
    J --> K["插入或替换章节正文"]
    J --> L["保存为剧本改编"]
    G -- "否" --> M["继续人工写作"]
    K --> N["Markdown 导出预览"]
    L --> N
    M --> N
    N --> O["下载项目 Markdown"]

    C --> P["剧本工作区"]
    P --> Q["新建剧本文档并添加场景"]
    Q --> R["保存不可变修订版"]
    R --> S["运行场景分析并审核实体关联"]
    S --> T["审核正典补丁与临时场景状态"]
    T --> U["构建可检查的上下文快照"]
    U --> V["创建并批准分镜与镜头规格"]
    V --> W["编译本地模拟视频请求"]
    W --> X["运行可重试的本地模拟生成"]
```

## English node graph

```mermaid
flowchart TD
    A["Start the app"] --> B["Project library"]
    B --> C{"Create or open a project"}
    C --> D["Story Bible<br/>characters, world, locations, rules, themes"]
    D --> E["Outline<br/>story, acts, chapters, scenes"]
    E --> F["Chapters<br/>Markdown writing, autosave, version history"]
    F --> G{"Need AI assistance?"}
    G -- "Yes" --> H["Select explicit context<br/>brainstorm, continue, rewrite, summarize, consistency, adapt"]
    H --> I["Review the AI draft"]
    I --> J{"Choose how to apply it"}
    J --> K["Insert into or replace chapter prose"]
    J --> L["Save as a screenplay adaptation"]
    G -- "No" --> M["Continue writing manually"]
    K --> N["Preview the Markdown export"]
    L --> N
    M --> N
    N --> O["Download project Markdown"]

    C --> P["Scripts workspace"]
    P --> Q["Create a script document and add scenes"]
    Q --> R["Save an immutable revision"]
    R --> S["Run scene analysis and review entity links"]
    S --> T["Review Canon patches and temporary Scene State"]
    T --> U["Build an inspectable Context Snapshot"]
    U --> V["Create and approve a Storyboard and ShotSpecs"]
    V --> W["Compile a local Fake Video request"]
    W --> X["Run the retry-safe local Fake generation"]
```

## 开始使用 / Getting started

```powershell
npm ci
.\start-local.ps1
```

浏览器打开 `http://localhost:3000`。如需实时 AI 辅助，请在 `.env.local` 中配置 `AI_API_KEY` 和 `AI_MODEL`；未配置时，写作、保存、版本历史、剧本分析和确定性的本地模拟链路仍可使用。

Open `http://localhost:3000` in a browser. For live AI assistance, configure `AI_API_KEY` and `AI_MODEL` in `.env.local`. Writing, saving, version history, script analysis, and the deterministic local simulation flow remain available without them.

> 当前版本是本地单用户 MVP。视频链路使用本地 Fake Provider，只生成可检查记录，不上传素材、不调用真实媒体供应商，也不产生媒体文件或费用。
>
> The current release is a local single-user MVP. The video flow uses a local Fake Provider and creates inspectable records only. It does not upload assets, call a real media provider, produce a media file, or incur charges.
