# 制作说明与许可

**ChipBench** — 芯片 AE 的工作台（前身 Silica）
制作：**Wenhao Zhao**
版本：1.6.0

## 制作说明

ChipBench 由 Wenhao Zhao 提出需求、定义产品并验收，在 Microsoft 365 Copilot 的协助下设计与实现。它面向芯片应用工程师（AE）的日常工作流：读手册、写笔记、算时序、看固件与日志、规划一天。

## 随程序附带的开源组件

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| Tauri 2 / WebView2 | MIT / Apache-2.0 | 桌面外壳 |
| CodeMirror 6 | MIT | 编辑器内核 |
| PDF.js | Apache-2.0 | PDF 显示 |
| Mermaid | MIT | 流程图 |
| MathJax | Apache-2.0 | 数学公式 |
| Prism | MIT | 代码高亮 |
| Source Sans（Adobe） | SIL OFL 1.1 | 拉丁正文字体（子集） |
| Noto Sans CJK SC / Source Han Sans（Adobe / Google） | SIL OFL 1.1 | 中文正文字体（子集） |

字体许可全文见 `app/css/fonts/OFL-SourceSans.txt` 与 `NOTICE.txt`。

## 声明

- 文档始终保存在原路径；ChipBench 不上传你的文件。AI 功能只会把你主动选中的内容发送到你配置的服务。
- 本软件按“现状”提供；用于保密资料前，请确认符合所在公司的信息安全规定。

## 1.3
- **elkjs 0.9.3**（Eclipse Layout Kernel，EPL-2.0）：`ipblock` 自动布局，打包在 `app/lib/elk/`，许可全文见 `app/lib/elk/LICENSE-EPL-2.0.txt`。源码：github.com/kieler/elkjs。
- 调研参考（未打包）：d3-hwschematic、netlistsvg、Symbolator、PeakRDL、Kactus2，见 `docs/OPEN-SOURCE.md`。
