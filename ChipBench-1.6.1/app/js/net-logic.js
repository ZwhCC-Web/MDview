/* ChipBench · net-logic.js — pure in-vehicle Ethernet logic (no DOM). Unit-tested in Node: tests/net.test.js
   · PCAP / PCAPNG reader + Ethernet/VLAN/IPv4/IPv6/TCP/UDP/ARP decode
   · protocol tagging: gPTP (802.1AS), DoIP (ISO 13400), SOME/IP + SOME/IP-SD, AVTP, LLDP
   · capture triage: protocol mix, talkers, TCP RST / retransmission heuristics, gPTP Sync interval, DoIP payload types
   · TAS gate-control-list (GCL) model + checks (802.1Qbv), guard band, per-queue open time / worst gap
   · CBS (802.1Qav) credit parameters, frame wire time */
(function (G) {
  'use strict';
  const N = {};
  const hex = (n, w) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(w || 0, '0');
  const mac = (b, o) => Array.from(b.subarray(o, o + 6), x => x.toString(16).padStart(2, '0')).join(':');
  const ip4 = (b, o) => b[o] + '.' + b[o + 1] + '.' + b[o + 2] + '.' + b[o + 3];
  const ip6 = (b, o) => { const p = []; for (let i = 0; i < 16; i += 2) p.push(((b[o + i] << 8) | b[o + i + 1]).toString(16)); return p.join(':').replace(/(^|:)0(:0)+(:|$)/, '::'); };
  N.hex = hex;

  /* ---------- capture file reader ---------- */
  N.readCapture = (bytes, opt) => {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), max = (opt && opt.max) || 200000;
    if (b.length < 24) throw new Error('文件太小，不是抓包文件');
    const m = dv.getUint32(0, true), out = { format: '', linktype: 1, frames: [], truncated: false };
    if (m === 0xa1b2c3d4 || m === 0xd4c3b2a1 || m === 0xa1b23c4d || m === 0x4d3cb2a1) {
      const le = m === 0xa1b2c3d4 || m === 0xa1b23c4d, ns = m === 0xa1b23c4d || m === 0x4d3cb2a1;
      out.format = 'pcap' + (ns ? ' (ns)' : ''); out.linktype = dv.getUint32(20, le) & 0xffff;
      let o = 24;
      while (o + 16 <= b.length) {
        const s = dv.getUint32(o, le), f = dv.getUint32(o + 4, le), cl = dv.getUint32(o + 8, le), ol = dv.getUint32(o + 12, le);
        if (o + 16 + cl > b.length) { out.truncated = true; break; }
        if (out.frames.length >= max) { out.truncated = true; break; }
        out.frames.push({ t: s + f / (ns ? 1e9 : 1e6), len: ol, data: b.subarray(o + 16, o + 16 + cl), lt: out.linktype }); o += 16 + cl;
      }
      return out;
    }
    if (m === 0x0a0d0d0a) {
      out.format = 'pcapng'; let o = 0, le = true; const ifs = [];
      while (o + 12 <= b.length) {
        let type = dv.getUint32(o, le);
        if (type === 0x0a0d0d0a) { le = dv.getUint32(o + 8, true) === 0x1a2b3c4d; type = 0x0a0d0d0a; }
        const len = dv.getUint32(o + 4, le); if (len < 12 || o + len > b.length) { out.truncated = true; break; }
        if (type === 1) { // IDB
          const lt = dv.getUint16(o + 8, le); let res = 1e6, p = o + 16;
          while (p + 4 <= o + len - 4) { const code = dv.getUint16(p, le), ol = dv.getUint16(p + 2, le); if (code === 0) break; if (code === 9 && ol >= 1) { const v = b[p + 4]; res = v & 0x80 ? Math.pow(2, v & 0x7f) : Math.pow(10, v); } p += 4 + ((ol + 3) & ~3); }
          ifs.push({ lt, res }); if (ifs.length === 1) out.linktype = lt;
        } else if (type === 6) { // EPB
          const id = dv.getUint32(o + 8, le), hi = dv.getUint32(o + 12, le), lo = dv.getUint32(o + 16, le), cl = dv.getUint32(o + 20, le), ol = dv.getUint32(o + 24, le), i = ifs[id] || { lt: 1, res: 1e6 };
          if (out.frames.length >= max) { out.truncated = true; break; }
          out.frames.push({ t: (hi * 4294967296 + lo) / i.res, len: ol, data: b.subarray(o + 28, o + 28 + cl), lt: i.lt });
        } else if (type === 3) { // SPB
          const ol = dv.getUint32(o + 8, le), i = ifs[0] || { lt: 1 };
          out.frames.push({ t: 0, len: ol, data: b.subarray(o + 12, o + 12 + Math.min(ol, len - 16)), lt: i.lt });
        }
        o += len;
      }
      return out;
    }
    throw new Error('无法识别的抓包格式（支持 .pcap / .pcapng）');
  };

  /* ---------- PTP / SOME/IP / DoIP names ---------- */
  const PTP = { 0: 'Sync', 1: 'Delay_Req', 2: 'Pdelay_Req', 3: 'Pdelay_Resp', 8: 'Follow_Up', 9: 'Delay_Resp', 10: 'Pdelay_Resp_Follow_Up', 11: 'Announce', 12: 'Signaling', 13: 'Management' };
  const DOIP = { 0x0000: '通用否定应答', 0x0001: '车辆识别请求', 0x0002: '车辆识别请求(EID)', 0x0003: '车辆识别请求(VIN)', 0x0004: '车辆声明/识别响应', 0x0005: '路由激活请求', 0x0006: '路由激活响应', 0x0007: '在线检查请求', 0x0008: '在线检查响应', 0x4001: '实体状态请求', 0x4002: '实体状态响应', 0x4003: '电源模式请求', 0x4004: '电源模式响应', 0x8001: '诊断报文', 0x8002: '诊断肯定确认', 0x8003: '诊断否定确认' };
  const SOMEIP_MT = { 0x00: 'REQUEST', 0x01: 'REQUEST_NO_RETURN', 0x02: 'NOTIFICATION', 0x80: 'RESPONSE', 0x81: 'ERROR', 0x20: 'TP_REQUEST', 0x21: 'TP_REQUEST_NO_RETURN', 0x22: 'TP_NOTIFICATION', 0xa0: 'TP_RESPONSE', 0xa1: 'TP_ERROR' };
  const SD_ENTRY = { 0x00: 'FindService', 0x01: 'OfferService', 0x06: 'Subscribe', 0x07: 'SubscribeAck' };
  N.PTP = PTP; N.DOIP = DOIP;
  const UDS = { 0x10: 'DiagnosticSessionControl', 0x11: 'ECUReset', 0x14: 'ClearDTC', 0x19: 'ReadDTC', 0x22: 'ReadDataByIdentifier', 0x27: 'SecurityAccess', 0x28: 'CommunicationControl', 0x2e: 'WriteDataByIdentifier', 0x31: 'RoutineControl', 0x34: 'RequestDownload', 0x36: 'TransferData', 0x37: 'RequestTransferExit', 0x3e: 'TesterPresent', 0x85: 'ControlDTCSetting' };

  function someip(b, o, end, r) {
    if (end - o < 16) return false;
    const sid = (b[o] << 8) | b[o + 1], mid = (b[o + 2] << 8) | b[o + 3], len = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0, pv = b[o + 12], mt = b[o + 14], rc = b[o + 15];
    if (pv !== 1 || len < 8 || !(mt in SOMEIP_MT)) return false;
    r.proto = sid === 0xffff && mid === 0x8100 ? 'SOME/IP-SD' : 'SOME/IP';
    r.someip = { service: sid, method: mid, type: SOMEIP_MT[mt], rc };
    if (r.proto === 'SOME/IP-SD' && end - o >= 28) {
      const elen = ((b[o + 20] << 24) | (b[o + 21] << 16) | (b[o + 22] << 8) | b[o + 23]) >>> 0, entries = []; let p = o + 24;
      for (; p + 16 <= Math.min(end, o + 24 + elen); p += 16) { const t = b[p], svc = (b[p + 4] << 8) | b[p + 5], inst = (b[p + 6] << 8) | b[p + 7], ttl = (b[p + 9] << 16) | (b[p + 10] << 8) | b[p + 11]; entries.push({ type: (SD_ENTRY[t] || hex(t, 2)) + (ttl === 0 && (t === 1 || t === 6) ? '(Stop)' : ''), service: svc, instance: inst, ttl }); }
      r.someip.sd = entries; r.info = entries.map(e => e.type + ' ' + hex(e.service, 4)).join(', ');
    } else r.info = r.someip.type + ' service ' + hex(sid, 4) + ' method ' + hex(mid, 4) + (rc ? ' rc=' + rc : '');
    return true;
  }
  function doip(b, o, end, r) {
    if (end - o < 8 || (b[o] ^ b[o + 1]) !== 0xff) return false;
    const pt = (b[o + 2] << 8) | b[o + 3], len = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    if (!(pt in DOIP)) return false;
    r.proto = 'DoIP'; r.doip = { type: pt, name: DOIP[pt], len };
    if (pt === 0x8001 && end - o >= 13) { const sa = (b[o + 8] << 8) | b[o + 9], ta = (b[o + 10] << 8) | b[o + 11], sidv = b[o + 12]; const pos = sidv >= 0x40 && sidv !== 0x7f; const base = pos ? sidv - 0x40 : sidv; r.doip.sa = sa; r.doip.ta = ta; r.doip.uds = sidv === 0x7f ? 'NRC ' + hex(b[o + 14] || 0, 2) + ' for ' + (UDS[b[o + 13]] || hex(b[o + 13] || 0, 2)) : (UDS[base] || hex(sidv, 2)) + (pos ? ' +RSP' : ''); r.info = hex(sa, 4) + '→' + hex(ta, 4) + ' ' + r.doip.uds; }
    else if (pt === 0x0006 && end - o >= 13) { const code = b[o + 12]; r.doip.code = code; r.info = DOIP[pt] + ' code=' + hex(code, 2) + (code === 0x10 ? '（成功）' : '（失败）'); }
    else r.info = DOIP[pt];
    return true;
  }

  /* ---------- frame decode ---------- */
  N.decode = (f) => {
    const b = f.data, r = { t: f.t, len: f.len, proto: 'ETH', info: '', vlan: [] };
    if (f.lt !== 1 || b.length < 14) { r.proto = 'LINK ' + f.lt; return r; }
    r.dst = mac(b, 0); r.src = mac(b, 6); let o = 12, et = (b[o] << 8) | b[o + 1]; o += 2;
    while ((et === 0x8100 || et === 0x88a8) && o + 4 <= b.length) { const tci = (b[o] << 8) | b[o + 1]; r.vlan.push({ id: tci & 0xfff, pcp: tci >> 13 }); et = (b[o + 2] << 8) | b[o + 3]; o += 4; }
    r.ethertype = et;
    if (et === 0x88f7) { const mt = b[o] & 0x0f; r.proto = 'gPTP'; r.ptp = { type: mt, name: PTP[mt] || hex(mt, 1), seq: (b[o + 30] << 8) | b[o + 31], domain: b[o + 4], logInterval: (b[o + 33] << 24) >> 24 }; r.info = r.ptp.name + ' seq=' + r.ptp.seq; return r; }
    if (et === 0x22f0) { r.proto = 'AVTP'; r.info = 'subtype ' + hex(b[o], 2); return r; }
    if (et === 0x88cc) { r.proto = 'LLDP'; return r; }
    if (et === 0x0806) { r.proto = 'ARP'; const op = (b[o + 6] << 8) | b[o + 7]; r.info = op === 1 ? 'Who has ' + ip4(b, o + 24) + '? Tell ' + ip4(b, o + 14) : ip4(b, o + 14) + ' is at ' + mac(b, o + 8); return r; }
    if (et === 0x88e5) { r.proto = 'MACsec'; return r; }
    let l4 = -1, end = b.length;
    if (et === 0x0800 && o + 20 <= b.length) { const ihl = (b[o] & 15) * 4, tot = (b[o + 2] << 8) | b[o + 3]; r.ipv = 4; r.sip = ip4(b, o + 12); r.dip = ip4(b, o + 16); l4 = b[o + 9]; end = Math.min(b.length, o + tot); o += ihl; r.proto = 'IPv4'; }
    else if (et === 0x86dd && o + 40 <= b.length) { r.ipv = 6; r.sip = ip6(b, o + 8); r.dip = ip6(b, o + 24); l4 = b[o + 6]; end = Math.min(b.length, o + 40 + ((b[o + 4] << 8) | b[o + 5])); o += 40; r.proto = 'IPv6'; }
    else { r.proto = 'ETH ' + hex(et, 4); return r; }
    if (l4 === 6 && o + 20 <= end) {
      const sp = (b[o] << 8) | b[o + 1], dp = (b[o + 2] << 8) | b[o + 3], seq = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0, off = (b[o + 12] >> 4) * 4, fl = b[o + 13];
      r.proto = 'TCP'; r.sp = sp; r.dp = dp; r.tcp = { seq, flags: fl, payload: Math.max(0, end - o - off) };
      const F = [[2, 'SYN'], [16, 'ACK'], [1, 'FIN'], [4, 'RST'], [8, 'PSH']].filter(x => fl & x[0]).map(x => x[1]).join(','); r.info = sp + '→' + dp + ' [' + F + '] len=' + r.tcp.payload;
      const p = o + off; if (r.tcp.payload > 0 && (sp === 13400 || dp === 13400)) doip(b, p, end, r); else if (r.tcp.payload >= 16) someip(b, p, end, r);
      return r;
    }
    if (l4 === 17 && o + 8 <= end) {
      const sp = (b[o] << 8) | b[o + 1], dp = (b[o + 2] << 8) | b[o + 3]; r.proto = 'UDP'; r.sp = sp; r.dp = dp; r.info = sp + '→' + dp + ' len=' + (end - o - 8);
      const p = o + 8; if (sp === 13400 || dp === 13400) doip(b, p, end, r); else if (sp === 319 || dp === 319 || sp === 320 || dp === 320) { r.proto = 'PTP/UDP'; } else someip(b, p, end, r);
      return r;
    }
    if (l4 === 1 || l4 === 58) { r.proto = l4 === 1 ? 'ICMP' : 'ICMPv6'; return r; }
    return r;
  };

  /* ---------- triage ---------- */
  N.analyze = (cap) => {
    const pk = cap.frames.map(N.decode), t0 = pk.length ? pk[0].t : 0, protos = {}, talk = {}, seen = new Map(), issues = [];
    let rst = 0, retx = 0, bytes = 0;
    const ptp = { sync: [], fu: 0, pdreq: 0, pdresp: 0, announce: 0 }, doipT = {}, svc = {}, vlans = {};
    pk.forEach((p, i) => {
      p.i = i + 1; p.rt = p.t - t0; bytes += p.len; protos[p.proto] = (protos[p.proto] || 0) + 1;
      const k = p.sip ? p.sip + ' → ' + p.dip : (p.src || '') + ' → ' + (p.dst || ''); if (p.src) { const x = talk[k] || (talk[k] = { k, n: 0, bytes: 0 }); x.n++; x.bytes += p.len; }
      p.vlan.forEach(v => { const kk = v.id + '/PCP' + v.pcp; vlans[kk] = (vlans[kk] || 0) + 1; });
      if (p.tcp) { if (p.tcp.flags & 4) { rst++; p.warn = 'RST'; } if (p.tcp.payload > 0) { const key = p.sip + ':' + p.sp + '>' + p.dip + ':' + p.dp + '#' + p.tcp.seq + '/' + p.tcp.payload; if (seen.has(key)) { retx++; p.warn = '疑似重传'; } else seen.set(key, i); } }
      if (p.ptp) { if (p.ptp.type === 0) ptp.sync.push(p.t); else if (p.ptp.type === 8) ptp.fu++; else if (p.ptp.type === 2) ptp.pdreq++; else if (p.ptp.type === 3) ptp.pdresp++; else if (p.ptp.type === 11) ptp.announce++; }
      if (p.doip) { doipT[p.doip.name] = (doipT[p.doip.name] || 0) + 1; if (p.doip.type === 0x0006 && p.doip.code !== 0x10) { p.warn = '路由激活失败'; issues.push({ i: p.i, msg: '路由激活失败 code=' + hex(p.doip.code, 2) }); } if (p.doip.type === 0x8003) { p.warn = '诊断否定确认'; issues.push({ i: p.i, msg: 'DoIP 诊断否定确认' }); } if (p.doip.uds && /^NRC/.test(p.doip.uds)) { p.warn = p.doip.uds; } }
      if (p.someip) { if (p.someip.sd) p.someip.sd.forEach(e => { const kk = hex(e.service, 4) + '/' + hex(e.instance, 4); const s = svc[kk] || (svc[kk] = { k: kk, offer: 0, find: 0, sub: 0, ack: 0, stop: 0 }); if (/Offer/.test(e.type)) s.offer++; if (/Find/.test(e.type)) s.find++; if (/^Subscribe(\(|$)/.test(e.type)) s.sub++; if (/Ack/.test(e.type)) s.ack++; if (/Stop/.test(e.type)) s.stop++; }); else if (p.someip.type === 'ERROR' || p.someip.rc) { p.warn = 'SOME/IP rc=' + p.someip.rc; } }
    });
    const iv = []; for (let i = 1; i < ptp.sync.length; i++) iv.push((ptp.sync[i] - ptp.sync[i - 1]) * 1000);
    const avg = iv.length ? iv.reduce((a, x) => a + x, 0) / iv.length : 0, mx = iv.length ? Math.max(...iv) : 0;
    const gptp = ptp.sync.length || ptp.pdreq ? { sync: ptp.sync.length, followUp: ptp.fu, pdelayReq: ptp.pdreq, pdelayResp: ptp.pdresp, announce: ptp.announce, syncIntervalMs: +avg.toFixed(3), syncIntervalMaxMs: +mx.toFixed(3) } : null;
    if (gptp) { if (gptp.followUp && Math.abs(gptp.followUp - gptp.sync) > 1) issues.push({ msg: 'Sync(' + gptp.sync + ') 与 Follow_Up(' + gptp.followUp + ') 数量不一致' }); if (gptp.pdelayReq && gptp.pdelayResp < gptp.pdelayReq * 0.9) issues.push({ msg: 'Pdelay_Resp 少于 Pdelay_Req，链路延迟测量可能失败' }); if (avg && mx > avg * 3) issues.push({ msg: 'Sync 间隔最大 ' + mx.toFixed(2) + ' ms，超过平均值 3 倍（丢同步？）' }); }
    if (rst) issues.push({ msg: 'TCP RST × ' + rst }); if (retx) issues.push({ msg: '疑似 TCP 重传 × ' + retx });
    Object.values(svc).forEach(s => { if (s.sub && !s.ack) issues.push({ msg: 'SOME/IP 服务 ' + s.k + ' 有 Subscribe 但没有 SubscribeAck' }); });
    const dur = pk.length ? pk[pk.length - 1].t - t0 : 0;
    return { format: cap.format, truncated: cap.truncated, count: pk.length, bytes, duration: dur, protos, talkers: Object.values(talk).sort((a, b) => b.bytes - a.bytes).slice(0, 20), vlans, gptp, doip: Object.keys(doipT).length ? doipT : null, someipServices: Object.values(svc), issues, packets: pk };
  };
  N.reportMarkdown = (a, name) => {
    const L = ['# 抓包分析：' + (name || ''), '', '| 项目 | 值 |', '|---|---|', '| 格式 | ' + a.format + (a.truncated ? '（已截断）' : '') + ' |', '| 帧数 | ' + a.count + ' |', '| 字节 | ' + a.bytes + ' |', '| 时长 | ' + a.duration.toFixed(3) + ' s |', '', '## 协议分布', '', '| 协议 | 帧数 |', '|---|---:|'];
    Object.entries(a.protos).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => L.push('| ' + k + ' | ' + v + ' |'));
    if (a.gptp) { L.push('', '## gPTP', '', '| 项目 | 值 |', '|---|---|'); Object.entries(a.gptp).forEach(([k, v]) => L.push('| ' + k + ' | ' + v + ' |')); }
    if (a.doip) { L.push('', '## DoIP', '', '| 报文 | 数量 |', '|---|---:|'); Object.entries(a.doip).forEach(([k, v]) => L.push('| ' + k + ' | ' + v + ' |')); }
    if (a.someipServices.length) { L.push('', '## SOME/IP-SD 服务', '', '| 服务/实例 | Offer | Find | Subscribe | Ack | Stop |', '|---|---:|---:|---:|---:|---:|'); a.someipServices.forEach(s => L.push(`| ${s.k} | ${s.offer} | ${s.find} | ${s.sub} | ${s.ack} | ${s.stop} |`)); }
    L.push('', '## 发现的问题', ''); if (!a.issues.length) L.push('- 未发现明显异常'); a.issues.forEach(i => L.push('- ' + (i.i ? '#' + i.i + ' ' : '') + i.msg));
    L.push('', '## 主要通信对', '', '| 通信对 | 帧 | 字节 |', '|---|---:|---:|'); a.talkers.slice(0, 10).forEach(t => L.push('| ' + t.k + ' | ' + t.n + ' | ' + t.bytes + ' |'));
    return L.join('\n') + '\n';
  };

  /* ---------- link-layer timing ---------- */
  const rate = s => { if (typeof s === 'number') return s; const m = String(s || '').trim().match(/^([\d.]+)\s*([kmg]?)(bps|b\/s|bit\/s)?$/i); if (!m) return NaN; return parseFloat(m[1]) * ({ '': 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase()]); };
  const ns = s => { if (typeof s === 'number') return s; const m = String(s || '').trim().match(/^([\d.]+)\s*(ns|us|µs|ms|s)?$/i); if (!m) return NaN; return parseFloat(m[1]) * ({ ns: 1, us: 1e3, 'µs': 1e3, ms: 1e6, s: 1e9 }[(m[2] || 'ns').toLowerCase()]); };
  N.rate = rate; N.ns = ns;
  /** wire time of a frame (payload-inclusive L2 frame bytes, without preamble/IFG) -> ns, incl. 8 B preamble+SFD and 12 B IFG */
  N.wireNs = (frameBytes, linkBps) => (frameBytes + 8 + 12) * 8 / linkBps * 1e9;

  /* ---------- TAS / GCL (802.1Qbv) ---------- */
  const gates = g => { if (Array.isArray(g)) { let m = 0; g.forEach(q => { m |= 1 << q; }); return m; } const s = String(g).replace(/[^01]/g, ''); if (s.length === 8) return parseInt(s, 2); return Number(g) & 0xff; };
  N.gclModel = (m) => {
    const link = rate(m.link || '1Gbps'), cycle = ns(m.cycle), entries = (m.entries || []).map((e, i) => ({ i, dur: ns(e.dur || e.time), mask: gates(e.gates != null ? e.gates : e.open), note: e.note || '' }));
    const express = (m.express || []).map(Number), preempt = (m.preemptable || m.preempt || []).map(Number), maxFrame = Number(m.maxFrame || 1522), issues = [];
    const sum = entries.reduce((a, e) => a + e.dur, 0), C = cycle || sum;
    if (!entries.length) issues.push({ level: 'bad', msg: '没有门控条目' });
    if (cycle && sum !== cycle) issues.push({ level: sum > cycle ? 'bad' : 'warn', msg: '条目总时长 ' + (sum / 1000).toFixed(3) + ' µs ≠ 周期 ' + (cycle / 1000).toFixed(3) + ' µs' });
    entries.forEach(e => { if (!(e.dur > 0)) issues.push({ level: 'bad', msg: '条目 ' + e.i + ' 时长无效' }); });
    express.forEach(q => preempt.forEach(p => { if (p > q) issues.push({ level: 'warn', msg: 'Preemptable 队列 Q' + p + ' 优先级高于 Express 队列 Q' + q + '（手册建议 Express 用高优先级队列）' }); }));
    const guard = N.wireNs(maxFrame, link), guardFrag = N.wireNs(Math.min(maxFrame, 127), link);
    const queues = [];
    for (let q = 7; q >= 0; q--) {
      let open = 0, t = 0; const segs = [];
      entries.forEach(e => { if (e.mask & (1 << q)) { open += e.dur; const l = segs[segs.length - 1]; if (l && l[1] === t) l[1] = t + e.dur; else segs.push([t, t + e.dur]); } t += e.dur; });
      if (segs.length > 1 && segs[0][0] === 0 && segs[segs.length - 1][1] === C) { /* merged across cycle boundary for gap purposes */ }
      let worst = 0; for (let k = 0; k < segs.length; k++) { const nx = segs[(k + 1) % segs.length], gap = k + 1 < segs.length ? nx[0] - segs[k][1] : C - segs[k][1] + nx[0]; worst = Math.max(worst, gap); }
      const kind = express.includes(q) ? 'E' : preempt.includes(q) ? 'P' : '';
      queues.push({ q, kind, open, pct: C ? open / C * 100 : 0, worstGapNs: open ? worst : C, segs, maxFramesPerCycle: Math.floor(open / guard) });
    }
    // guard band: before each window where an express queue opens exclusively, preceding entry should close non-express gates for >= guard
    const EM = express.reduce((a, q) => a | (1 << q), 0), need = preempt.length ? guardFrag : guard;
    if (EM) entries.forEach((e, k) => {
      const expressOnly = (e.mask & EM) && !(e.mask & ~EM); if (!expressOnly || entries.length < 2) return; const prev = entries[(k - 1 + entries.length) % entries.length];
      if (prev.mask & ~EM & 0xff) issues.push({ level: 'warn', msg: '条目 ' + e.i + '（Express 独占窗口）前面紧接条目 ' + prev.i + ' 仍开着其他队列，没有保护带；建议插入约 ' + (need / 1000).toFixed(2) + ' µs 的关门条目' + (preempt.length ? '' : '，或开启帧抢占') });
      else if (!(prev.mask & EM) && prev.dur < need) issues.push({ level: 'warn', msg: '条目 ' + prev.i + ' 作为保护带只有 ' + (prev.dur / 1000).toFixed(2) + ' µs，小于需要的 ' + (need / 1000).toFixed(2) + ' µs' });
    });
    queues.forEach(x => { if (x.open && x.open < guard) issues.push({ level: 'warn', msg: 'Q' + x.q + ' 每周期开门 ' + (x.open / 1000).toFixed(2) + ' µs，小于一个最大帧 ' + (guard / 1000).toFixed(2) + ' µs' }); });
    return { link, cycle: C, entries, queues, guardNs: guard, guardFragNs: guardFrag, maxFrame, express, preempt, issues };
  };

  /* ---------- CBS (802.1Qav) ---------- */
  N.cbs = (o) => {
    const port = rate(o.link || '1Gbps'), idle = o.idleSlope != null ? rate(o.idleSlope) : port * (Number(o.bandwidthPct) || 0) / 100, send = idle - port;
    const maxFrame = Number(o.maxFrame || 1522), maxInterf = Number(o.maxInterferenceFrame || 1522);
    const hiCredit = maxInterf * 8 * idle / port, loCredit = maxFrame * 8 * send / port;
    return { portBps: port, idleSlopeBps: idle, sendSlopeBps: send, hiCreditBits: +hiCredit.toFixed(1), loCreditBits: +loCredit.toFixed(1), bandwidthPct: +(idle / port * 100).toFixed(3), idleSlopeKbps: Math.round(idle / 1000), sendSlopeKbps: Math.round(send / 1000) };
  };

  /* ---------- CAN / CAN FD bit timing ---------- */
  N.canTiming = (o) => {
    const clk = rate(String(o.clock || '80MHz').replace(/hz$/i, 'bps')), br = rate(String(o.bitrate || '500k').replace(/(hz|bps)?$/i, 'bps')), sp = Number(o.samplePoint || 80) / 100, out = [];
    const tqMin = o.tqMin || 8, tqMax = o.tqMax || 80, brpMax = o.brpMax || 1024, tseg1Max = o.tseg1Max || 256, tseg2Max = o.tseg2Max || 128;
    for (let brp = 1; brp <= brpMax; brp++) { const tq = clk / brp / br; if (tq < tqMin) break; if (Math.abs(tq - Math.round(tq)) > 1e-9 || tq > tqMax) continue; const n = Math.round(tq), t1 = Math.round(n * sp) - 1, t2 = n - 1 - t1; if (t1 < 1 || t2 < 1 || t1 > tseg1Max || t2 > tseg2Max) continue; out.push({ brp, tq: n, tseg1: t1, tseg2: t2, sjw: Math.min(t2, o.sjw || t2), samplePoint: +((1 + t1) / n * 100).toFixed(2), err: +Math.abs((1 + t1) / n - sp).toFixed(4) }); }
    out.sort((a, b) => a.err - b.err || b.tq - a.tq); return out.slice(0, 10);
  };

  /* ---------- WaveDrom subset (signal lanes) ---------- */
  N.wave = (m) => {
    const lanes = (m.signal || []).filter(s => s && s.name != null).map(s => { const w = String(s.wave || ''), data = Array.isArray(s.data) ? s.data : String(s.data || '').split(/\s+/).filter(Boolean); const cells = []; let last = 'x', di = 0; for (const ch of w) { if (ch === '|') { cells.push({ v: last, gap: true }); continue; } if (ch === '.') { cells.push({ v: last, cont: true, label: cells.length && cells[cells.length - 1].label != null ? null : null }); continue; } const v = ch; let label = null; if (/[2-9=]/.test(v)) label = data[di++] || ''; cells.push({ v, label }); last = v; } return { name: s.name, cells }; });
    const n = Math.max(0, ...lanes.map(l => l.cells.length)); return { lanes, n, hscale: Number(m.hscale || (m.config && m.config.hscale) || 1) };
  };

  if (G.ChipBench) G.ChipBench.NET = N; G.ChipBenchNET = N;
  if (typeof module !== 'undefined') module.exports = N;
})(typeof window !== 'undefined' ? window : globalThis);
