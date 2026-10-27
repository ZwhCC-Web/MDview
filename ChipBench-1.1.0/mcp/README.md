# ChipBench MCP 服务

`chipbench_mcp.py` 让支持 MCP 的 AI 工具（VS Code 中的 GitHub Copilot Agent、Claude Desktop、Cursor 等）读写 ChipBench 工作区。只依赖 Python 3.8+ 标准库；以太网和时序计算在同目录的 `aenet.py`。

## 配置
在 ChipBench 中执行命令「MCP 服务器…」会生成填好路径的配置。手动配置示例：

```json
{ "mcpServers": { "chipbench": { "command": "python", "args": ["C:\\Program Files\\ChipBench\\mcp\\chipbench_mcp.py"] } } }
```
不带参数时，服务读取 ChipBench 当前工作区的根文件夹；也可以指定 `--root D:\Notes --root E:\Share`（可重复）。

## 工具（22 个）
| 分组 | 工具 |
|---|---|
| 笔记 | list_notes · read_note · search_notes · get_outline · get_backlinks · create_note · write_note · append_to_note · replace_in_note |
| 计划 | list_tasks（⏳ 计划、📅 截止、逾期标记） |
| 工作区 | list_workspaces · get_active_document · read_file（代码 / .map / 日志 / CSV，可按行读取） |
| 工程组件 | list_components · get_component · update_component（写入后标记“待确认”） |
| 技能 | list_skills · read_skill（内置技能 + `<根>/.agents/skills`） |
| 以太网与时序 | analyze_capture（.pcap / .pcapng）· check_gcl（TAS）· calc_cbs · calc_can_timing |

## 提示词模板（5 个，客户端里通常显示为斜杠命令）
read-manual-section · weekly-report · triage-capture · design-tas · review-component

## 资源
- `chipbench:///<相对路径>`：工作区里的 Markdown 笔记
- `chipbench://skills/<名称>`：技能说明

## 安全
- 只能访问根文件夹以内的路径；`read_skill` 只能读技能文件夹内的文件。
- 每次写入前备份到 `<根>/.chipbench/backup/`；保持文件原有编码（GBK / Shift_JIS 不会乱码）。
- `update_component` 写入的组件块会自动加上 `status: 待确认`，人在 ChipBench 里核对后再改。
- AI 修改文件后，ChipBench 的文件监听会自动重新载入。

自测：`python test_mcp.py`、`python test_aenet.py`
