---
name: etn-feature-matrix
description: 从 RH850/U2B 手册 Section 28 整理以太网 TSN 功能矩阵：各型号 / 封装的 ETN 单元、速率、接口、TSN 特性，并附页码。用于回答“某型号有几路以太网、支持哪些 TSN 功能”。
---

# ETN 功能矩阵

## 步骤
1. 先读 `references/u2b-etn-index.md`，它给出了关键表格所在页码。
2. 用 `search_notes` / `read_file` 打开对应手册分卷，逐项核对：型号 × 封装 × 单元（TSNES / RSWITCH）× 子单元（RMACA、SGMII…）。
3. 输出矩阵表；每个单元格的数据都要能追溯到 Table 号 + 页码。
4. 客户问到的型号如果是 RSWITCH（交换机）版本，要单独说明它和 TSNES（端点）的差异。

## 输出模板
| 型号 / 封装 | ETN 实现 | 单元数 | MAC 端口 | 速率 | 接口 | 出处 |
|---|---|---|---|---|---|---|

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
