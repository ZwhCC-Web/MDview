# 车载以太网工具

## 抓包查看器（.pcap / .pcapng）
双击打开，或用“工程工具 → 抓包分析”。

| 区域 | 内容 |
|---|---|
| 发现的问题 | 路由激活失败、DoIP 否定确认、UDS NRC、Sync 间隔异常、Sync/Follow_Up 不成对、Pdelay 无响应、TCP RST、疑似重传、SOME/IP 订阅无 Ack。点击跳到对应帧 |
| gPTP | Sync / Follow_Up / Pdelay / Announce 计数，Sync 平均与最大间隔 |
| DoIP | 各类报文数量；诊断报文解出 UDS 服务名和 NRC |
| SOME/IP-SD | 每个服务 / 实例的 Offer、Find、Subscribe、Ack、Stop 计数 |
| VLAN | VLAN ID 与 PCP 分布 |
| 报文列表 | 时间、源、目的、协议、长度、信息；可按协议 / IP / 端口 / 文本过滤；最多显示 3000 条 |

“生成分析笔记”会把结果写成 Markdown 笔记，并记录抓包文件路径。

识别规则：gPTP 按 EtherType 0x88F7；DoIP 按端口 13400；SOME/IP 按头部特征（协议版本、消息类型、长度），因此非标准端口也能识别。需要逐字段解码时，请用 Wireshark 打开同一个文件。

## TAS 门控列表（```gcl）
```gcl
title: TAS 门控列表
link: 1Gbps
cycle: 500us
maxFrame: 1522
express: [7, 6]
preemptable: [3, 2, 1, 0]
entries:
  - {dur: 100us, gates: "11000000", note: 控制流}
  - {dur: 390us, gates: "00111111", note: 尽力而为}
  - {dur: 10us, gates: "00000000", note: 保护带}
```
渲染为 8 个队列的时间轴，并给出每个队列的开门占比、每周期开门时长、最长等待时间、每周期最多可发的整帧数。

自动检查：
- 条目总时长与周期是否一致；
- Preemptable 队列的优先级是否高于 Express 队列（U2B 手册建议 Express 用高优先级队列，Table 28.654，p.4169）；
- Express 独占窗口前是否有足够的保护带。保护带按最大帧线上时间计算，即 (帧长 + 20 B) × 8 / 速率；开启帧抢占时按最小分片计算。
- 队列每周期开门时间是否小于一个最大帧。

## CBS 计算器
802.1Qav：输入链路速率、预留带宽、最大帧，得到 idleSlope、sendSlope、hiCredit、loCredit。换算到芯片寄存器单位时请以手册为准。

## 时序图（```wavedrom）
支持 WaveDrom 信号语法的常用子集：`0 1 h l` 电平、`p n` 时钟、`x` 未知、`z` 高阻、`2–9 =` 数据（标签取自 `data`）、`.` 延续、`|` 间断。不支持寄存器图和逻辑电路图。

## 对应的 AI 能力
MCP：`analyze_capture`、`check_gcl`、`calc_cbs`、`calc_can_timing`。
技能：pcap-triage、gptp-check、doip-session、someip-decode、tas-gcl-designer、cbs-calc、etn-feature-matrix、etn-register-extract、phy-bringup。
