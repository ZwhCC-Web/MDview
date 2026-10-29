# clocktree 块格式

```clocktree
title: 时钟树
source: manual.pdf
nodes:
  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}
  - {id: pll, label: PLL, kind: pll, in: mosc, mul: 24, div: 1, max: 480MHz, page: 1}
  - {id: cpu, label: CPU 时钟, kind: div, in: pll, div: 2, max: 240MHz, page: 1}
```

- `freq` 只写在 source 上，其余节点由 ChipBench 自动推算。
- `max` 超出时节点标红。`page` 点击可跳到 PDF 对应页。
