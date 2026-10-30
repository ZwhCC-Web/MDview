# 前端模块图（自动生成）

由 `tools/check-modules.py --write` 从 `app/modules.json` 生成；加载顺序即表格顺序。虚线 = 懒加载。

| # | 模块 | 层 | 依赖 | 加载 | 说明 |
|---|---|---|---|---|---|
| 1 | `logic.js` | 内核 | — | 启动 |  |
| 2 | `net-logic.js` | 内核 | — | 启动 |  |
| 3 | `model.js` | 内核 | logic | 启动 |  |
| 4 | `md.js` | 内核 | — | 启动 |  |
| 5 | `rt.js` | 内核 | — | 启动 | 运行时服务：统一错误出口、可取消任务、LRU 缓存、性能遥测、模块懒加载 |
| 6 | `motion.js` | 内核 | — | 启动 | 动画等级解析 / 帧时间看门狗 / 标签与项目树的方向键逻辑 / 入场延迟（纯逻辑，Node 可测） |
| 7 | `core.js` | 内核 | logic, rt | 启动 |  |
| 8 | `filesafe.js` | 内核 | core, rt | 启动 | 安全写入：外部修改冲突检测 + 滚动备份 + 恢复 |
| 9 | `modules-registry.js` | 内核 | rt | 启动 | 由 tools/check-modules.py --write 生成：把本清单交给 rt.modules |
| 10 | `editor.js` | 应用壳 | core, md | 启动 |  |
| 11 | `edit-tools.js` | 应用壳 | editor | 启动 |  |
| 12 | `app.js` | 应用壳 | editor, rt, filesafe | 启动 |  |
| 13 | `index.js` | 工作空间 | app, model | 启动 |  |
| 14 | `workspace.js` | 工作空间 | app, index, model | 启动 |  |
| 15 | `widgets.js` | 文档中心 | app, workspace | 启动 |  |
| 16 | `viewers.js` | 文档中心 | widgets | 启动 |  |
| 17 | `plan.js` | 工程工具 | viewers, workspace | 启动 |  |
| 18 | `learn.js` | 工程工具 | plan, viewers | 启动 |  |
| 19 | `panels.js` | 工作空间 | learn, workspace | 启动 |  |
| 20 | `tools.js` | 工程工具 | widgets, workspace | 启动 |  |
| 21 | `extras.js` | 工程工具 | viewers, workspace | 启动 |  |
| 22 | `net.js` | 工程工具 | net-logic, viewers | 启动 |  |
| 23 | `skills.js` | 自动化中心 | workspace | 启动 |  |
| 24 | `boot.js` | 应用壳 | panels, skills, net, extras, tools | 启动 | 启动：偏好 → 面板 → 工作区 → 会话恢复。其后的“增强模块”在 boot 之后加载并包装部分函数 |
| 25 | `docs-data.js` | 文档中心 | core | 按需 | 内置手册文本（≈68 KB），打开帮助中心时才加载 |
| 26 | `integration.js` | 应用壳 | viewers | 启动 |  |
| 27 | `viewer-pptx.js` | 文档中心 | integration | 按需 | PPTX 高保真查看器（≈56 KB），首次打开 .pptx 时加载 |
| 28 | `viewer-html.js` | 文档中心 | integration | 按需 | 本地 HTML 查看器（≈13 KB），首次打开 .html 时加载 |
| 29 | `format-toolbar.js` | 体验增强 | editor | 启动 |  |
| 30 | `panels-pro.js` | 工程工具 | learn, viewers | 启动 |  |
| 31 | `help.js` | 体验增强 | integration | 启动 |  |
| 32 | `workbench.js` | 工作空间 | panels, workspace, index | 启动 |  |
| 33 | `home.js` | 体验增强 | workbench | 启动 |  |
| 34 | `ip-layout.js` | 工程中心 | — | 启动 | 手动摆放的几何（纯逻辑，Node 可测）：偏移叠加在自动布局上，分组随成员变大，被移动的连线重新走线 |
| 35 | `ipblock.js` | 工程中心 | workbench, viewers, ip-layout | 启动 |  |
| 36 | `atlas-model.js` | 工程中心 | logic | 启动 | IP 图谱统一知识模型：结构/寄存器/场景/时序/代码 + 依据（页码·等级·手册版本）+ 一致性 + 影响分析（纯逻辑，Node 可测） |
| 37 | `ip-expr.js` | 工程中心 | — | 启动 | IP 行为规则的表达式语言：手写解析、无 eval、任意精度整数、无函数调用（纯逻辑，Node 可测；mcp/ip_expr.py 是它的镜像） |
| 38 | `ip-model.js` | 工程中心 | logic, ip-expr | 启动 | IP 模型（.cbip）：节点 / 端口 / 连线 / 参数 / 寄存器 / 依据；原子操作 apply、校验、子图、差异、模板实例化、从 Markdown 图谱迁移（纯逻辑，Node 可测；mcp/ip_model.py 是它的镜像） |
| 39 | `ip-sim.js` | 工程中心 | ip-model, ip-expr | 启动 | IP 行为推演引擎：把场景套在模型的规则上（电平 / 边沿规则、收敛、上限）；只执行写进模型的规则，结果一律标“推导”（纯逻辑，Node 可测；mcp/ip_sim.py 是它的镜像） |
| 40 | `ip-templates.js` | 工程中心 | ip-model | 启动 | 通用 IP 结构模板（CAN / 以太网 MAC / DMA / 定时器 / 串口）：只写结构，条目一律“示意” |
| 41 | `atlas.js` | 工程中心 | ipblock, atlas-model, home | 启动 |  |
| 42 | `ip-studio.js` | 工程中心 | ipblock, atlas, ip-model, ip-templates, filesafe | 启动 | IP Studio：.cbip 查看器（ELK 图 + 详情 / 寄存器 / 校验 / 修改 / 引用）、AI 建议的接受与拒绝、新建 / 从模板添加 / 从图谱页转换 |
| 43 | `immersive.js` | 体验增强 | workspace | 启动 | 全屏 / 专注阅读、柔和界面、打开文件容错（原 v16.js） |
| 44 | `zoom-hud.js` | 体验增强 | home, atlas | 启动 | 统一缩放 HUD + 空闲预热（原 v161.js） |
| 45 | `docwidth.js` | 体验增强 | workspace | 启动 | 文档 / 表格宽度四档、项目树跟随磁盘（原 v162.js） |
| 46 | `mcp-center.js` | 自动化中心 | filesafe, docwidth | 启动 | MCP 连接中心 + AI 改动记录（差异 / 撤销 / 自动刷新） |
| 47 | `diagnostics.js` | 体验增强 | rt, workspace, index | 启动 | 耗时探针（打开 / 切换项目 / 切换标签 / 保存 / 索引）+ 诊断与性能报告导出 |
| 48 | `ui-states.js` | 体验增强 | app | 启动 | 统一的加载 / 错误 / 空状态（重试、定位、系统程序打开、复制错误） |
| 49 | `cmd-needs.js` | 应用壳 | boot, ui-states | 启动 | 命令前提表（有标签 / 有磁盘文件 / 是 Markdown）：不满足时面板隐藏、直接触发时给出原因 |
| 50 | `ux21.js` | 体验增强 | motion, workspace, panels, atlas, ip-studio, home, plan, docwidth, mcp-center | 启动 | 动画运行时（等级 / 离场 / 自动降级）、可访问的标签列表、项目树键盘导航、可搜索的快捷键面板 |

```mermaid
graph LR
  logic --> model
  logic --> core
  rt --> core
  core --> filesafe
  rt --> filesafe
  rt --> modules_registry
  core --> editor
  md --> editor
  editor --> edit_tools
  editor --> app
  rt --> app
  filesafe --> app
  app --> index
  model --> index
  app --> workspace
  index --> workspace
  model --> workspace
  app --> widgets
  workspace --> widgets
  widgets --> viewers
  viewers --> plan
  workspace --> plan
  plan --> learn
  viewers --> learn
  learn --> panels
  workspace --> panels
  widgets --> tools
  workspace --> tools
  viewers --> extras
  workspace --> extras
  net_logic --> net
  viewers --> net
  workspace --> skills
  panels --> boot
  skills --> boot
  net --> boot
  extras --> boot
  tools --> boot
  core -.-> docs_data
  viewers --> integration
  integration -.-> viewer_pptx
  integration -.-> viewer_html
  editor --> format_toolbar
  learn --> panels_pro
  viewers --> panels_pro
  integration --> help
  panels --> workbench
  workspace --> workbench
  index --> workbench
  workbench --> home
  workbench --> ipblock
  viewers --> ipblock
  ip_layout --> ipblock
  logic --> atlas_model
  logic --> ip_model
  ip_expr --> ip_model
  ip_model --> ip_sim
  ip_expr --> ip_sim
  ip_model --> ip_templates
  ipblock --> atlas
  atlas_model --> atlas
  home --> atlas
  ipblock --> ip_studio
  atlas --> ip_studio
  ip_model --> ip_studio
  ip_templates --> ip_studio
  filesafe --> ip_studio
  workspace --> immersive
  home --> zoom_hud
  atlas --> zoom_hud
  workspace --> docwidth
  filesafe --> mcp_center
  docwidth --> mcp_center
  rt --> diagnostics
  workspace --> diagnostics
  index --> diagnostics
  app --> ui_states
  boot --> cmd_needs
  ui_states --> cmd_needs
  motion --> ux21
  workspace --> ux21
  panels --> ux21
  atlas --> ux21
  ip_studio --> ux21
  home --> ux21
  plan --> ux21
  docwidth --> ux21
  mcp_center --> ux21
```
