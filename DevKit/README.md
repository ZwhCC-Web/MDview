# MDView 1.0 开发包

仿 Typora 的高性能 Markdown 编辑器。网页版是单个 HTML 文件；桌面版用 Tauri 2 封装同一个界面。

```
web/
  src/                 源码（parser.js、app1~app5、app.css、template.html、sample.md、vendor/）
  build.py             python build.py → dist/MDView.html（只需 Python，无需 Node）
  dist/MDView.html     构建产物（网页版本体）
  test/                端到端测试（Playwright + Chromium）：python test/run_all.py
  bench/               性能测试与结果 RESULTS.md
.github/workflows/     GitHub Actions：自动构建 Windows 安装包
desktop/
  src-tauri/           Rust 外壳（main.rs、tauri.conf.json、capabilities）
  mcp/                 MCP 服务 mdview_mcp.py + test_mcp.py + README
  dist/index.html      = web/dist/MDView.html
  build-windows.bat    本机一键构建
docs/                  ARCHITECTURE.md（架构）、USER_GUIDE.md（使用指南）
CHANGELOG.md
```

## 常用命令
```
cd web && python build.py                          # 构建网页版
copy web\dist\MDView.html desktop\dist\index.html   # 同步到桌面工程
cd desktop && npm install && npm run libs && npx tauri build   # 构建桌面版（需要 Rust）
python web/test/run_all.py                         # 全部测试（需要 pip install playwright 和 Chromium；CHROME 环境变量可指定路径）
python desktop/mcp/test_mcp.py                     # MCP 服务测试
python web/bench/gen_doc.py 20000 > web/bench/big20k.md && python web/bench/bench.py cm
```
