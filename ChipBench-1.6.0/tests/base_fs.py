import pathlib, json
F = pathlib.Path(__file__).resolve().parent / 'fixtures'
from util import b64
def base_fs():
    fs = {
      'C:\\Work': {'dir': 1}, 'C:\\Work\\DFA培训': {'dir': 1}, 'C:\\Work\\DFA培训\\章节': {'dir': 1}, 'C:\\Work\\DFA培训\\资料': {'dir': 1}, 'C:\\Work\\客户': {'dir': 1}, 'D:\\Share': {'dir': 1}, 'D:\\Share\\A公司': {'dir': 1},
      'C:\\Work\\DFA培训\\讲稿.md': {'t': '---\ntitle: DFA 培训讲稿\nstatus: 进行中\ncustomer: 内部\ndue: 2026-10-30\ntags: [培训, DFA]\n---\n# DFA 培训讲稿\n\n介绍 **DFA** 与 [[02-SWC]]，寄存器值 0x3F00。\n\n- [ ] 准备第 3 章 ⏳ 2026-10-21 ~2h ⏰ 09:30\n- [ ] 回复样品付款方式 📅 2026-10-22 ~30m !!\n- [x] 提交样品申请 ✅ 2026-10-21 ~20m\n\n| 项目 | 数量 | 单价 | 小计 |\n| --- | --: | --: | --: |\n| A | 20 | 2k | =B2*C2 |\n| B | 10 | 1.5k | =B3*C3 |\n\n```mermaid\ngraph LR\n  A[开始] --> B[结束]\n```\n\n```clocktree\ntitle: 示例时钟树\nsource: manual.pdf\nnodes:\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 24, div: 1, max: 480MHz, page: 2}\n  - {id: cpu, label: CPU 时钟, kind: div, in: pll, div: 2, max: 240MHz, page: 2}\nderive:\n  - {clock: cpu, baud: 115200}\n```\n\n```register\nname: CTRL\nwidth: 32\nreset: 0x5\nfields:\n  - {name: EN, bits: 0}\n  - {name: MODE, bits: "3:1", values: {0: 正常, 2: 回环}}\n```\n\n结尾段落。\n'},
      'C:\\Work\\DFA培训\\章节\\01-背景.md': {'t': '# 背景\n\nQ: DFA 是什么？ p.6\nA: Dedicated Accelerator\n\n回到 [[讲稿]]。\n'},
      'C:\\Work\\DFA培训\\章节\\02-SWC.md': {'t': '---\nstatus: 调查中\ncustomer: A公司\ndue: 2026-10-22\n---\n# SWC 使用\n\n- [ ] 整理 SWC 教程 ⏳ 2026-10-20 ~1h\n'},
      'C:\\Work\\DFA培训\\章节\\03-Combine.md': {'t': '---\nstatus: 完成\ncustomer: B公司\ndue: 2026-10-20\n---\n# Combine 模式\n\nquery 示例\n\n```query\nfrom: all\nwhere: status = 调查中 OR status = 完成\nsort: due\nview: board\ngroup: status\ncolumns: [title, customer, due]\n```\n'},
      'C:\\Work\\DFA培训\\资料\\术语表.md': {'t': '# 术语表\n\n| DFA | Dedicated Floating-point Accelerator |\n| --- | --- |\n| PLL | Phase Locked Loop |\n'},
      'C:\\Work\\DFA培训\\资料\\manual.pdf': {'b': b64(F / 'manual.pdf')}, 'C:\\Work\\DFA培训\\资料\\样品.xlsx': {'b': b64(F / '样品.xlsx')}, 'C:\\Work\\DFA培训\\资料\\规格.docx': {'b': b64(F / '规格.docx')}, 'C:\\Work\\DFA培训\\资料\\培训.pptx': {'b': b64(F / '培训.pptx')}, 'C:\\Work\\DFA培训\\资料\\邮件.eml': {'b': b64(F / '邮件.eml')},
      'C:\\Work\\客户\\fw_a.hex': {'t': (F / 'fw_a.hex').read_text()}, 'C:\\Work\\客户\\fw_b.hex': {'t': (F / 'fw_b.hex').read_text()}, 'C:\\Work\\客户\\emb.elf': {'b': b64(F / 'emb.elf')}, 'C:\\Work\\客户\\emb.map': {'t': (F / 'emb.map').read_text()}, 'C:\\Work\\客户\\t.svd': {'t': (F / 't.svd').read_text()},
      'C:\\Work\\客户\\uart.log': {'t': '\n'.join(f'[{i:05d}] {"ERROR CAN timeout" if i % 97 == 0 else "INFO tick"} temp={20 + i % 7}' for i in range(5000))},
      'D:\\Share\\A公司\\问题跟踪.md': {'t': '---\nstatus: 调查中\ncustomer: A公司\n---\n# 问题跟踪\n\n- [ ] 复现 CAN 错误帧 ⏳ 2026-10-22 ~1h\n'},
      'D:\\Share\\A公司\\会议纪要.md': {'t': '# 会议纪要\n\n讨论样品寄送。\n'},
    }
    return fs
PDFTEXT = {'c:\\work\\dfa培训\\资料\\manual.pdf': json.loads((F / 'manual.pages.json').read_text())}
