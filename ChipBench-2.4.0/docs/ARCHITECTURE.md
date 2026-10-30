# 架构（ChipBench 1.7）

> 1.7 的架构结论（来自评审）：**保留 Tauri + Rust + Web 前端 + Python MCP**，不推倒重做；收敛耦合、补齐运行时服务。本页开头是 1.7 的结构，其后是 1.0 起沿用的说明。

## 1.7 结构

```
┌───────────────────────── Tauri 壳（Rust，src-tauri/src）────────────────────────┐
│ util  textio  fsops  appdata  system  watch  search  pdf  logs  office  mcp  │  ← 每个文件一类职责，main.rs 只注册
└───────────────▲──────────────────────────────────────────────▲────────────────┘
                │ invoke / event                                │ <data>/state.json、mcp-activity.jsonl、mcp-session.json
┌───────────────┴────────── Web 前端（app/js，36 启动模块 + 3 按需）──────────────┐ ┌─────────────┴────────────┐
│ kernel   logic model md rt core filesafe            ← 纯逻辑与运行时服务       │ │ Python MCP 服务器         │
│ core     editor app boot …                          ← 应用壳                   │ │ mcp/chipbench_mcp.py      │
│ 工作空间 index workspace panels workbench           ← 项目 / 集合 / 引用 / 索引 │ │  · 工作区根目录随应用切换 │
│ 文档中心 viewers widgets viewer-pptx* viewer-html*  ← 多格式阅读与编辑         │ │  · 读写 / 只读、dry_run   │
│ 工程中心 ipblock atlas-model atlas                  ← IP 图谱统一知识模型      │ │  · 每次写入记录差异与备份  │
│ 自动化   skills mcp-center                          ← MCP 连接与 AI 活动       │ └───────────────────────────┘
└────────────────────────────────────────────────────────────────────────────────┘      * = 按需加载
```

- **加载顺序与依赖**只在 `app/modules.json` 里维护；`python tools/check-modules.py --write` 生成 `index.html` 的脚本列表、`js/modules-registry.js` 与 `docs/MODULES.md`；不带参数则校验。
- **运行时服务 `rt.js`**：`rt.report`（错误出口）、`rt.task`（可取消任务，同组最新者胜）、`rt.lru`（有上限缓存，内存压力时自动收缩）、`rt.perf`（P50/P95/P99、长任务、堆）、`rt.load`（模块按需加载）。新代码不要再写 `new Map()` 当缓存、`console.error` 当错误处理。
- **安全写入 `filesafe.js`**：所有用户文档的保存都经 `SL.safe.write`（冲突检测 + 滚动备份）。
- **数据流（AI 改写如何出现在界面里）**：AI 调 MCP 工具 → 服务器写文件并追加 `mcp-activity.jsonl` → 应用每 2.5 秒读取该日志 → 提示 + 调用 `app.externalChanged(paths)` 刷新已打开标签 / 项目树 / 索引（不依赖操作系统文件监听）。应用每 15 秒刷新 `state.json`，服务器据此判断应用是否在运行并跟随当前项目的根目录。
- **数据模型**：Workspace（数据目录）> Project（`.cbws`，schema v2）> Collection（分组）> ResourceRef（引用，带 `{size, mtime}` 指纹）；一个文件可被多个集合引用，文件本身不属于任何集合。
- **IP 图谱**：一页 Markdown 经 `atlas-model.js` 解析为一张图（结构 / 端口 / 连线 / 寄存器 / 位域 / 场景步骤 / 时序 / 代码），每条事实可带 `page / ev / sec / cond`；渲染、校验、影响分析、MCP 工具都读这同一个模型（`mcp/test_atlas_parity.py` 保证 Python 与 JS 两个实现一致）。
- **扩展点**：`boot.js` 之后加载的“增强模块”（`immersive / zoom-hud / docwidth / mcp-center / diagnostics / ui-states`）通过包装函数或注册命令接入；新增模块 = 写文件 + 在 `modules.json` 登记 + 运行 `check-modules.py --write`。

## 1.0 起沿用的说明

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


## 查看器生命周期（2.1.1）
查看器（`js/viewers.js` 的 `V.open` 分发的各个 `xxxView(t, root)`）如果在自身 DOM 之外挂了东西，**必须**通过作用域登记：
- `V.on(root, window|document, type, fn, opts)`：挂监听，关闭时自动摘除；
- `V.observe(root, observer)`：登记 ResizeObserver / IntersectionObserver，关闭时 `disconnect()`；
- `V.track(root, fn)`：登记任意清理函数。
`V.dispose(t)` 在关闭标签、外部修改后重新打开、“重试”、新的打开取代较慢的旧打开时统一调用：先释放作用域，再调 `t.viewer.destroy()`。`tests/t_life21.py` 用监听器 / 观察者计数验证“打开 → 关闭 N 次不增长”。
