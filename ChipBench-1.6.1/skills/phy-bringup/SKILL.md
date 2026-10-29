---
name: phy-bringup
description: 以太网 PHY 调通检查单：电源与复位、参考时钟、xMII 模式、MDIO 读 PHY ID、自协商 / 强制速率、链路状态和环回测试。用于新板子以太网不通的排查。
---

# PHY 调通检查单

按顺序做，每一步记录结果（OK / NG / 测量值）：

1. **电源与复位**：PHY 各路电源、复位释放时序满足 PHY 数据手册。
2. **参考时钟**：25 MHz / 50 MHz 时钟频率和幅度；RMII 需要确认时钟方向（由 PHY 还是 MAC 提供）。
3. **接口模式**：MCU 侧 MII / RMII / GMII（U2B RMACA 支持 MII、GMII、RMII，见手册 Table 28.17，p.3319）与 PHY strap 一致。
4. **MDIO**：读 PHY ID 寄存器（寄存器 2、3）；读不到时检查 MDC 频率、PHY 地址 strap、上拉。
5. **链路**：读 BMSR（寄存器 1）的 Link Status；车载 100BASE-T1 / 1000BASE-T1 PHY 还要确认 Master / Slave 设置。
6. **环回**：先做 PHY 内部环回，再做 MAC 环回，用来区分 MCU 侧和线缆侧的问题。
7. **抓包**：链路起来后，用 pcap-triage 确认收发正常。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
