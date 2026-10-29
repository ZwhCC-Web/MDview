# RH850/U2B Ethernet TSN（ETN）要点索引

来源：RH850/U2B User's Manual: Hardware, R01UH0923EJ0130 Rev.1.30，Section 28。页码是手册页码；用前请对照原文核实。

| 主题 | 位置 | 要点 |
|---|---|---|
| 单元数量 | 28.1.1，Table 28.1（约 p.3291） | U2B20/U2B10/U2B6 为 TSNES（U2B20 两个单元，其余一个）；U2B24 为 RSWITCH（TSNSWA，一个单元） |
| 单元 / 子单元索引 | Table 28.2（p.3292） | GPTMA、AXIBMI、RMACS、RMACA、SGMII、PWRCTL 等子单元按型号与封装不同 |
| MAC 系统 RMACS | 28.2.1.8，Table 28.16（p.3318） | RX 过滤、子目的地选择、E/P 帧与 TAS 直通（cut-through）、统计计数器 |
| MAC RMACA | 28.2.1.9，Table 28.17（p.3319） | 802.3x 流控、802.3br 帧抢占、IEEE 1588、10/100/1000/2500 Mbps、仅全双工、EEE、MII/GMII/RMII、MDIO |
| 配置参数 | Table 28.47 / 28.48（p.3394–3395） | 过滤器数量、SID、FIFO 深度等，TSNES 与 RSWITCH 取值不同 |
| 接收地址过滤 | MRAFC，Table 28.608（p.4016） | E 帧 / P 帧各一套：单播、多播、广播接收使能，风暴计数自动清除 |
| 发送模式 | 28.x，Table 28.654（p.4169） | Queue7 优先级最高；可与 CBS、TAS 组合；Express 用高优先级队列，Preemptable 用低优先级队列 |
| 帧抢占 | p.4170 | MAC Merge 子层（eMAC + pMAC），支持 Link Verification |
