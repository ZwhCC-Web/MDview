---
name: register-extract
description: 把手册里的寄存器表（地址、复位值、位域、读写属性、说明）转换成 ChipBench register 组件块。用于整理寄存器、生成配置值。
---

# 寄存器表 → register 块

## 步骤
1. 找到寄存器说明页，确认：寄存器名、地址（或 base + offset）、位宽、复位值、页码。
2. 把位域表整理成“位 / 名称 / R/W / 说明”的文本，每行一个位域，例如 `26 MSAREP R/W 多播源地址接收使能(P帧)`。
3. 运行 `python scripts/table_to_register.py --name MRAFC --address "<RMACAn_base> + 08CH" --reset 0x00000000 --page 4016 < fields.txt`，得到 register 块。
4. 保留字段（RSV）也要列出，标明只读。
5. 写入笔记后，在 ChipBench 里输入一个值，确认位域解析和手册一致。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
