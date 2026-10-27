---
name: map-analysis
description: 解析 GNU ld / LLVM 风格的 .map 文件，汇总各内存区域占用和最大的输出段，并对比两次构建的差异。用于 Flash/RAM 超限、体积增长排查。
---

# .map 分析

## 步骤
1. `python scripts/map_summary.py build.map` 输出内存区域占用和最大的段。
2. 对比两次构建：`python scripts/map_summary.py new.map --base old.map`，列出变化最大的段。
3. 结合 ChipBench 的 .map 查看器（构建大小对比）定位到目标文件。
4. CC-RH / GHS 等编译器的 map 格式不同，脚本解析不到时，改用 ChipBench 的 .map 查看器，并说明这一点。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
