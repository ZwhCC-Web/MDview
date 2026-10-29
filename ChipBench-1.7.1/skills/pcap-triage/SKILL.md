---
name: pcap-triage
description: 分析 .pcap / .pcapng 抓包：协议分布、主要通信对、VLAN/PCP、gPTP、DoIP、SOME/IP-SD，以及 TCP RST / 重传等异常，生成 Markdown 报告。用于车载以太网问题的第一轮排查。
---

# 抓包初筛

## 步骤
1. `python scripts/aenet.py pcap capture.pcapng`（或 MCP `analyze_capture`）。只用 Python 标准库，不需要安装 Wireshark。
2. 先看“发现的问题”，再看协议分布：有没有预期之外的协议、VLAN 优先级是否正确。
3. 针对具体协议，继续用 gptp-check / doip-session / someip-decode 技能。
4. 需要逐字段解码时，用 Wireshark / tshark 打开同一个文件，并在结论里写上帧号。

## 输出
- 报告 + 3 条以内的根因候选（按可能性排序，每条附帧号）+ 下一步测量建议。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
