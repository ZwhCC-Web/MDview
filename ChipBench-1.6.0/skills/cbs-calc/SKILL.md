---
name: cbs-calc
description: 计算 IEEE 802.1Qav CBS 信用整形参数（idleSlope、sendSlope、hiCredit、loCredit），用于 AVB / 音视频流的带宽预留配置。
---

# CBS 参数

## 步骤
1. 确认链路速率、该流量类预留带宽（% 或 bit/s）、本类最大帧、可能干扰的最大帧。
2. `python scripts/aenet.py cbs --link 100Mbps --bw 75`，或 MCP `calc_cbs`。
3. 把结果换算成芯片寄存器需要的单位（以手册为准），在笔记里写清楚换算过程。

## 公式
- sendSlope = idleSlope − portRate
- hiCredit = maxInterferenceSize × idleSlope / portRate
- loCredit = maxFrameSize × sendSlope / portRate

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
