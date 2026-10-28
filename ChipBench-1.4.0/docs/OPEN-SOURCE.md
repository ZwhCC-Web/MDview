# MCU / IP 结构图：开源方案调研与集成（1.3）

目标：在 ChipBench 里画出常见 MCU 及其 IP（CAN、Ethernet、DMA、时钟、中断……）的结构框图，数据可由人和 AI 共同编辑、可核对手册页码。

## 结论

**已集成：elkjs**（Eclipse Layout Kernel 的 JavaScript 版，EPL-2.0）。它解决的是这类图最难的部分——**自动布局**：分层排布、正交走线、层次嵌套（模块放在子系统框里，连线可跨框）。ChipBench 1.3 的新组件 `ipblock` 就建立在它之上；数据仍是笔记里的 YAML，渲染与交互由 ChipBench 自己完成。

其余方案按“能否直接集成”分为三类，见下表。

## 方案对比

| 方案 | 做什么 | 许可 | 与 ChipBench 的关系 |
|---|---|---|---|
| **elkjs** | 图自动布局引擎：layered 分层、正交走线、端口、层次图 | EPL-2.0 | **已集成**（`app/lib/elk/elk-worker.js`，Web Worker 中运行） |
| **d3-hwschematic** | 基于 D3 + ELK 的硬件原理图查看器：层次组件可点击展开、连线高亮、缩放拖动；输入是带 `hwMeta` 的 ELK JSON | EPL | **思路已借鉴**：层次分组、点选高亮相关连线。未直接打包（依赖 D3，且面向 RTL 网表） |
| **netlistsvg** | 由 Yosys JSON 网表画 SVG 原理图，内部用 elkjs，支持“皮肤”自定义符号 | MIT | 适合 FPGA / RTL 网表；MCU 手册级框图用不上它的门级符号 |
| **Symbolator** | 解析 VHDL / Verilog 组件声明，生成带分组端口的模块符号图 | MIT | 适合“单个 IP 的端口视图”；Python + Cairo，可作为外部工具 |
| **SystemRDL + PeakRDL** | 寄存器描述语言与工具链：生成 C 头、HTML 文档、导入导出 IP-XACT | LGPL-3.0（生成物不受限） | **外部调用**：PeakRDL 生成的 C 头 / IP-XACT 再导入 ChipBench |
| **IP-XACT（IEEE 1685）+ Kactus2** | 描述组件、总线接口、地址空间、寄存器的 XML 标准；Kactus2 是图形化工具 | Kactus2：GPL-2.0 | **规划导入器**（1.4）：IP-XACT → `ipblock` + `register`；不嵌入 Kactus2 代码 |
| **CMSIS-SVD** | Arm 内核芯片的外设 / 寄存器描述（含 `groupName`、基地址、中断） | 文件格式 | **已集成导入**：SVD → 外设总览 `ipblock`（RA、RZ 等 Arm 内核芯片） |
| **Linux 时钟框架 `clk_summary`** | 运行时时钟树（父子、频率、使能计数） | — | 规划导入器（1.4）：RZ/G、RZ/V 等跑 Linux 的芯片 → `clocktree` |
| xyflow（React Flow） | 节点编辑器：拖拽、连线、缩放 | MIT | 1.4 拖拽编辑的交互参考（ChipBench 不用 React，只借鉴交互） |

## 为什么不直接用 d3-hwschematic / netlistsvg

- 它们面向 **RTL 网表**（门、寄存器、端口位宽），而 AE 读手册时画的是**功能框图**：子系统、总线、时钟 / 中断 / DMA 关系、页码出处。
- ChipBench 需要“人写 YAML、AI 改 YAML、图自动更新、逐个模块核对”，这要求数据格式与渲染都在自己手里；ELK 只负责算坐标，正好分层。

## 对 RH850 的说明

RH850（U2A / U2B 等）不是 Arm 内核，Renesas 不提供 CMSIS-SVD。可行做法：

1. 手写或让 AI 根据手册章节生成 `ipblock` YAML（MCP 工具 `search_pdf` + `read_pdf_pages` 读原文，`update_component` 写入，节点自动标“待核对”）。
2. 从 MCAL / 驱动头文件提取寄存器（ChipBench 已支持从 C 头文件解析寄存器）。
3. 每个模块带 `page`，在 ChipBench 里逐个核对后点“确认”。

## 已知局限（1.3）

- 连线连到模块整体，还没有“端口”（如 TX / RX / IRQ 引脚）级别的连接点；计划 1.4 增加 `ports`。
- 还不能拖拽编辑，改结构请改 YAML（或用 AI）。
- 现有 `structure` / `clocktree` 组件仍用旧布局，1.4 统一改用 ELK。

## 许可注意

- elkjs（EPL-2.0）随 ChipBench 分发：保留 `app/lib/elk/LICENSE-EPL-2.0.txt`，并在 `app/lib/LICENSES.md` 中注明来源与版本。EPL-2.0 是弱著作权许可，只要求对 elkjs 本身的修改开源，不影响 ChipBench 其余代码。
- LGPL / GPL 工具（PeakRDL、Kactus2、Symbolator 的部分依赖）建议作为**独立外部程序**调用，不并入 ChipBench；公司内部分发前请与法务确认。
