---
name: manual-to-clocktree
description: 从芯片手册的时钟章节提取时钟源、PLL、分频和上限频率，生成带页码的 ChipBench clocktree 组件块。用于整理时钟树、核对频率是否超限。
---

# 手册 → 时钟树

## 什么时候用
- 用户要整理某颗芯片（如 RH850/U2B）的时钟树，或核对某个模块时钟是否超限。

## 步骤
1. 用 `search_notes` / `read_file` 找到手册的时钟章节（Clock Controller / CPG 等），先列出时钟源、PLL、分频器和各模块时钟的名字。
2. 对每个节点记录：`id`、`label`、`kind`（source / pll / div / gate / mux）、输入 `in`、倍频 `mul` / 分频 `div`、最大频率 `max`、页码 `page`。
3. 生成 clocktree 块（格式见 `references/clocktree-format.md`），写入笔记。
4. 让 ChipBench 渲染后检查超限标红的节点，把有疑问的数值列成“待确认”清单。

## 输出
- 一个 ```clocktree 块 + 一张“节点 / 数值 / 页码 / 置信度”表。

## 通用规则（ChipBench）

- 每条技术结论都要写出处：文件名 + 页码（手册）或 文件:行号（代码 / 日志 / 抓包帧号）。
- 从手册推出、但没有直接原文支撑的内容，标记为 **待确认**。
- 写入 ChipBench 组件块时，用 MCP 的 `get_component` / `update_component`，不要整篇覆盖笔记。
