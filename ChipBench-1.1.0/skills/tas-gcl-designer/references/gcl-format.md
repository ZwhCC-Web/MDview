# gcl 块格式

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

- `gates` 也可以写成队列列表：`gates: [7, 6]`。
- 最大帧线上时间 = (帧长 + 8 B 前导 + 12 B 帧间隔) × 8 / 链路速率。
