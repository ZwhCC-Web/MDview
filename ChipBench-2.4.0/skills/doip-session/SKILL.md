---
name: doip-session
description: 还原 DoIP（ISO 13400）诊断会话：车辆识别 → 路由激活 → UDS 请求 / 响应，标出路由激活失败、否定确认和 UDS NRC。用于诊断刷写失败排查。
---

# DoIP 会话还原

## 步骤
1. `python scripts/aenet.py pcap cap.pcapng --focus doip`，报告里有按时间排列的会话时序表。
2. 按顺序检查：车辆声明 → 路由激活响应码（0x10 为成功）→ 诊断报文和确认 → UDS 正 / 负响应。
3. 遇到 NRC，查 UDS 服务和 NRC 含义（例如 0x31 requestOutOfRange、0x33 securityAccessDenied、0x78 responsePending）。
4. TCP 层的 RST、重传也会让会话中断，结合 pcap-triage 的结果一起看。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
