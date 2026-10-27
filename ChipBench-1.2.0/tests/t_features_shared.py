AIFETCH = """
window.__aiCalls = []; window.__fetch = async (u, o) => { window.__aiCalls.push({u, body: o && o.body});
  const body = JSON.parse(o.body), last = body.messages[body.messages.length-1].content; let text;
  if (/提取「/.test(last)) text = '```yaml\\ntype: clock-tree\\ntitle: AI 时钟树\\nsource: manual.pdf\\nnodes:\\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 24, max: 480MHz, page: 2}\\n  - {id: bad, label: 编造节点, kind: div, in: pll, div: 4, max: 999MHz, page: 2}\\n```';
  else if (/学习问答卡片/.test(last)) text = 'Q: 时钟源？ p.1\\nA: Main OSC\\n\\nQ: PLL 上限？ p.2\\nA: 480 MHz';
  else text = '这是 AI 的回答：' + last.slice(0, 20);
  const enc = new TextEncoder(); const chunks = text.match(/.{1,8}/gs).map(c => enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:c}}]}) + '\\n\\n')); chunks.push(enc.encode('data: [DONE]\\n\\n'));
  let i = 0; return { ok: true, status: 200, body: { getReader() { return { read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true } }; } }, text: async () => '' }; };
"""
