---
name: can-bittiming
description: 根据外设时钟和目标波特率计算 CAN / CAN FD 的 BRP、TSEG1、TSEG2、SJW 和采样点，给出多组候选。用于 CAN 配置、排查采样点不一致。
---

# CAN / CAN FD 位时序

## 步骤
1. 确认外设时钟频率（看时钟树或配置工具）、仲裁段波特率、数据段波特率（CAN FD）、目标采样点（常用 80%，数据段 70–80%）。
2. 运行 `python scripts/aenet.py can --clock 80MHz --bitrate 500k --sp 80`；CAN FD 数据段再算一次，例如 `--bitrate 2M --sp 75`。
3. 按芯片寄存器范围筛选（BRP、TSEG1、TSEG2 的最大值以手册为准），优先选 Tq 数多、误差为 0 的组合。
4. 网络上所有节点的采样点应尽量一致；数据段要考虑收发器延迟补偿（TDC），在结论里提醒。

## 输出
| 段 | BRP | Tq/bit | TSEG1 | TSEG2 | SJW | 采样点 |

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
