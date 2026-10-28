---
name: tas-gcl-designer
description: 根据周期和各流量类的时延 / 带宽要求设计 IEEE 802.1Qbv TAS 门控列表，检查周期、Express/Preemptable 队列映射和保护带，输出 ChipBench gcl 组件块。
---

# TAS 门控列表设计

## 步骤
1. 收集需求：链路速率、周期、各流量类（控制 / 音视频 / 尽力而为）的优先级、每周期字节数、最大时延。
2. 队列映射：Express 流量放在高优先级队列（如 Q7、Q6），Preemptable 放在低优先级队列——这是 U2B 手册（Table 28.654，p.4169）的建议。
3. 草拟条目：每个条目给出 `dur` 和 8 位 `gates`（左边是 Q7）。Express 独占窗口前面要有关门的保护带；开启帧抢占时保护带可以缩短到约一个最小分片。
4. 运行检查：`python scripts/aenet.py gcl gcl.json` 或 MCP `check_gcl`，直到没有问题。
5. 写成 ```gcl 块（格式见 `references/gcl-format.md`）。ChipBench 会画出 8 个队列的时间轴，并显示每个队列的开门占比和最长等待。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
