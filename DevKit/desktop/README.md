# MDView 1.0 桌面版（Tauri 2）

界面 = `dist/index.html`（与网页版相同）；Rust 外壳 `src-tauri/src/main.rs` 提供：

| 能力 | 说明 |
|---|---|
| 原生读写 + 编码识别 | GBK / Shift_JIS / Big5 自动识别，保存时保持原编码；先写临时文件再替换（原子保存） |
| 文件监听 | 已打开文件与文件夹被外部（含 MCP / AI）修改时自动重新载入，图片自动刷新 |
| 全局搜索 / 链接索引 | Rust 遍历 + 正则，供搜索、反向链接、关系图谱使用 |
| AI 请求 | tauri-plugin-http，不受浏览器跨域限制，支持流式输出 |
| Outlook 草稿 | 生成 .eml 到临时目录并用默认邮件程序打开 |
| MCP 桥 | 当前文档与选区写入 `~/.mdview/state.json`；安装包内含 `mcp/mdview_mcp.py` |
| 文件关联 / 单实例 / 窗口状态 | 双击 .md 打开；再次双击在已有窗口新开标签；记住窗口位置 |
| 离线公式与图表 | 构建时把 KaTeX、Mermaid、WaveDrom 复制到 `dist/lib` |

## 构建方式一：GitHub Actions（本机无需 Rust）
1. 将 DevKit 项目根目录（包含 `desktop`、`web`、`docs` 的目录）推送到公司 GitHub 仓库。工作流位于仓库根目录的 `.github/workflows/build.yml`。
2. Actions → *Build MDView Desktop* → Run workflow（会先运行 MCP 自测）。
3. 在 Artifacts 下载 `MDView-Windows`：NSIS 安装包（当前用户安装，无需管理员）、MSI、免安装 `mdview.exe`。

## 构建方式二：本机 Windows
前置：Rust（https://rustup.rs，MSVC）、VS Build Tools（“使用 C++ 的桌面开发”）、Node.js 18+。双击 `build-windows.bat`。

## 运行要求
Windows 10/11 + WebView2 Runtime（Win11 自带；Win10 一般已随 Edge 安装，安装包也会自动下载）。MCP 服务需要 Python 3.8+。
