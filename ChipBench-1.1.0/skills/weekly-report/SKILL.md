---
name: weekly-report
description: 汇总工作区的任务和笔记变化，按 Done / In progress / Blocked / Next week 生成简洁的英文周报草稿。用于每周向经理汇报。
---

# 周报

## 步骤
1. `list_tasks(status="all")` 收集本周完成和未完成的任务；`search_notes` 查本周修改过的笔记。
2. 按芯片 / 项目分组，每组最多 3 条，每条一句话，动词开头（Completed / Shipped / Confirmed / Investigating …）。
3. Blocked 必须写清楚等谁、等什么。
4. 用 `templates/weekly.md` 的结构输出；不要编造数字和日期，没有出处的写 TBD。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
