/* Write the built-in IP templates as bundled .cbip files:  node tools/export-templates.js [--check]
   templates/<key>.cbip is what the MCP server (ip_templates / ip_create template= / ip_instantiate template=builtin:<key>) reads.
   The app itself uses app/js/ip-templates.js (no file access needed); tests/ip-templates.test.js fails when the two drift apart (run this tool to refresh). */
const fs = require('fs'), path = require('path'), T = require('../app/js/ip-templates.js'), dir = path.join(__dirname, '../templates');
const out = {}; for (const k of Object.keys(T.templates)) out[k] = JSON.stringify(T.model(k), null, 2) + '\n';
if (process.argv.includes('--check')) { let bad = 0; for (const k of Object.keys(out)) { const f = path.join(dir, k + '.cbip'); if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== out[k]) { console.log('out of date: templates/' + k + '.cbip'); bad++; } } const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.cbip') && !(f.slice(0, -5) in out)) : []; extra.forEach(f => { console.log('no such template any more: templates/' + f); bad++; }); process.exit(bad ? 1 : 0); }
fs.mkdirSync(dir, { recursive: true }); for (const k of Object.keys(out)) fs.writeFileSync(path.join(dir, k + '.cbip'), out[k]); console.log('wrote ' + Object.keys(out).length + ' templates to templates/');
