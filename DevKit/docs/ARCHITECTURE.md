# MDView 1.0 架构说明

## 1. 一个界面，两种外壳
- **网页版**：单个 `MDView.html`（约 1.7 MB），在 Edge / Chrome 中直接运行，无需安装、无需联网。
- **桌面版**：Tauri 2 + 系统 WebView2。前端就是同一个 HTML（`desktop/dist/index.html`），Rust 侧（`src-tauri/src/main.rs`）提供原生能力。
  前端用 `NFile` / `NDir` 两个类模拟浏览器 File System Access API，所以文件树、保存、图片、链接、待办等逻辑两种外壳共用。

## 2. 编辑内核：CodeMirror 6
- 来源：CodeMirror 6 的预编译 ES 模块（`src/vendor/cm/`，取自 NiceGUI 发布包中的 rollup 产物，MIT）。只打包核心 + Markdown(GFM) + 约 30 种代码语言。
- 加载：模块以 JSON 内嵌在 HTML 中，运行时生成 Blob URL，并插入 import map（`cm/xxx.js → blob:`），再 `import()`。无需构建工具，离线可用。
- 使用位置：
  - **源码 / 分屏模式**：整篇文档一个 CodeMirror 编辑器（视口虚拟化、增量语法解析、多光标、矩形选择、撤销历史）。
  - **实时预览模式**：单击某个块时，在该块位置创建一个小 CodeMirror 编辑器；离开时写回源文本并重新渲染该块。
- `CMEd` 是 CodeMirror 的“类 textarea 外观”（value / selectionStart / setSelectionRange / insertText…），所以列表续写、表格 Tab、`/` 菜单、`[[` 补全、富文本粘贴、浮动工具栏、AI 替换等逻辑对 CodeMirror 与降级文本框通用。CodeMirror 加载失败时自动降级为原生文本框。
- 源码模式下 `S.src` 是惰性属性：打字时只标记“过期”，需要时才从 CodeMirror 取全文，避免每个按键复制百万字符。

## 3. 实时预览渲染
| 层 | 做法 |
|---|---|
| 解析 | `parseAt()` 逐块解析；`render(src,{prev})` 比较新旧行的公共前后缀，只重新分块变化区域，其余块平移复用 |
| 渲染 | 每块按“类型 + 源码”缓存 HTML；标题内联渲染与 slug 缓存；上下文相关块（脚注、引用式链接）不走缓存 |
| DOM | 与现有 DOM 做前后缀比对，只替换变化部分；块分组（每组 40 块）+ `content-visibility:auto`，屏幕外内容不排版 |
| 懒加载 | 图片、Mermaid、WaveDrom、截止日期标记在进入视口附近（IntersectionObserver）时才处理 |
| 隔离 | 编辑区、侧栏、AI 面板使用 `contain:strict`，打字不会引起整页重排 |

## 4. 图片
- 解析时本地图片输出 1×1 占位图 + `data-src`，避免浏览器请求错误路径和出现破图标。
- 支持：相对路径、带空格（`<a b.png>`、`a%20b.png`）、`..\` 反斜杠、Windows 绝对路径、`file:///`。桌面版直接按文档所在目录读取；网页版需要文件夹权限——文档引用本地图片时顶部会出现“授权文件夹”提示条。
- 找不到的图片显示提示框（路径 + 原因）；图片文件在磁盘上变化时（桌面版文件监听）自动刷新。
- 导出 HTML（内嵌）/ Word / PowerPoint / 邮件时，图片会读取原文件嵌入；SVG（流程图、时序图）自动转 PNG。

## 5. 导出（全部内置，无需 Pandoc / Office）
- **Word .docx**：渲染后的 DOM → WordprocessingML（标题样式、列表编号、表格、代码块、引用、图片、超链接、目录域）。
- **PowerPoint .pptx**：`---` 分页 → 16:9 幻灯片；首页标题页；正文要点、表格、代码框、图片自动排版；`<!-- notes: … -->` 写入演讲者备注。
- **Outlook 邮件草稿 .eml**：内联样式 HTML + cid 内嵌图片 + `X-Unsent: 1`，双击即在 Outlook 打开为新邮件；“复制为邮件格式”把同样的 HTML 放到剪贴板。
- ZIP 打包用内置的最小 ZIP 写入器（存储模式 + CRC32）。

## 6. AI 与 MCP
- **AI 助手**：OpenAI 兼容接口 / Azure OpenAI / Ollama，流式输出（SSE）。桌面版通过 `tauri-plugin-http` 请求，不受浏览器跨域限制。结果可“替换原文 / 插入 / 对比 / 新建文档”；替换前校验原文未变化。
- **MCP 服务**：`desktop/mcp/mdview_mcp.py`（标准库，stdio JSON-RPC 2.0），11 个工具；路径限定在 `--root` 内，写入前备份并保持原编码。
  桌面版把当前文档与选中文字写到 `~/.mdview/state.json`，供 `get_active_document` 读取；MCP 修改文件后，桌面版的文件监听会自动重新载入。

## 7. 代码结构（web/src）
| 文件 | 内容 |
|---|---|
| parser.js | Markdown 解析与渲染（分块、增量、缓存） |
| app1-core.js | 原生桥、状态、工具函数、渲染库加载、CodeMirror 内核与 CMEd、实时渲染、图片、标签页与会话 |
| app2-edit.js | 块编辑、快捷键、浮动工具栏、`/` `[[` `:` 补全、表格工具、富文本粘贴、点击处理、灯箱 |
| app3-files.js | 源码模式、模式切换与位置同步、大纲、状态栏、文件 / 文件夹、快速打开与计算器、全局搜索、拖放、HTML/PDF 导出 |
| app4-features.js | 查找替换、双链 / 反向链接 / 图谱、历史版本、幻灯片、文档检查、主题、偏好、菜单与快捷键、初始化 |
| app5-pro.js | 待办汇总、模板与日志、AI 助手、MCP 对话框、ZIP、邮件 / Word / PowerPoint 导出 |
