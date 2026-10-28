# IP 图谱（1.4）

按 **IP 分功能页、每个 IP 下列多颗芯片**，每一页讲清一颗芯片上一个 IP 的结构、工作过程、寄存器、时序和代码。

## 打开方式

左侧图标栏“IP 图谱”（Ctrl+Shift+I）→ 按 IP 分组的芯片列表 → 点击打开整页视图：

| 标签 | 内容 |
|---|---|
| 概览 | 关键参数（facts，用于芯片对比）、IP 简介、本页目录 |
| 结构 | `ipblock` 结构图（ELK 自动布局），点模块看寄存器、页码，可“确认 / 有疑问” |
| 场景动画 | `scene` 场景：单步 / 播放 / ← →，高亮模块与连线、数据包沿连线移动、镜头跟随，右侧同步显示讲解、寄存器变化（按位域解码，变化字段高亮）、对应代码行、手册页码 |
| 寄存器 | 本页所有 `register` 块，可搜索寄存器或字段 |
| 时序 | `wavedrom` 时序图与公式 |
| 代码 | 初始化与典型用法 |
| 要点与坑 | 写入条件、清标志方式、常见错误 |
| 芯片对比 | 同一 IP 的所有芯片并排：facts 参数、场景数、寄存器对照，不同之处高亮 |
| 交互实验台 | 页面附带的 HTML 实验（如 RS-CANFD Lab v10.1） |

## 页面格式

一页就是一个 Markdown 文件：`<工作区主文件夹>\IP图谱\<IP>\<芯片>.md`。

```
---
type: ip-atlas
ip: CAN-FD
chip: RH850/U2B
source: 手册.pdf
chapter: Section 24 RS-CANFD
lab: RH850-U2B.lab.html        # 可选
status: 待核对                  # 草稿 / 待核对 / 已核对 / 有疑问
facts: {通道数: 8, 数据速率: "≤8 Mbps"}
---
## 概览 / ## 结构 / ## 场景 / ## 寄存器 / ## 时序 / ## 代码 / ## 要点与坑
```

### scene 场景块

````
```scene
title: 接收一帧
diagram: RS-CANFD 单元结构      # 本页 ipblock 的 title
code: 1                         # 第几个 ```c 代码块（从 0 数）
steps:
  - {t: 标题, hl: [模块id], links: [from>to], regs: [{r: RFSTS0, v: 0x108, n: 说明}], line: 4, page: 1203, x: 讲解（支持行内 Markdown）}
```
````

- `hl`：高亮的模块；`links`：高亮并播放数据包的连线（方向 from>to）。
- `regs`：这一步之后的寄存器值；如果“寄存器”里有同名 `register` 块，会按位域解码，并与前一步比较、标出变化字段。
- `line`：高亮代码行；`page`：手册页码（点击跳到 PDF）。

## 内置示例

`CAN-FD / RH850/U2B`：由 RS-CANFD Lab v10.1 整理（依据 U2B HW UM R01UH0923EJ0130 Rev.1.30 第 24 章）——13 个模块的结构图、3 个场景（接收 8 步、发送 8 步、错误与 Bus-Off 5 步）、33 个寄存器、2 个时序图、3 段代码、实验台。尚未逐项标注手册页码，状态为“待核对”。内置示例只读：“复制到工作区”后即可编辑。

## 新建页面

面板右上角 ＋，选 IP、填芯片和手册文件名，生成带全部章节和示例结构 / 场景的模板。也可以让 AI 通过 MCP 的 `build-ip-atlas` 提示词从手册生成。

## MCP 工具（7 个）与技能

| 工具 | 作用 |
|---|---|
| atlas_list | 列出全部页面（内置 + 工作区） |
| atlas_read | 读整页或某个章节 |
| atlas_create_page | 在 `IP图谱/<IP>/<芯片>.md` 建页面 |
| atlas_write_section | 替换某个章节；页面状态变为“待核对” |
| atlas_add_scene | 追加场景并立即校验 |
| atlas_validate | 校验结构图连线、场景引用的模块 / 连线 / 寄存器 / 代码行、缺页码 |
| atlas_compare | 同一 IP 各芯片的参数对比 |

技能 `ip-atlas-author` 规定了从手册建页的步骤和写法；提示词模板 `build-ip-atlas`（IP、芯片、手册）一步启动。

## 开源参考

布局用 elkjs（EPL-2.0，已打包）；交互参考 d3-hwschematic（层次组件、点击展开、连线高亮）；位域图与时序参考 WaveDrom / bitfield；Arm 内核芯片可用 SVD 导入外设总览（工程工具 →“从 SVD 生成外设结构图”）。RH850 没有 SVD，内容需从硬件手册整理（AI 起草 + 人工核对）。
