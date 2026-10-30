# ChipBench 测试包

可重复使用：把这个包解压到**任意版本的 ChipBench 源码根目录**（与 `app/`、`mcp/`、`package.json` 同级），会覆盖 `tests/`、`mcp/test_*.py`、`tools/run-tests.py` 和三个静态检查脚本。测试按自身位置定位源码，不需要改路径。

## 环境
- Node 18+（单元测试）
- Python 3.10+（MCP 测试、静态检查）
- 浏览器端到端：`pip install playwright`，并准备一个 Chromium；用环境变量 `CHROME` 指向它（Windows 例：`set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe`）。不设置时用 Playwright 自带的 Chromium。
- 端到端测试用模拟的 Tauri 文件系统（`tests/mock_tauri.js` + `tests/base_fs.py`），**不会碰你磁盘上的文件**。

## 运行
| 命令 | 范围 | 耗时 |
|---|---|---|
| `python tools/run-tests.py --fast` | Node 单元 + MCP + 静态检查 | 约 1 分钟 |
| `python tools/run-tests.py` | 全部，含浏览器端到端 | 约 15–25 分钟 |
| `python tools/run-tests.py --only t_ip18` | 名字包含该片段的测试 | 视测试而定 |
| `python tools/run-tests.py --report 我的报告` | 指定报告文件名 | — |

退出码 0 = 全部通过；报告写到 `tests/report-<版本>.md` 与 `.json`。单个浏览器测试也可以直接运行：`python -u tests/t_ip18.py`，最后一行是 `{"passed":…,"total":…,"fails":[…]}`。

## 2.2 新增的测试
| 测试 | 覆盖 |
|---|---|
| `tests/ip-templates.test.js` | 12 个模板：只写结构、每个子块都有连线、导出文件与代码一致、实例化 |
| `tests/ip-layout.test.js` | 手动摆放的几何（纯函数） |
| `tests/t_perf_ip.py` / `tests/t_big22.py` | 大模型：概览、展开、面纱高亮、预算 |
| `tests/t_place22.py` | 拖动移动 / 分组 / 成员出组 / 连线跟随 / 重置 / 多选 / 框选 / 成组 / 删除 |
| `tests/t_mini22.py` | 小地图 |
| `tools/gen-large-ip.js` | 生成 300 / 1000 / 3000 节点的可复现大模型 |

## 2.1.1 新增 / 改动的测试
| 测试 | 覆盖 |
|---|---|
| `tests/t_life21.py` | 查看器生命周期：白板 / PPTX 打开关闭 N 次、外部修改刷新后 window / document 监听和 ResizeObserver 不增长；失败提示含影响 + 下一步；空状态只有一个主操作 |
| `tests/t_narrow21.py` | 900 × 700：无页面溢出、7 个侧栏面板、状态栏、F1 / 命令面板 / 帮助 / 规划、IP Studio 右侧面板默认收起 / 自动返回 / 记住选择、工具栏换行 |
| `tests/t_ip18.py` | 新增：搜索框不遮挡聚焦横幅（122 项） |

## 2.0.0 新增 / 改动的测试
| 测试 | 覆盖 |
|---|---|
| `tests/ip-model.test.js` | 场景：7 个操作、跟随结构修改、校验、差异 / 摘要 / 子图、解码、真实内置 CAN-FD 页的场景迁移 |
| `mcp/test_ip18.py` | JS 与 Python 的场景一致性（22 个用例 + 迁移警告 + 差异 + 子图） |
| `mcp/test_mcp18.py` | 场景工具：ip_edit / ip_read / ip_validate / ip_list、拒绝非法步骤、提案默认 |
| `tests/t_ip18.py` | 场景播放（自动播放耗时约 6 秒）、高亮、录制、编辑、撤销、拖拽连线 / 移入 / 移出；单跑约 100 秒 |

## 1.9.0 新增 / 改动的测试
| 测试 | 覆盖 |
|---|---|
| `tests/t_treecolor.py` | 项目树：嵌套面板、6 个层级色、无渐变竖线、关闭层级配色 |
| `tests/t_ip18.py` | 新增：手动编辑结构（添加 / 连线 / 重命名 / 删除 / 撤销 / 按钮流程）、SVD 导入 |
| `tests/t_race19.py` | 同一标签连续两次打开只保留最新的视图 |
| `tests/ip-model.test.js` | 新增：SVD → 操作 |
| `mcp/test_ip18.py`、`mcp/test_mcp18.py` | 新增：SVD 一致性、`ip_import_svd`；工具总数 59 |

## 1.8.0 新增的测试
| 测试 | 覆盖 |
|---|---|
| `tests/ip-model.test.js` | IP 模型：14 个操作的原子性与每条拒绝规则、校验、子图、差异、模板、迁移 |
| `tests/ip-templates.test.js` | 5 个模板：只写结构、可实例化、可渲染 |
| `mcp/test_ip18.py` | JS 与 Python 两套 IP 模型逐项一致 |
| `mcp/test_mcp18.py` | 10 个 IP 工具：提案 / 直接写 / 原子拒绝 / dry_run / 只读 / 越界路径 |
| `tests/t_ip18.py` | IP Studio 界面：选择、改依据、撤销、折叠、聚焦、提案接受 / 拒绝、损坏文件、工作区子图引用 |
| `tests/t_files18.py` | 回收站、文件夹二次确认、恢复不覆盖、操作日志 |

## 新增测试的方法
1. 纯逻辑：照 `tests/model.test.js` 写 `tests/<名字>.test.js`，输出 `N passed, M failed`，runner 会自动发现。
2. 界面：复制 `tests/t_ip18.py` 的骨架（`Server` + `launch` + `chk`），文件系统在 `base_fs()` 里用字典声明；文件名 `t_*.py` 会被自动发现。最后一行输出 `{"passed":…,"total":…,"fails":[…]}`。
3. MCP：照 `mcp/test_mcp18.py`，通过 stdio 发 JSON-RPC。要登记到 runner 的列表里（`tools/run-tests.py` 中 `test_mcp…` 那一行）。

## 注意
- 版本号相关的断言（`tests/t_modules.py` 的“关于”页、`tests/mock_tauri.js` 的 selftest）在换版本时需要同步。
- `mcp/test_mcp.py` 里有工具总数断言（1.9.0 为 59）；增减工具时同步修改。
