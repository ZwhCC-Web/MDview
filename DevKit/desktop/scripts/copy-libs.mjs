// Copy KaTeX + Mermaid + WaveDrom into dist/lib so formulas & diagrams work fully offline.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const nm = new URL('../node_modules/', import.meta.url);
const out = new URL('../dist/lib/', import.meta.url);
for (const d of ['katex/', 'mermaid/', 'wavedrom/']) mkdirSync(new URL(d, out), { recursive: true });
cpSync(new URL('katex/dist/katex.min.js', nm), new URL('katex/katex.min.js', out));
cpSync(new URL('katex/dist/katex.min.css', nm), new URL('katex/katex.min.css', out));
cpSync(new URL('katex/dist/fonts/', nm), new URL('katex/fonts/', out), { recursive: true });
cpSync(new URL('mermaid/dist/mermaid.min.js', nm), new URL('mermaid/mermaid.min.js', out));
cpSync(new URL('wavedrom/wavedrom.min.js', nm), new URL('wavedrom/wavedrom.min.js', out));
cpSync(new URL('wavedrom/skins/default.js', nm), new URL('wavedrom/default.js', out));
console.log('libs copied to dist/lib', existsSync(new URL('mermaid/mermaid.min.js', out)) ? 'OK' : 'MISSING');
