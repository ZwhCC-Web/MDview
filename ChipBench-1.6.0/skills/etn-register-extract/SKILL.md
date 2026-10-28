---
name: etn-register-extract
description: 把 U2B 以太网（RMACA / RMACS / GPTMA 等）寄存器表转成 register 组件块，并标出 E 帧 / P 帧两套位。用于以太网驱动配置和问题排查。
---

# ETN 寄存器提取

## 步骤
1. 参考 `references/u2b-etn-index.md` 定位寄存器所在页（如 MRAFC 在 p.4016）。
2. 地址写成 `<RMACAn_base> + 偏移` 的形式，不要猜绝对地址；基地址从地址映射章节查。
3. 位域里带 P / E 后缀的（如 MSAREP / MSAREE）分别对应 Preemptable / Express 帧，说明里要写清楚。
4. 用 register-extract 技能的脚本生成 register 块（本技能自带一份）。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
