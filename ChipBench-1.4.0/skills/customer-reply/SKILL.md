---
name: customer-reply
description: 把技术结论整理成正式的英文客户邮件：先给结论，再给依据（手册页码 / 测试数据），最后写下一步。用于回复客户技术问题。
---

# 客户技术回复

## 结构
1. **Answer first**：一句话回答客户的问题。
2. **Basis**：引用手册（文档号、版本、章节、页码）或测试结果；没有依据的不写。
3. **Recommendation / Next step**：客户需要做什么、我们会做什么、时间点（不确定就写 TBD）。

## 注意
- 不承诺未发布的规格；涉及量产、价格、交期的内容提醒用户先内部确认。
- 语气正式、简洁；避免 "I think"，用 "Based on the User's Manual (R01UH…, Rev.x, p.N) …"。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
