/* node tests/net.test.js — unit tests for app/js/net-logic.js */
const N = require('../app/js/net-logic.js'); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const u16 = v => [v >> 8 & 255, v & 255], u32 = v => [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255];
const eth = (et, pl, vlan) => [...[0x01,0x80,0xc2,0,0,0x0e], ...[2,0,0,0,0,1], ...(vlan ? [0x81,0, ...u16((vlan.pcp << 13) | vlan.id)] : []), ...u16(et), ...pl];
const ipv4 = (proto, pl) => { const tot = 20 + pl.length; return [0x45,0,...u16(tot),0,0,0,0,64,proto,0,0,192,168,1,10,192,168,1,20,...pl]; };
const udp = (sp, dp, pl) => [...u16(sp), ...u16(dp), ...u16(8 + pl.length), 0, 0, ...pl];
const tcp = (sp, dp, seq, fl, pl) => [...u16(sp), ...u16(dp), ...u32(seq), 0,0,0,0, 0x50, fl, 0xff, 0xff, 0,0,0,0, ...pl];
const ptp = (mt, seq) => { const a = new Array(44).fill(0); a[0] = 0x10 | mt; a[1] = 2; a[30] = seq >> 8; a[31] = seq & 255; return a; };
const doip = (pt, pl) => [2, 0xfd, ...u16(pt), ...u32(pl.length), ...pl];
const someip = (sid, mid, mt, pl) => [...u16(sid), ...u16(mid), ...u32(8 + pl.length), 0,1,0,1, 1, 1, mt, 0, ...pl];
const sd = (entries) => { const e = entries.flatMap(([t, svc, ttl]) => [t, 0, 0, 0x10, ...u16(svc), 0, 1, 1, ...[ttl >> 16 & 255, ttl >> 8 & 255, ttl & 255], 0,0,0,0]); return someip(0xffff, 0x8100, 2, [0xc0,0,0,0, ...u32(e.length), ...e, ...u32(0)]); };
function pcap(frames) { const h = [0xd4,0xc3,0xb2,0xa1, 2,0,4,0, 0,0,0,0, 0,0,0,0, 0xff,0xff,0,0, 1,0,0,0]; const out = [...h]; frames.forEach(([t, f]) => { const s = Math.floor(t), us = Math.round((t - s) * 1e6); const le = v => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]; out.push(...le(s), ...le(us), ...le(f.length), ...le(f.length), ...f); }); return Uint8Array.from(out); }
const frames = [];
for (let i = 0; i < 10; i++) { frames.push([i * 0.125, eth(0x88f7, ptp(0, i))]); frames.push([i * 0.125 + 0.0001, eth(0x88f7, ptp(8, i))]); }
frames.push([0.5, eth(0x0800, ipv4(6, tcp(50000, 13400, 1, 0x18, doip(0x0005, [0x0e,0x80,0,0,0,0,0]))))]);
frames.push([0.51, eth(0x0800, ipv4(6, tcp(13400, 50000, 1, 0x18, doip(0x0006, [0x0e,0x80,0x10,0x01,0x10,0,0,0,0]))))]);
frames.push([0.52, eth(0x0800, ipv4(6, tcp(50000, 13400, 20, 0x18, doip(0x8001, [0x0e,0x80,0x10,0x01,0x22,0xf1,0x90]))))]);
frames.push([0.53, eth(0x0800, ipv4(6, tcp(50000, 13400, 20, 0x18, doip(0x8001, [0x0e,0x80,0x10,0x01,0x22,0xf1,0x90]))))]); // retx
frames.push([0.54, eth(0x0800, ipv4(6, tcp(13400, 50000, 40, 0x18, doip(0x8001, [0x10,0x01,0x0e,0x80,0x7f,0x22,0x31]))))]);
frames.push([0.6, eth(0x0800, ipv4(6, tcp(13400, 50000, 99, 0x14, [])))]); // RST
frames.push([0.7, eth(0x0800, ipv4(17, udp(30490, 30490, sd([[1, 0x1234, 3], [6, 0x1234, 3]]))), { id: 10, pcp: 5 })]);
frames.push([0.8, eth(0x0800, ipv4(17, udp(30501, 30502, someip(0x1234, 0x8001, 2, [1, 2, 3, 4]))))]);
frames.push([2.0, eth(0x88f7, ptp(0, 10))]); // big gap
const cap = N.readCapture(pcap(frames)); ok(cap.format === 'pcap' && cap.frames.length === frames.length, 'pcap read');
const a = N.analyze(cap);
ok(a.protos.gPTP === 21, 'gPTP count ' + a.protos.gPTP);
ok(a.gptp.sync === 11 && a.gptp.followUp === 10, 'sync/fu');
ok(a.issues.some(i => /3 倍/.test(i.msg)), 'sync gap issue');
ok(a.doip['路由激活响应'] === 1 && a.doip['诊断报文'] === 3, 'doip types ' + JSON.stringify(a.doip));
ok(a.packets.some(p => p.doip && /NRC 0x31 for ReadDataByIdentifier/.test(p.doip.uds)), 'NRC decode');
ok(a.issues.some(i => /重传/.test(i.msg)) && a.issues.some(i => /RST/.test(i.msg)), 'tcp issues');
ok(a.someipServices.length === 1 && a.someipServices[0].sub === 1 && a.issues.some(i => /SubscribeAck/.test(i.msg)), 'someip-sd');
ok(a.vlans['10/PCP5'] === 1, 'vlan');
ok(a.packets.some(p => p.proto === 'SOME/IP' && p.someip.service === 0x1234), 'someip notif');
ok(/## gPTP/.test(N.reportMarkdown(a, 'x.pcap')), 'report');
// pcapng
(() => { const le32 = v => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255], le16 = v => [v & 255, v >> 8 & 255]; const shb = [...le32(0x0a0d0d0a), ...le32(28), ...le32(0x1a2b3c4d), ...le16(1), ...le16(0), 255,255,255,255,255,255,255,255, ...le32(28)]; const idb = [...le32(1), ...le32(20), ...le16(1), 0, 0, ...le32(0), ...le32(20)]; const f = eth(0x88f7, ptp(11, 1)); const padn = (4 - f.length % 4) % 4, blen = 32 + f.length + padn; const epb = [...le32(6), ...le32(blen), ...le32(0), ...le32(0), ...le32(1000000), ...le32(f.length), ...le32(f.length), ...f, ...new Array(padn).fill(0), ...le32(blen)]; const c = N.readCapture(Uint8Array.from([...shb, ...idb, ...epb])); ok(c.format === 'pcapng' && c.frames.length === 1 && N.decode(c.frames[0]).ptp.name === 'Announce' && Math.abs(c.frames[0].t - 1) < 1e-9, 'pcapng'); })();
// GCL
const g = N.gclModel({ link: '1Gbps', cycle: '500us', express: [7, 6], preemptable: [0, 1, 2, 3], entries: [{ dur: '100us', gates: '11000000' }, { dur: '390us', gates: '00111111' }, { dur: '10us', gates: '00000000' }] });
ok(g.issues.length === 0, 'gcl clean ' + JSON.stringify(g.issues));
const q7 = g.queues.find(x => x.q === 7); ok(Math.abs(q7.pct - 20) < 1e-9 && q7.worstGapNs === 400000, 'q7 ' + q7.pct + ' ' + q7.worstGapNs);
ok(Math.abs(g.guardNs - 12336) < 1, 'guard ' + g.guardNs);
const g2 = N.gclModel({ cycle: '400us', express: [7], entries: [{ dur: '100us', gates: [7] }, { dur: '200us', gates: [0, 1] }] });
ok(g2.issues.some(i => /总时长/.test(i.msg)) && g2.issues.some(i => /保护带/.test(i.msg)), 'gcl issues ' + JSON.stringify(g2.issues));
// CBS
const c = N.cbs({ link: '100Mbps', bandwidthPct: 75, maxFrame: 1522, maxInterferenceFrame: 1522 }); ok(c.idleSlopeKbps === 75000 && c.sendSlopeKbps === -25000 && Math.abs(c.hiCreditBits - 9132) < 1 && Math.abs(c.loCreditBits + 3044) < 1, 'cbs ' + JSON.stringify(c));
// CAN
const t = N.canTiming({ clock: '80MHz', bitrate: '500k', samplePoint: 80 }); ok(t.length && t[0].samplePoint === 80 && 80e6 / t[0].brp / t[0].tq === 500e3, 'can ' + JSON.stringify(t[0]));
// wave
const w = N.wave({ signal: [{ name: 'clk', wave: 'p....' }, { name: 'dat', wave: 'x.34.x', data: 'A B' }] }); ok(w.n === 6 && w.lanes[1].cells[2].label === 'A' && w.lanes[1].cells[3].label === 'B', 'wave');
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
