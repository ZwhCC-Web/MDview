# 架构（ChipBench 1.0）

- **外壳**：Tauri 2 + WebView2。前端是 `app/` 里的静态文件，无需 Node 构建；`withGlobalTauri` 使前端直接调用 Rust 命令。
- **前端模块**（按加载顺序）：`logic.js`（纯逻辑：YAML、单位、时钟树、寄存器、.map / HEX / ELF、Office / 邮件解析、规划、SM-2…）→ `model.js`（工作区数据模型）→ `md.js`（Markdown 解析渲染）→ `core.js`（命令、菜单、模态、存储、与 Rust 的桥）→ `editor.js`（CodeMirror 6 装饰与键位）→ `edit-tools.js` → `app.js`（标签页、模式、状态栏）→ `index.js`（增量索引与搜索）→ `workspace.js` → `widgets.js`（图表 / 寄存器 / 内存 / 引脚组件）→ `viewers.js`（PDF / 表格 / 固件 / .map / 日志）→ `plan.js` → `learn.js` → `panels.js` → `tools.js`（AI、MCP、导出）→ `extras.js`（白板、Git、工程工具）→ `net.js`（抓包查看器、gcl / wavedrom 组件、CBS）→ `skills.js`（技能库）→ `boot.js` → 增强模块（`docs-data`、`integration`、`viewer-pptx`、`viewer-html`、`format-toolbar`、`panels-pro`、`help`）。`net-logic.js` 紧跟 `logic.js` 加载，是纯逻辑，可在 Node 中测试。
- **Rust 命令（37 个）**：文件读写（编码识别、原子保存）、目录与监听、`scan_dir / read_many / search_dir`（索引与搜索）、`pdf_text`（缓存）、`log_index / log_lines / log_grep`（GB 级日志）、`office_to_pdf`、`git_cmd`、`open_web`、全局快捷键、`set_state`（MCP 状态桥）等。
- **数据位置**：`%USERPROFILE%\.chipbench\`（工作区 `.cbws`、键值存储、缓存、`state.json`）；文档与图片留在原处。首次启动会把旧的 `.silica` 目录改名为 `.chipbench`。
- **MCP 与技能**：`mcp/chipbench_mcp.py`（46 个工具、6 个提示词模板、资源）调用同目录的 `aenet.py`（与 `net-logic.js` 同一套算法）；`skills/` 随安装包分发，`tools/sync-skills.py` 负责把 `aenet.py` 同步进技能。
- **测试策略**：`tests/mock_tauri.js` 在浏览器里模拟 Rust 命令（虚拟磁盘、事件），所以前端的全部桌面路径都能自动化测试；Rust 本身没有被这些测试覆盖。

```
- ```mermaid
graph LR
  A[开始] --> B{判断}
  B -->|是| C[执行]
  B -->|否| D[结束]
```
