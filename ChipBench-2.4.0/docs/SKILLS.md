# 技能库（Agent Skills）

技能是一个文件夹，里面有一个 `SKILL.md`（名称、描述和操作步骤），可以附带脚本、参考资料和模板。这是一个开放格式，GitHub Copilot、Claude、Cursor 等 AI 工具都能读取。AI 平时只看每个技能的名称和描述，用到时才加载全文，所以装很多技能也不会占满上下文。

## 在哪里
| 位置 | 说明 |
|---|---|
| `<安装目录>\skills\` | ChipBench 内置的 15 个技能 |
| `<工作区根目录>\.agents\skills\` | 你自己的技能，或从内置技能安装过来的副本 |

## 怎么用
- **ChipBench 里**：左栏“工程工具” → “技能库”，或按 Ctrl+Alt+L。可以搜索、打开说明、**安装到工作区**、新建技能。
- **外部 AI 里**：
  - 通过 MCP：`list_skills` / `read_skill`，或资源 `chipbench://skills/<名称>`；
  - 直接读取：支持 Agent Skills 的工具会扫描工作区的 `.agents/skills/`。

## 内置技能

| 技能 | 用途 | 自带内容 |
|---|---|---|
| manual-to-clocktree | 手册时钟章节 → clocktree 块 | 格式说明 |
| register-extract | 寄存器表 → register 块 | `table_to_register.py` |
| can-bittiming | CAN / CAN FD 位时序 | `aenet.py` |
| map-analysis | .map 占用与构建对比 | `map_summary.py` |
| weekly-report | 英文周报草稿 | 模板 |
| customer-reply | 正式的英文客户技术回复 | — |
| etn-feature-matrix | U2B 以太网功能矩阵（型号 × 单元 × 接口） | U2B ETN 页码索引 |
| etn-register-extract | U2B 以太网寄存器 → register 块 | 页码索引、脚本 |
| tas-gcl-designer | 设计并检查 TAS 门控列表 | `aenet.py`、gcl 格式 |
| cbs-calc | CBS 信用整形参数 | `aenet.py` |
| pcap-triage | 抓包初筛 | `aenet.py` |
| someip-decode | SOME/IP 与 SOME/IP-SD | `aenet.py` |
| doip-session | DoIP 会话与 UDS NRC | `aenet.py` |
| gptp-check | gPTP 同步检查 | `aenet.py` |
| phy-bringup | PHY 调通检查单 | — |

所有技能共享同一组规则：结论写出处；没有原文支撑的写“待确认”；组件块用 `get_component` / `update_component` 修改。

## 写自己的技能
1. 技能库 → “新建技能”，会在工作区生成模板并打开。
2. `name` 必须和文件夹同名（小写字母、数字、连字符）。`description` 用一句话写清“做什么、什么时候用”，AI 靠这句话决定是否加载。
3. 步骤写成编号清单；需要计算的部分写成脚本放在 `scripts/`，优先只用 Python 标准库。
4. 开发者维护内置技能时，运行 `python tools/sync-skills.py`：它会把 `mcp/aenet.py` 同步到各技能，并校验格式。
