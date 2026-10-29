---
name: ip-atlas-author
description: Build or extend a ChipBench IP atlas page (IP 图谱) for one IP on one Renesas chip from its hardware manual — structure diagram, step-by-step scenes, registers, timing and code, every fact with a manual page. Use when the user asks to explain or document an MCU peripheral (CAN-FD, Ethernet, DMA, clock, interrupt, ADC, timer …) for a specific chip.
---
# IP 图谱页面编写

一页 = 一个 IP × 一颗芯片，文件 `IP图谱/<IP>/<芯片>.md`，front matter `type: ip-atlas`。ChipBench 把 `## 概览 / 结构 / 场景 / 寄存器 / 时序 / 代码 / 要点与坑` 显示为标签页，`scene` 块显示为可单步 / 播放的动画。

## 步骤

1. `atlas_list` 看是否已有同 IP 的页面（尤其内置示例 `CAN-FD/RH850/U2B`，可作为写法参考：`atlas_read`）。
2. `atlas_create_page(ip, chip, source, chapter, facts)`。facts 的参数名尽量与同 IP 的其他芯片一致（芯片对比按参数名对齐）。
3. 读手册：`search_pdf` 定位章节 → `read_pdf_pages` 逐段读（每次 ≤ 20 页）。只写手册里有的内容；不确定的写“待确认”。
4. 用 `atlas_write_section` 依次写：
   - **概览**：IP 的作用、组成、收发 / 处理主线（3–5 条），引用页码 `（p.N）`。
   - **结构**：一个 ```ipblock。blocks 用手册框图里的模块名，`kind` 取 cpu/bus/mem/dma/periph/logic/io/clock/irq/ext/analog，每个模块写 `page`，相关寄存器写 `regs`；links 的 `kind` 取 bus/data/clock/irq/dma/ctrl。
   - **寄存器**：每个关键寄存器一个 ```register（name、address、width、fields: {name, bits: "hi:lo", desc, values}）。寄存器名要与 ipblock 的 `regs` 和 scene 的 `regs.r` 完全一致。
   - **时序**：位时间 / 帧 / 握手等，用 ```wavedrom（WaveJSON），并写出计算公式。
   - **代码**：初始化顺序与典型用法，用 ```c；行号会被 scene 的 `line` 引用。
   - **要点与坑**：写入条件（哪些模式下可写）、清标志方式、常见配置错误。
5. `atlas_add_scene` 添加 2–3 个场景（如接收、发送、错误 / 中断）。每步：
   `{t: 标题, hl: [模块 id], links: [from>to], regs: [{r: 名称, v: 0x值, n: 字段说明}], line: 代码行, page: 手册页, x: 讲解}`
   一步只讲一件事；寄存器值写这一步之后的值。
6. `atlas_validate` 直到没有 ERR；WARN 逐条处理或在回复里说明。
7. 回复用户：列出新建 / 修改的内容和仍待确认的地方。AI 写入后页面状态为“待核对”，由人在 ChipBench 里核对。
