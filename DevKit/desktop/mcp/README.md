# MDView MCP 服务

`mdview_mcp.py` 让支持 MCP 的 AI 工具（VS Code 中的 GitHub Copilot Agent、Claude Desktop、Cursor 等）读写你的 Markdown 笔记。只依赖 Python 3.8+ 标准库。

## 配置

VS Code（工作区 `.vscode/mcp.json`）：
```json
{ "servers": { "mdview": { "type": "stdio", "command": "python", "args": ["C:\\path\\to\\mdview_mcp.py", "--root", "D:\\Notes"] } } }
```

Claude Desktop（`claude_desktop_config.json`）/ Cursor（`~/.cursor/mcp.json`）：
```json
{ "mcpServers": { "mdview": { "command": "python", "args": ["C:\\path\\to\\mdview_mcp.py", "--root", "D:\\Notes"] } } }
```
MDView 中「AI → MCP 接入」会自动生成填好路径的配置。

## 工具

| 工具 | 作用 |
|---|---|
| list_notes | 列出笔记（路径、大小、修改时间、标题） |
| read_note | 读取笔记（可按名称，像 [[双链]]；可指定行范围） |
| search_notes | 全文搜索（支持正则） |
| get_outline | 标题大纲 |
| get_backlinks | 反向链接 |
| list_tasks | 汇总 `- [ ]` 待办与 📅 截止日期（标记逾期） |
| create_note / write_note | 新建 / 改写笔记 |
| append_to_note | 追加到文末或某个标题下 |
| replace_in_note | 替换文字 |
| get_active_document | MDView 桌面版当前打开的文档与选中文字 |

安全：只允许访问 `--root` 目录；每次写入前在 `<root>/.mdview/backup/` 保留备份；保持文件原有编码（GBK / Shift_JIS 文件不会被改成乱码）。

自测：`python test_mcp.py`
