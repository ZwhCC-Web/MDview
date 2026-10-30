# ChipBench 1.6 · 芯片 AE 的工作台

作者：Wenhao Zhao　·　Windows 桌面应用（Tauri 2 + WebView2）　·　前身：Silica 3.1.3

**ChipBench 是芯片应用工程师（AE）的工作台。** 你按芯片或客户建项目，项目里用集合分类，分散在各处的手册、代码、PPT、抓包和日志都能在这里打开、查找、编辑，并沉淀成带出处的工程知识。时钟树、寄存器、引脚、内存图、TAS 门控列表、时序图都有专用编辑方式。外部 AI（GitHub Copilot、Claude、Cursor）通过 MCP 和 Agent Skills 读写同一个工作区。

> 一条原则：**文件留在原处。** 工作区只记录路径和上下文，不搬动、不改写你的文件。

## 核心能力

| 层 | 内容 |
|---|---|
| 工作区 | 多根目录、集合、最近打开、全文搜索（索引重启后直接恢复）；按芯片 / 项目自建，自由切换；窗口宽 / 中 / 半屏自适应 |
| 阅读与编辑 | Markdown（实时 / 源码 / 分屏 / 阅读）、右侧**上下文面板**（PDF 页 ↔ 笔记 / 组件）、PDF **摘录到笔记带页码**、PDF、Excel、Word、PPT、邮件、网页、HEX/ELF、.map、GB 级日志、**.pcap / .pcapng** |
| 工程组件 | `clocktree` 时钟树 · `structure` 结构图 · `register` 寄存器 · `pinout` 引脚 · `memmap` 内存图 · **`gcl` TAS 门控列表** · **`wavedrom` 时序图** · **`ipblock` IP 结构图（ELK 自动布局）**；节点可直接编辑；SVD 导入寄存器 |
| 工程工具 | 数值换算、波特率 / CAN 位时序、寄存器工作台、固件对比、构建大小对比、**CBS 信用整形** |
| 车载以太网 | 抓包分析（gPTP、DoIP + UDS NRC、SOME/IP-SD、VLAN/PCP、TCP RST/重传）、TAS 检查、CBS 计算 |
| 计划 | 待办、今日 / 本周规划、计时、周报素材 |
| AI | 通过 **MCP 服务（61 个工具 + 6 个提示词模板）** 接入 Copilot / Claude / Cursor；**技能库（16 个内置 Agent Skills）**；1.6 起不再内置 AI 助手 |

## 目录
```
app/            前端（纯 HTML / JS / CSS，无需 Node 构建）
  js/           logic · net-logic（纯逻辑，可在 Node 测试）→ core · editor · app · workspace · widgets · viewers
                · plan · learn · panels · tools · extras · net（以太网）· skills（技能库）→ boot → 增强模块 → workbench（1.1：布局、上下文、AI 工具调用）
  css/          chipbench.css（单一样式表）· fonts/
  lib/          离线库：CodeMirror、PDF.js、Mermaid、MathJax、docx、PptxGenJS、JSZip
src-tauri/      Rust 外壳（38 个命令，1.6 起全部异步执行）：读写与编码识别、监听、扫描与搜索、PDF 文字、GB 级日志、Office 转 PDF、Git
mcp/            chipbench_mcp.py（MCP 服务）· aenet.py（以太网 / 时序计算，标准库）· 自测
skills/         16 个内置 Agent Skills（SKILL.md + 脚本 + 参考资料）
tests/          逻辑测试、MCP 测试、端到端测试（模拟桌面）、性能测试
tools/          embed-docs.py（把 docs 嵌入应用）· sync-skills.py（同步并校验技能）
docs/           PRODUCT · MANUAL · SKILLS · ETHERNET · ARCHITECTURE · DESIGN · DEVELOPMENT · ROADMAP · CHANGELOG …
```

## 构建
**A. 本机 Windows**：安装 Rust（https://rustup.rs，MSVC）、VS Build Tools（“使用 C++ 的桌面开发”）、Node.js 18+，双击 `build-windows.bat`。
**B. GitHub Actions**：推到私有仓库 → Actions → *Build ChipBench Desktop* → Run workflow，在 Artifacts 下载安装包。

运行要求：Windows 10/11 + WebView2。MCP 服务和技能脚本需要 Python 3.8+（只用标准库）。Word / PPT 高保真查看需要本机 Office 或 LibreOffice。

## 从 Silica 升级
- 首次启动时，`%USERPROFILE%\.silica\` 会自动改名为 `%USERPROFILE%\.chipbench\`；`.silicaws` 工作区文件自动改为 `.cbws`；旧的 `.silicaboard` 白板仍可打开。
- 浏览器侧偏好（`silica.*`）自动迁移。
- MCP 配置里的脚本名改为 `chipbench_mcp.py`，请在 AI 工具里更新路径（应用内“MCP 服务器…”会生成新配置）。

## 已知限制（请先读）
- **打开 exe 时 Windows 提示有风险**：没有代码签名导致，见 `docs/SIGNING.md`（设置 `CHIPBENCH_CERT_THUMBPRINT` 后构建即可自动签名）。
- **Rust 部分没有在本环境编译过**（含 1.0 新增的数据目录迁移）。首次 `build-windows.bat` 如果报错，把报错发回即可。
- 前端、MCP、技能脚本已通过自动化测试（见下）；界面在 Linux 无头浏览器中验证，Windows 真机的字体和 WebView2 表现需要确认。
- 抓包分析一次最多读取 20 万帧；逐字段解码请用 Wireshark。`wavedrom` 块是内置子集渲染器（信号波形），不支持 WaveDrom 的寄存器图和逻辑电路图。

## 测试
```
node tests/logic.test.js ; node tests/md.test.js ; node tests/net.test.js
python mcp/test_mcp.py ; python mcp/test_aenet.py ; python tools/sync-skills.py --check
python tests/t_boot.py ; ... t_editor t_features t_tools t_viewers t_ws t_misc t_modules t_net   # 需要 playwright
python tests/t_perf.py && python scripts/check_perf.py
```
