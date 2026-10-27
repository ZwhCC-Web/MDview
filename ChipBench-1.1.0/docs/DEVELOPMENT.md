# ChipBench 开发说明

> 版本 1.1.0 · 面向要修改、扩展或打包 ChipBench 的开发者。

## 1. 技术栈与目录

- **外壳**：Tauri 2 + WebView2（Rust）。前端是 `app/` 下的纯 HTML / JS / CSS，**无需 Node 构建**。
- **编辑器内核**：CodeMirror 6（离线打包在 `app/lib/`）。离线库：PDF.js、Mermaid、MathJax（SVG）、Prism、Office 读写库。

```
app/            前端：index.html、js/、css/、lib/
  js/           基础模块 … extras.js → net.js → skills.js → boot.js → 增强模块（必须在 boot.js 之后）
  css/          chipbench.css（单一样式表）· fonts/
src-tauri/      Rust 外壳（main.rs）、capabilities、tauri.conf.json
mcp/            MCP 服务（chipbench_mcp.py）+ aenet.py（以太网 / 时序计算）
skills/         内置 Agent Skills
tests/          逻辑、MCP、端到端（t_*.py）与性能测试；tests/s31/ 是 PPT / HTML 查看器的夹具
docs/           本目录（运行 tools/embed-docs.py 嵌入应用）
tools/          embed-docs.py · sync-skills.py
```

脚本按 `index.html` 里的顺序加载，**后加载的可以覆盖先加载的**。增强模块只通过公开接口（`SL.*`）扩展。1.1 计划把它们并入基础模块的正式扩展点（见 ROADMAP）。全局对象是 `window.ChipBench`（代码里简写为 `SL`）；增强模块的命名空间仍为 `SL.s31`，以保持兼容。

## 2. 增强模块依赖的基础接口

| 接口 | 用途 |
| --- | --- |
| `SL.app.ed`（`from/to/head`、`slice`、`replace`、`insert`、`select`、`lineAt`、`line`、`treeNodeAt`、`focus`、`cm`/`view`） | 格式工具栏 |
| `SL.E.tools`（`wrap`、`linePrefix`、`link`、`insertAt`、`SNIP`） | 格式工具栏 |
| `SL.viewers.open`、`t.view`、`t.el`、`t.path`、`t.name`、`SL.viewers.pdfFromBytes` | 查看器路由、PPT 高保真 |
| `SL.fs.read / readBytes / mtime / kind`、`SL.store.get / set`、`SL.invoke`、`SL.X.resolveRel / hash / readPptx / tableToMd`、`SL.U.h / dir / pkey` | PPT、HTML 查看器 |
| `SL.lib('mermaid', loader)` | Mermaid 主题补丁 |
| `SL.registerPanel` 的面板 DOM：`#pane-learn .side-b`、`#pane-tools .side-b`；处理器 `data-c / data-p / data-k` | 学习中心、工程工具 |
| `SL.cmd`、`SL.openFull / SL.modal`、`SL.md.render`、`SL.icon`、`SL.on` | 帮助中心 |

名称不符时，增强模块会在控制台打印 `[s31]` 警告并退回基础行为；开发者应先查看这些警告。

## 3. 模块一览（1.0 新增与更名；1.1 新增 workbench.js）

| 文件 | 内容 |
| --- | --- |
| `js/workbench.js`（1.1） | 窗口自适应与打字机模式、右侧“上下文”和“AI 记录”面板、PDF 摘录、内置 AI 工具调用（`SL.wb.tools` / `SL.wb.runTool` / `SL.ai.agent`）、SVD 导入、索引持久化。只使用公开的 `SL.*` 接口 |
| `css/chipbench.css` | 排版、界面抛光、格式工具栏、PPT / HTML 查看器、学习中心与工程工具面板、帮助页 |
| `css/fonts/` | Source Sans 与 Noto Sans SC 子集（SIL OFL 1.1） |
| `js/net-logic.js` | 纯逻辑：PCAP / PCAPNG 读取与协议解码、抓包分析、TAS 门控检查、CBS、CAN 位时序、WaveDrom 子集。Node 测试：`tests/net.test.js` |
| `js/net.js` | 抓包查看器、```gcl 与 ```wavedrom 组件、CBS 对话框、以太网命令 |
| `js/skills.js` | 技能库：扫描内置与工作区技能、安装、新建 |
| `js/integration.js`（原 s31-core） | 版本信息；把 `.pptx` / `.html` 路由到新查看器（失败自动回退）；Mermaid 主题补丁 |
| `js/format-toolbar.js` | 格式工具栏（`#fmtrow`，位于 `#crumbs` 之后） |
| `js/viewer-pptx.js` | PPTX 渲染器：自带 ZIP 读取、主题 / 母版 / 版式继承、形状、图片、表格、图表、备注 |
| `js/viewer-html.js` | 本地 HTML 查看器：资源内联、沙箱 iframe、localStorage 垫片、独立窗口 |
| `js/panels-pro.js` | 学习中心与工程工具面板 |
| `js/help.js` + `js/docs-data.js` | 帮助中心；文档由 `tools/embed-docs.py` 生成 |

安全：本地 HTML 在无 `allow-same-origin` 的沙箱 iframe 中运行（不可访问 ChipBench 与 Tauri 桥）；需要真实来源的页面走独立 WebView2 窗口。

## 4. 构建与发布

```
build-windows.bat            # 需要 Rust(MSVC)、VS Build Tools、Node.js 18+
# 或推到 GitHub 私有仓库 → Actions
```

发布前：版本号一致（1.0.0：`package.json`、`Cargo.toml`、`tauri.conf.json`、`core.js`、`integration.js`、`chipbench_mcp.py`）→ 运行 `tools/sync-skills.py`→ 运行 `tools/embed-docs.py` → 测试通过 → **在 Windows 真机验证**（启动、打开 PDF / PPT / HTML、保存、Office 转换、独立窗口）→ 更新 `docs/CHANGELOG.md`。

## 5. 测试

1.1 新增 `python tests/t_v11.py`（39 项：布局三档、上下文、摘录、节点编辑、AI 工具调用 / 确认 / 撤销 / 拒绝、凭据、SVD、索引缓存）。AI 用模拟的 OpenAI 兼容服务测试。

`python tests/s31/run_all.py`（需要 playwright + chromium、python-pptx、Pillow、numpy；LibreOffice 与 PyMuPDF 可选，用于 PPT 视觉对照）。测试在无头 Chromium 的“替身”页面里运行，不是真实的 Tauri 应用；Rust 不在覆盖内。

## 6. 排版与字体

- 正文：`"ChipBench Sans" → "ChipBench Han" → Segoe UI Variable Text → Microsoft YaHei UI → PingFang SC …`；`unicode-range` 让拉丁与中文各取各的字体。
- 代码：`Cascadia Code → Cascadia Mono → JetBrains Mono → Consolas → …`，**关闭连字**。
- 公式：MathJax SVG；行内公式对齐基线，块级公式居中并可横向滚动。
- 1.1：中文字体只带常用字子集（GB2312 一级 + 标点 + 假名，每个字重约 1 MB）；子集里没有的生僻字按字体栈回退到 Microsoft YaHei UI。
- 字号用 `--fs-xs/sm/md/lg/xl/2xl`，间距用 `--sp-*`（4 px 网格），新代码不要再写死像素值。
- 替换字体：改 `chipbench.css` 顶部的 `--doc`、`--mono`，字体文件放 `app/css/fonts/` 并更新 `@font-face`。

## 7. 排错

| 现象 | 处理 |
| --- | --- |
| 控制台 `[s31] … not ready` | `index.html` 里 `s31-*` 必须在 `boot.js` 之后 |
| 网页仍只显示文字 | 确认 `viewer-html.js` 已加载；`tauri.conf.json` 的 CSP 不能禁止 `frame-src` 与内联脚本 |
| 独立窗口打不开 | 需要 3.1 的 Rust 改动（`open_web` 允许 `file`） |
| PPT 只显示基础视图 | 查看控制台 `[s31]` / `[pptx]` 警告；点“高保真” |
| 字体回到系统默认 | 检查 `app/css/fonts/*.woff2` 是否在安装包中 |

## 扩展：新增一种组件块
1. 在 `editor.js` 和 `md.js` 的 `WIDGETS` 集合里加上语言名。
2. 在任意模块里注册渲染函数：`SL.widgets.PARSE['名称'] = (src, ctx) => element`（参考 `net.js` 的 gcl）。
3. 需要插入模板时，往 `SL.E.tools.SNIP` 加一段，并在 `panels-pro.js` 的 `TOOLS` 里加入口（`local: '名称'`）。
4. 让 AI 也能读写：在 `chipbench_mcp.py` 的 `COMP_RE` 里加上语言名。

## 扩展：新增内置技能
在 `skills/<名称>/SKILL.md` 写好说明；需要以太网或时序计算时放一份 `scripts/aenet.py`，然后运行 `python tools/sync-skills.py`。

## 扩展：给内置 AI 新增一个工具

在 `workbench.js` 的 `WB.tools` 数组里加一项：`{ name, description, parameters (JSON Schema), write?: true, run: async args => … }`。
写入类工具必须先调用 `confirmWrite(path, before, after, 说明)`，再用 `WB.writeNote` 写入，并调用 `LOG.add({ tool, path, write: true, before })`，这样“AI 记录”里才能撤销。
同一能力最好同时加到 `mcp/chipbench_mcp.py` 的 `TOOLS`，保证内置助手和外部 AI 行为一致。
