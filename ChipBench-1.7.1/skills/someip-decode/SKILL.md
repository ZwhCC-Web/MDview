---
name: someip-decode
description: 解析抓包中的 SOME/IP 与 SOME/IP-SD：服务发现（Offer / Find / Subscribe / Ack / StopOffer）、方法调用与错误码。用于服务不可用、订阅失败排查。
---

# SOME/IP / SOME/IP-SD

## 步骤
1. `python scripts/aenet.py pcap cap.pcapng --focus someip`。
2. 检查每个服务：有没有 Offer；有 Subscribe 却没有 SubscribeAck 说明订阅被拒或没有到达；TTL=0 的是 StopOffer / StopSubscribe。
3. 方法调用看 RESPONSE / ERROR 和返回码（rc 非 0）。
4. 端口只按 SOME/IP 头部特征识别；如果项目用了非标准端口，结果仍然有效，但请在 Wireshark 里核对。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
