---
name: gptp-check
description: 检查 gPTP（IEEE 802.1AS）时间同步：Sync / Follow_Up 是否成对、Sync 间隔是否稳定、Pdelay 是否有响应。用于时间同步失败、时间戳跳变排查。
---

# gPTP 同步检查

## 步骤
1. `python scripts/aenet.py pcap cap.pcapng --focus gptp`。
2. 看 Sync 平均间隔（常见 125 ms，即 logSyncInterval = −3）和最大间隔；最大值远大于平均值说明丢了同步报文。
3. 两步时钟要求 Sync 和 Follow_Up 数量一致；Pdelay_Resp 明显少于 Pdelay_Req 时，链路延迟测量会失败，从站可能无法 asCapable。
4. 芯片侧对照 U2B 手册的 IEEE 1588 / GPTMA 相关章节（见 etn-feature-matrix 的索引）检查时间戳单元配置。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
