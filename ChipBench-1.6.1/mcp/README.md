# ChipBench MCP 服务

`chipbench_mcp.py` 让支持 MCP 的 AI 工具（VS Code 中的 GitHub Copilot Agent、Claude Desktop、Cursor 等）读写 ChipBench 工作区。只依赖 Python 3.8+ 标准库；以太网和时序计算在同目录的 `aenet.py`。

## 配置
在 ChipBench 中执行命令「MCP 服务器…」会生成填好路径的配置。手动配置示例：

```json
{ "mcpServers": { "chipbench": { "command": "python", "args": ["C:\\Program Files\\ChipBench\\mcp\\chipbench_mcp.py"] } } }
```
不带参数时，服务读取 ChipBench 当前工作区的根文件夹；也可以指定 `--root D:\Notes --root E:\Share`（可重复）。

## 工具（46 个）
| 分组 | 工具 |
|---|---|
| 工作区 | get_workspace_info · list_workspaces · get_active_document · list_dir · find_files |
| 新建文件夹与文件 | create_folder · create_file · write_file · append_file · create_tree（一次建一整套目录与文件） |
| 笔记 | list_notes · read_note · search_notes · get_outline · get_backlinks · create_note · write_note · append_to_note · replace_in_note |
| 文件与手册 | read_file · grep_files（代码 / 文本全文搜索）· read_pdf_pages · search_pdf（PDF 手册全文搜索，带页码） |
| 计划 | list_tasks · add_task · set_task_done · append_journal |
| 工程组件 | list_components · get_component · update_component（写入后标记“待确认”）· evaluate_clocktree · decode_register · describe_ipblock |
| IP 图谱 | atlas_list · atlas_read · atlas_create_page · atlas_write_section · atlas_add_scene · atlas_validate · atlas_compare |
| 技能 | list_skills · read_skill |
| 以太网与时序 | analyze_capture · check_gcl · calc_cbs · calc_can_timing |

## 数据目录
查找顺序与桌面端相同：`CHIPBENCH_HOME` → 安装目录旁的 `data`（便携）→ `%USERPROFILE%\.chipbench-location` 记录的目录 → `%USERPROFILE%\.chipbench`。
`search_pdf` / `read_pdf_pages` 读取桌面端生成的 PDF 文字缓存：PDF 需在 ChipBench 里打开或被索引过一次。

## 提示词模板（5 个，客户端里通常显示为斜杠命令）
read-manual-section · weekly-report · triage-capture · design-tas · review-component

## 资源
- `chipbench:///<相对路径>`：工作区里的 Markdown 笔记
- `chipbench://skills/<名称>`：技能说明

## 安全
- 新建文件夹 / 文件：路径相对第一个根目录；多个根目录时写 `根目录名/子路径`。拒绝 Windows 非法名、`.chipbench` / `.git`、可执行 / 脚本类型（`.exe .bat .ps1 …`）、超过 5 MB 的内容、二进制文件；`create_tree` 先整体校验再写入。
- 只能访问根文件夹以内的路径；`read_skill` 只能读技能文件夹内的文件。
- 每次写入前备份到 `<根>/.chipbench/backup/`；保持文件原有编码（GBK / Shift_JIS 不会乱码）。
- `update_component` 写入的组件块会自动加上 `status: 待确认`，人在 ChipBench 里核对后再改。
- AI 修改文件后，ChipBench 的文件监听会自动重新载入。

自测：`python test_mcp.py`、`python test_aenet.py`
