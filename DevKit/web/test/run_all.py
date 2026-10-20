"""Run all MDView end-to-end tests (Playwright + Chromium) and the MCP server test.
   python run_all.py            (set CHROME=<path to chrome> if Chromium is not at the default location)"""
import subprocess, sys, pathlib, time
HERE = pathlib.Path(__file__).resolve().parent
CHECKS = {
    't_smoke.py': ['cm True', 'editor True', 'edit ok True', 'errs []'],
    't_web.py': ['wiki_ac => True', '| 型号 | 引脚 | 封装 |', 'fmtbar => True', '| 新', 'replaced => 3', "1018", 'palette => 8', 'ai_reply => 这是润色后的结果。', 'ai_req_has_ctx => True', '这是润色后的**结果**', 'task_toggled => True', 'slides => 1 / 5', 'dl_pptx => deck.pptx', 'dl_docx => deck.docx', 'dl_eml => 技术培训.eml', 'lint => 6', 'errs => []'],
    't_native.py': ["['assets/x.png', 'blob:', '']", "['assets/my pic.png', 'blob:', '']", "abs.png', 'blob:', '']", "file:///C:/pics/abs.png', 'blob:'", '找不到图片：assets/none.png', '寄样品', '[x] B 的待办', '反向链接 · 2', 'wiki C笔记.md GBK', 'saved GBK', 'reloaded # 外部改动', '第二次外部改动', 'tpl count 10', '客户周会-测试.md', "daily ['C:", 'eml opened', 'a.docx', '[[alpha]]', 'errs []'],
    't_more.py': ['paste_table => | 料号', 'image-', "pasted_img_render => ['blob:']", 'img_refreshed => True', 'enter_split => 第一句。⏎⏎第二句。', 'arrow_nav => 后一段', 'hist_restored => # 文档A', 'graph => 4 篇文档', 'html_inline_has_data => True', '全新笔记.md', 'src_slash => True', 'src_table => | 列1', "src_find => ('1/2', 2)", 'ai_err => AI 请求失败：HTTP 500', 'openai/deployments/gpt4o', 'mail_inline => True', 'errs => []'],
    't_fallback.py': ['engine => 基础编辑器', "src => ['- q', '- w']", 'back => True', 'errs => []'],
}
ok = True
sel = [a for a in sys.argv[1:] if a in CHECKS]
for name, need in CHECKS.items():
    if sel and name not in sel: continue
    t = time.time()
    r = subprocess.run([sys.executable, str(HERE / name)], capture_output=True, text=True, encoding='utf-8', cwd=HERE, timeout=300)
    out = r.stdout + r.stderr
    miss = [n for n in need if n not in out]
    status = 'PASS' if not miss and r.returncode == 0 else 'FAIL'
    ok &= status == 'PASS'
    print(f'{status}  {name:16s} {time.time() - t:5.1f}s' + ('' if status == 'PASS' else '  missing: ' + str(miss) + '\n' + out[-1500:]))
mcp = pathlib.Path(__file__).resolve().parents[2] / 'desktop' / 'mcp' / 'test_mcp.py'
if mcp.exists() and (not sel or 'mcp' in sys.argv):
    r = subprocess.run([sys.executable, str(mcp)], capture_output=True, text=True, encoding='utf-8')
    s = 'PASS' if 'ALL PASS' in r.stdout else 'FAIL'; ok &= s == 'PASS'; print(f'{s}  test_mcp.py (22 checks)')
print('ALL TESTS PASSED' if ok else 'SOME TESTS FAILED'); sys.exit(0 if ok else 1)
