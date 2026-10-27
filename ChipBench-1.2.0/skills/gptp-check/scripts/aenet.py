#!/usr/bin/env python3
"""aenet.py — ChipBench in-vehicle Ethernet & timing helpers (Python 3.8+, standard library only).

Same logic as app/js/net-logic.js so that the desktop app, the MCP server and the bundled skills give identical answers.

    python aenet.py pcap  capture.pcapng [--focus gptp|doip|someip] [--json]
    python aenet.py gcl   gcl.json                       # {"link":"1Gbps","cycle":"500us","express":[7,6],"preemptable":[0,1],"entries":[{"dur":"100us","gates":"11000000"}]}
    python aenet.py cbs   --link 100Mbps --bw 75 [--max-frame 1522] [--interference 1522]
    python aenet.py can   --clock 80MHz --bitrate 500k [--sp 80]
"""
import argparse, json, re, struct, sys

PTP = {0: "Sync", 1: "Delay_Req", 2: "Pdelay_Req", 3: "Pdelay_Resp", 8: "Follow_Up", 9: "Delay_Resp", 10: "Pdelay_Resp_Follow_Up", 11: "Announce", 12: "Signaling", 13: "Management"}
DOIP = {0x0000: "通用否定应答", 0x0001: "车辆识别请求", 0x0002: "车辆识别请求(EID)", 0x0003: "车辆识别请求(VIN)", 0x0004: "车辆声明/识别响应", 0x0005: "路由激活请求", 0x0006: "路由激活响应", 0x0007: "在线检查请求", 0x0008: "在线检查响应", 0x4001: "实体状态请求", 0x4002: "实体状态响应", 0x4003: "电源模式请求", 0x4004: "电源模式响应", 0x8001: "诊断报文", 0x8002: "诊断肯定确认", 0x8003: "诊断否定确认"}
SOMEIP_MT = {0x00: "REQUEST", 0x01: "REQUEST_NO_RETURN", 0x02: "NOTIFICATION", 0x80: "RESPONSE", 0x81: "ERROR", 0x20: "TP_REQUEST", 0x21: "TP_REQUEST_NO_RETURN", 0x22: "TP_NOTIFICATION", 0xA0: "TP_RESPONSE", 0xA1: "TP_ERROR"}
SD_ENTRY = {0x00: "FindService", 0x01: "OfferService", 0x06: "Subscribe", 0x07: "SubscribeAck"}
UDS = {0x10: "DiagnosticSessionControl", 0x11: "ECUReset", 0x14: "ClearDTC", 0x19: "ReadDTC", 0x22: "ReadDataByIdentifier", 0x27: "SecurityAccess", 0x28: "CommunicationControl", 0x2E: "WriteDataByIdentifier", 0x31: "RoutineControl", 0x34: "RequestDownload", 0x36: "TransferData", 0x37: "RequestTransferExit", 0x3E: "TesterPresent", 0x85: "ControlDTCSetting"}


def hx(n, w=0):
    return "0x" + format(n & 0xFFFFFFFF, "X").zfill(w)


# ---------------------------------------------------------------- capture reader
def read_capture(data, max_frames=200000):
    if len(data) < 24:
        raise ValueError("文件太小，不是抓包文件")
    m = struct.unpack_from("<I", data, 0)[0]
    out = {"format": "", "frames": [], "truncated": False}
    if m in (0xA1B2C3D4, 0xD4C3B2A1, 0xA1B23C4D, 0x4D3CB2A1):
        le = m in (0xA1B2C3D4, 0xA1B23C4D)
        ns = m in (0xA1B23C4D, 0x4D3CB2A1)
        e = "<" if le else ">"
        out["format"] = "pcap" + (" (ns)" if ns else "")
        lt = struct.unpack_from(e + "I", data, 20)[0] & 0xFFFF
        o = 24
        while o + 16 <= len(data):
            s, f, cl, ol = struct.unpack_from(e + "IIII", data, o)
            if o + 16 + cl > len(data) or len(out["frames"]) >= max_frames:
                out["truncated"] = True
                break
            out["frames"].append({"t": s + f / (1e9 if ns else 1e6), "len": ol, "data": data[o + 16:o + 16 + cl], "lt": lt})
            o += 16 + cl
        return out
    if m == 0x0A0D0D0A:
        out["format"] = "pcapng"
        o, e, ifs = 0, "<", []
        while o + 12 <= len(data):
            t = struct.unpack_from(e + "I", data, o)[0]
            if t == 0x0A0D0D0A:
                e = "<" if struct.unpack_from("<I", data, o + 8)[0] == 0x1A2B3C4D else ">"
            ln = struct.unpack_from(e + "I", data, o + 4)[0]
            if ln < 12 or o + ln > len(data):
                out["truncated"] = True
                break
            if t == 1:
                lt = struct.unpack_from(e + "H", data, o + 8)[0]
                res, p = 1e6, o + 16
                while p + 4 <= o + ln - 4:
                    code, olen = struct.unpack_from(e + "HH", data, p)
                    if code == 0:
                        break
                    if code == 9 and olen >= 1:
                        v = data[p + 4]
                        res = 2 ** (v & 0x7F) if v & 0x80 else 10 ** v
                    p += 4 + ((olen + 3) & ~3)
                ifs.append((lt, res))
            elif t == 6:
                iid, hi, lo, cl, ol = struct.unpack_from(e + "IIIII", data, o + 8)
                lt, res = ifs[iid] if iid < len(ifs) else (1, 1e6)
                if len(out["frames"]) >= max_frames:
                    out["truncated"] = True
                    break
                out["frames"].append({"t": (hi * 4294967296 + lo) / res, "len": ol, "data": data[o + 28:o + 28 + cl], "lt": lt})
            elif t == 3:
                ol = struct.unpack_from(e + "I", data, o + 8)[0]
                lt = ifs[0][0] if ifs else 1
                out["frames"].append({"t": 0.0, "len": ol, "data": data[o + 12:o + 12 + min(ol, ln - 16)], "lt": lt})
            o += ln
        return out
    raise ValueError("无法识别的抓包格式（支持 .pcap / .pcapng）")


def _mac(b, o):
    return ":".join("%02x" % x for x in b[o:o + 6])


def _ip4(b, o):
    return ".".join(str(x) for x in b[o:o + 4])


def _ip6(b, o):
    import ipaddress
    return str(ipaddress.IPv6Address(bytes(b[o:o + 16])))


def _someip(b, o, end, r):
    if end - o < 16:
        return False
    sid, mid, ln = struct.unpack_from(">HHI", b, o)
    pv, mt, rc = b[o + 12], b[o + 14], b[o + 15]
    if pv != 1 or ln < 8 or mt not in SOMEIP_MT:
        return False
    r["proto"] = "SOME/IP-SD" if (sid == 0xFFFF and mid == 0x8100) else "SOME/IP"
    r["someip"] = {"service": sid, "method": mid, "type": SOMEIP_MT[mt], "rc": rc}
    if r["proto"] == "SOME/IP-SD" and end - o >= 28:
        elen = struct.unpack_from(">I", b, o + 20)[0]
        ents, p = [], o + 24
        while p + 16 <= min(end, o + 24 + elen):
            t = b[p]
            svc, inst = struct.unpack_from(">HH", b, p + 4)
            ttl = (b[p + 9] << 16) | (b[p + 10] << 8) | b[p + 11]
            ents.append({"type": SD_ENTRY.get(t, hx(t, 2)) + ("(Stop)" if ttl == 0 and t in (1, 6) else ""), "service": svc, "instance": inst, "ttl": ttl})
            p += 16
        r["someip"]["sd"] = ents
        r["info"] = ", ".join(x["type"] + " " + hx(x["service"], 4) for x in ents)
    else:
        r["info"] = "%s service %s method %s%s" % (SOMEIP_MT[mt], hx(sid, 4), hx(mid, 4), (" rc=%d" % rc) if rc else "")
    return True


def _doip(b, o, end, r):
    if end - o < 8 or (b[o] ^ b[o + 1]) != 0xFF:
        return False
    pt, ln = struct.unpack_from(">HI", b, o + 2)
    if pt not in DOIP:
        return False
    r["proto"] = "DoIP"
    r["doip"] = {"type": pt, "name": DOIP[pt], "len": ln}
    if pt == 0x8001 and end - o >= 13:
        sa, ta = struct.unpack_from(">HH", b, o + 8)
        sidv = b[o + 12]
        if sidv == 0x7F:
            uds = "NRC %s for %s" % (hx(b[o + 14] if end - o > 14 else 0, 2), UDS.get(b[o + 13] if end - o > 13 else 0, hx(b[o + 13] if end - o > 13 else 0, 2)))
        else:
            pos = sidv >= 0x40
            base = sidv - 0x40 if pos else sidv
            uds = UDS.get(base, hx(sidv, 2)) + (" +RSP" if pos else "")
        r["doip"].update(sa=sa, ta=ta, uds=uds)
        r["info"] = "%s→%s %s" % (hx(sa, 4), hx(ta, 4), uds)
    elif pt == 0x0006 and end - o >= 13:
        code = b[o + 12]
        r["doip"]["code"] = code
        r["info"] = "%s code=%s%s" % (DOIP[pt], hx(code, 2), "（成功）" if code == 0x10 else "（失败）")
    else:
        r["info"] = DOIP[pt]
    return True


def decode(f):
    b = f["data"]
    r = {"t": f["t"], "len": f["len"], "proto": "ETH", "info": "", "vlan": []}
    if f["lt"] != 1 or len(b) < 14:
        r["proto"] = "LINK %d" % f["lt"]
        return r
    r["dst"], r["src"] = _mac(b, 0), _mac(b, 6)
    o = 12
    et = struct.unpack_from(">H", b, o)[0]
    o += 2
    while et in (0x8100, 0x88A8) and o + 4 <= len(b):
        tci = struct.unpack_from(">H", b, o)[0]
        r["vlan"].append({"id": tci & 0xFFF, "pcp": tci >> 13})
        et = struct.unpack_from(">H", b, o + 2)[0]
        o += 4
    r["ethertype"] = et
    if et == 0x88F7 and o + 34 <= len(b):
        mt = b[o] & 0x0F
        r["proto"] = "gPTP"
        r["ptp"] = {"type": mt, "name": PTP.get(mt, hx(mt, 1)), "seq": struct.unpack_from(">H", b, o + 30)[0], "domain": b[o + 4]}
        r["info"] = "%s seq=%d" % (r["ptp"]["name"], r["ptp"]["seq"])
        return r
    if et == 0x22F0:
        r["proto"] = "AVTP"
        return r
    if et == 0x88CC:
        r["proto"] = "LLDP"
        return r
    if et == 0x0806:
        r["proto"] = "ARP"
        return r
    if et == 0x88E5:
        r["proto"] = "MACsec"
        return r
    end = len(b)
    if et == 0x0800 and o + 20 <= len(b):
        ihl = (b[o] & 15) * 4
        tot = struct.unpack_from(">H", b, o + 2)[0]
        r.update(ipv=4, sip=_ip4(b, o + 12), dip=_ip4(b, o + 16), proto="IPv4")
        l4 = b[o + 9]
        end = min(len(b), o + tot)
        o += ihl
    elif et == 0x86DD and o + 40 <= len(b):
        r.update(ipv=6, sip=_ip6(b, o + 8), dip=_ip6(b, o + 24), proto="IPv6")
        l4 = b[o + 6]
        end = min(len(b), o + 40 + struct.unpack_from(">H", b, o + 4)[0])
        o += 40
    else:
        r["proto"] = "ETH " + hx(et, 4)
        return r
    if l4 == 6 and o + 20 <= end:
        sp, dp, seq = struct.unpack_from(">HHI", b, o)
        off = (b[o + 12] >> 4) * 4
        fl = b[o + 13]
        pl = max(0, end - o - off)
        r.update(proto="TCP", sp=sp, dp=dp, tcp={"seq": seq, "flags": fl, "payload": pl})
        flags = ",".join(n for bit, n in ((2, "SYN"), (16, "ACK"), (1, "FIN"), (4, "RST"), (8, "PSH")) if fl & bit)
        r["info"] = "%d→%d [%s] len=%d" % (sp, dp, flags, pl)
        p = o + off
        if pl > 0 and 13400 in (sp, dp):
            _doip(b, p, end, r)
        elif pl >= 16:
            _someip(b, p, end, r)
        return r
    if l4 == 17 and o + 8 <= end:
        sp, dp = struct.unpack_from(">HH", b, o)
        r.update(proto="UDP", sp=sp, dp=dp, info="%d→%d len=%d" % (sp, dp, end - o - 8))
        p = o + 8
        if 13400 in (sp, dp):
            _doip(b, p, end, r)
        elif sp in (319, 320) or dp in (319, 320):
            r["proto"] = "PTP/UDP"
        else:
            _someip(b, p, end, r)
        return r
    if l4 in (1, 58):
        r["proto"] = "ICMP" if l4 == 1 else "ICMPv6"
    return r


def analyze(cap):
    pk = [decode(f) for f in cap["frames"]]
    t0 = pk[0]["t"] if pk else 0
    protos, talk, seen, issues, vlans, doip_t, svc = {}, {}, set(), [], {}, {}, {}
    rst = retx = total = 0
    sync, fu, pdreq, pdresp, ann = [], 0, 0, 0, 0
    for i, p in enumerate(pk):
        p["i"], p["rt"] = i + 1, p["t"] - t0
        total += p["len"]
        protos[p["proto"]] = protos.get(p["proto"], 0) + 1
        if "src" in p:
            k = (p["sip"] + " → " + p["dip"]) if "sip" in p else (p["src"] + " → " + p["dst"])
            x = talk.setdefault(k, {"k": k, "n": 0, "bytes": 0})
            x["n"] += 1
            x["bytes"] += p["len"]
        for v in p["vlan"]:
            kk = "%d/PCP%d" % (v["id"], v["pcp"])
            vlans[kk] = vlans.get(kk, 0) + 1
        if "tcp" in p:
            if p["tcp"]["flags"] & 4:
                rst += 1
                p["warn"] = "RST"
            if p["tcp"]["payload"] > 0:
                key = (p["sip"], p["sp"], p["dip"], p["dp"], p["tcp"]["seq"], p["tcp"]["payload"])
                if key in seen:
                    retx += 1
                    p["warn"] = "疑似重传"
                seen.add(key)
        if "ptp" in p:
            t = p["ptp"]["type"]
            if t == 0:
                sync.append(p["t"])
            elif t == 8:
                fu += 1
            elif t == 2:
                pdreq += 1
            elif t == 3:
                pdresp += 1
            elif t == 11:
                ann += 1
        if "doip" in p:
            d = p["doip"]
            doip_t[d["name"]] = doip_t.get(d["name"], 0) + 1
            if d["type"] == 0x0006 and d.get("code") != 0x10:
                p["warn"] = "路由激活失败"
                issues.append({"i": p["i"], "msg": "路由激活失败 code=" + hx(d.get("code", 0), 2)})
            if d["type"] == 0x8003:
                p["warn"] = "诊断否定确认"
                issues.append({"i": p["i"], "msg": "DoIP 诊断否定确认"})
            if str(d.get("uds", "")).startswith("NRC"):
                p["warn"] = d["uds"]
        if "someip" in p:
            s = p["someip"]
            for e in s.get("sd", []):
                kk = hx(e["service"], 4) + "/" + hx(e["instance"], 4)
                x = svc.setdefault(kk, {"k": kk, "offer": 0, "find": 0, "sub": 0, "ack": 0, "stop": 0})
                ty = e["type"]
                x["offer"] += "Offer" in ty
                x["find"] += "Find" in ty
                x["sub"] += bool(re.match(r"^Subscribe(\(|$)", ty))
                x["ack"] += "Ack" in ty
                x["stop"] += "Stop" in ty
            if "sd" not in s and (s["type"] == "ERROR" or s["rc"]):
                p["warn"] = "SOME/IP rc=%d" % s["rc"]
    iv = [(sync[i] - sync[i - 1]) * 1000 for i in range(1, len(sync))]
    avg = sum(iv) / len(iv) if iv else 0
    mx = max(iv) if iv else 0
    gptp = None
    if sync or pdreq:
        gptp = {"sync": len(sync), "followUp": fu, "pdelayReq": pdreq, "pdelayResp": pdresp, "announce": ann, "syncIntervalMs": round(avg, 3), "syncIntervalMaxMs": round(mx, 3)}
        if fu and abs(fu - len(sync)) > 1:
            issues.append({"msg": "Sync(%d) 与 Follow_Up(%d) 数量不一致" % (len(sync), fu)})
        if pdreq and pdresp < pdreq * 0.9:
            issues.append({"msg": "Pdelay_Resp 少于 Pdelay_Req，链路延迟测量可能失败"})
        if avg and mx > avg * 3:
            issues.append({"msg": "Sync 间隔最大 %.2f ms，超过平均值 3 倍（丢同步？）" % mx})
    if rst:
        issues.append({"msg": "TCP RST × %d" % rst})
    if retx:
        issues.append({"msg": "疑似 TCP 重传 × %d" % retx})
    for s in svc.values():
        if s["sub"] and not s["ack"]:
            issues.append({"msg": "SOME/IP 服务 %s 有 Subscribe 但没有 SubscribeAck" % s["k"]})
    return {"format": cap["format"], "truncated": cap["truncated"], "count": len(pk), "bytes": total, "duration": (pk[-1]["t"] - t0) if pk else 0,
            "protos": protos, "talkers": sorted(talk.values(), key=lambda x: -x["bytes"])[:20], "vlans": vlans, "gptp": gptp,
            "doip": doip_t or None, "someipServices": list(svc.values()), "issues": issues, "packets": pk}


def report_markdown(a, name="", focus=None):
    L = ["# 抓包分析：" + name, "", "| 项目 | 值 |", "|---|---|", "| 格式 | %s%s |" % (a["format"], "（已截断）" if a["truncated"] else ""),
         "| 帧数 | %d |" % a["count"], "| 字节 | %d |" % a["bytes"], "| 时长 | %.3f s |" % a["duration"], "", "## 协议分布", "", "| 协议 | 帧数 |", "|---|---:|"]
    for k, v in sorted(a["protos"].items(), key=lambda x: -x[1]):
        L.append("| %s | %d |" % (k, v))
    if a["gptp"] and focus in (None, "gptp"):
        L += ["", "## gPTP", "", "| 项目 | 值 |", "|---|---|"] + ["| %s | %s |" % kv for kv in a["gptp"].items()]
    if a["doip"] and focus in (None, "doip"):
        L += ["", "## DoIP", "", "| 报文 | 数量 |", "|---|---:|"] + ["| %s | %d |" % kv for kv in a["doip"].items()]
        if focus == "doip":
            L += ["", "### 会话时序", "", "| # | 时间 (s) | 方向 | 内容 |", "|---:|---:|---|---|"]
            for p in a["packets"]:
                if "doip" in p:
                    L.append("| %d | %.6f | %s:%s→%s:%s | %s%s |" % (p["i"], p["rt"], p.get("sip"), p.get("sp"), p.get("dip"), p.get("dp"), p["info"], (" **" + p["warn"] + "**") if p.get("warn") else ""))
    if a["someipServices"] and focus in (None, "someip"):
        L += ["", "## SOME/IP-SD 服务", "", "| 服务/实例 | Offer | Find | Subscribe | Ack | Stop |", "|---|---:|---:|---:|---:|---:|"]
        L += ["| %s | %d | %d | %d | %d | %d |" % (s["k"], s["offer"], s["find"], s["sub"], s["ack"], s["stop"]) for s in a["someipServices"]]
    L += ["", "## 发现的问题", ""]
    L += ["- " + ("#%d " % i["i"] if i.get("i") else "") + i["msg"] for i in a["issues"]] or ["- 未发现明显异常"]
    L += ["", "## 主要通信对", "", "| 通信对 | 帧 | 字节 |", "|---|---:|---:|"] + ["| %s | %d | %d |" % (t["k"], t["n"], t["bytes"]) for t in a["talkers"][:10]]
    return "\n".join(L) + "\n"


def summarize_file(path, focus=None):
    with open(path, "rb") as f:
        a = analyze(read_capture(f.read()))
    s = {k: v for k, v in a.items() if k != "packets"}
    s["report"] = report_markdown(a, path, focus)
    return s


# ---------------------------------------------------------------- units
def rate(s):
    if isinstance(s, (int, float)):
        return float(s)
    m = re.match(r"^\s*([\d.]+)\s*([kmgKMG]?)\s*(bps|b/s|bit/s|hz|Hz)?\s*$", str(s or ""))
    if not m:
        raise ValueError("无法解析速率/频率：%r" % s)
    return float(m.group(1)) * {"": 1, "k": 1e3, "m": 1e6, "g": 1e9}[m.group(2).lower()]


def ns(s):
    if isinstance(s, (int, float)):
        return float(s)
    m = re.match(r"^\s*([\d.]+)\s*(ns|us|µs|ms|s)?\s*$", str(s or ""))
    if not m:
        raise ValueError("无法解析时间：%r" % s)
    return float(m.group(1)) * {"ns": 1, "us": 1e3, "µs": 1e3, "ms": 1e6, "s": 1e9}[(m.group(2) or "ns")]


def wire_ns(frame_bytes, link_bps):
    return (frame_bytes + 8 + 12) * 8 / link_bps * 1e9


def _gates(g):
    if isinstance(g, list):
        m = 0
        for q in g:
            m |= 1 << int(q)
        return m
    s = re.sub(r"[^01]", "", str(g))
    return int(s, 2) if len(s) == 8 else int(g) & 0xFF


def gcl_check(m):
    link = rate(m.get("link", "1Gbps"))
    entries = [{"i": i, "dur": ns(e.get("dur", e.get("time"))), "mask": _gates(e.get("gates", e.get("open", 0))), "note": e.get("note", "")} for i, e in enumerate(m.get("entries", []))]
    express = [int(x) for x in m.get("express", [])]
    preempt = [int(x) for x in m.get("preemptable", m.get("preempt", []))]
    max_frame = int(m.get("maxFrame", 1522))
    total = sum(e["dur"] for e in entries)
    cycle = ns(m["cycle"]) if m.get("cycle") else total
    issues = []
    if not entries:
        issues.append({"level": "bad", "msg": "没有门控条目"})
    if m.get("cycle") and total != cycle:
        issues.append({"level": "bad" if total > cycle else "warn", "msg": "条目总时长 %.3f µs ≠ 周期 %.3f µs" % (total / 1000, cycle / 1000)})
    for q in express:
        for p in preempt:
            if p > q:
                issues.append({"level": "warn", "msg": "Preemptable 队列 Q%d 优先级高于 Express 队列 Q%d（手册建议 Express 用高优先级队列）" % (p, q)})
    guard, guard_frag = wire_ns(max_frame, link), wire_ns(min(max_frame, 127), link)
    queues = []
    for q in range(7, -1, -1):
        t, opened, segs = 0.0, 0.0, []
        for e in entries:
            if e["mask"] & (1 << q):
                opened += e["dur"]
                if segs and segs[-1][1] == t:
                    segs[-1][1] = t + e["dur"]
                else:
                    segs.append([t, t + e["dur"]])
            t += e["dur"]
        worst = 0.0
        for k in range(len(segs)):
            nx = segs[(k + 1) % len(segs)]
            gap = nx[0] - segs[k][1] if k + 1 < len(segs) else cycle - segs[k][1] + nx[0]
            worst = max(worst, gap)
        kind = "Express" if q in express else "Preemptable" if q in preempt else ""
        queues.append({"queue": q, "kind": kind, "open_us": opened / 1000, "open_pct": round(opened / cycle * 100, 3) if cycle else 0,
                       "worst_wait_us": (worst if opened else cycle) / 1000, "max_full_frames_per_cycle": int(opened // guard)})
        if opened and opened < guard:
            issues.append({"level": "warn", "msg": "Q%d 每周期开门 %.2f µs，小于一个最大帧 %.2f µs" % (q, opened / 1000, guard / 1000)})
    em = sum(1 << q for q in express)
    need = guard_frag if preempt else guard
    if em and len(entries) > 1:
        for k, e in enumerate(entries):
            if (e["mask"] & em) and not (e["mask"] & ~em & 0xFF):
                prev = entries[k - 1]
                if prev["mask"] & ~em & 0xFF:
                    issues.append({"level": "warn", "msg": "条目 %d（Express 独占窗口）前面紧接条目 %d 仍开着其他队列，没有保护带；建议插入约 %.2f µs 的关门条目" % (e["i"], prev["i"], need / 1000)})
                elif not (prev["mask"] & em) and prev["dur"] < need:
                    issues.append({"level": "warn", "msg": "条目 %d 作为保护带只有 %.2f µs，小于需要的 %.2f µs" % (prev["i"], prev["dur"] / 1000, need / 1000)})
    return {"link_bps": link, "cycle_us": cycle / 1000, "max_frame_wire_us": round(guard / 1000, 4), "guard_band_us": round(need / 1000, 4), "queues": queues, "issues": issues, "ok": not issues}


def cbs(link="1Gbps", bandwidth_pct=None, idle_slope=None, max_frame=1522, max_interference_frame=1522):
    port = rate(link)
    idle = rate(idle_slope) if idle_slope is not None else port * float(bandwidth_pct or 0) / 100
    send = idle - port
    return {"port_bps": port, "idleSlope_kbps": round(idle / 1000), "sendSlope_kbps": round(send / 1000),
            "hiCredit_bits": round(max_interference_frame * 8 * idle / port, 1), "loCredit_bits": round(max_frame * 8 * send / port, 1),
            "bandwidth_pct": round(idle / port * 100, 3)}


def can_timing(clock="80MHz", bitrate="500k", sample_point=80, tq_min=8, tq_max=80, brp_max=1024, tseg1_max=256, tseg2_max=128):
    clk, br, sp = rate(re.sub(r"(?i)hz$", "", str(clock))), rate(re.sub(r"(?i)(hz|bps)$", "", str(bitrate))), float(sample_point) / 100
    out = []
    for brp in range(1, brp_max + 1):
        tq = clk / brp / br
        if tq < tq_min:
            break
        if abs(tq - round(tq)) > 1e-9 or tq > tq_max:
            continue
        n = int(round(tq))
        t1 = int(round(n * sp)) - 1
        t2 = n - 1 - t1
        if t1 < 1 or t2 < 1 or t1 > tseg1_max or t2 > tseg2_max:
            continue
        out.append({"brp": brp, "tq_per_bit": n, "tseg1": t1, "tseg2": t2, "sjw": t2, "sample_point_pct": round((1 + t1) / n * 100, 2), "err": round(abs((1 + t1) / n - sp), 4)})
    out.sort(key=lambda x: (x["err"], -x["tq_per_bit"]))
    return out[:10]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("pcap"); a.add_argument("file"); a.add_argument("--focus", choices=["gptp", "doip", "someip"]); a.add_argument("--json", action="store_true")
    g = sub.add_parser("gcl"); g.add_argument("file")
    c = sub.add_parser("cbs"); c.add_argument("--link", default="1Gbps"); c.add_argument("--bw", type=float, required=True); c.add_argument("--max-frame", type=int, default=1522); c.add_argument("--interference", type=int, default=1522)
    k = sub.add_parser("can"); k.add_argument("--clock", default="80MHz"); k.add_argument("--bitrate", default="500k"); k.add_argument("--sp", type=float, default=80)
    o = ap.parse_args(argv)
    if o.cmd == "pcap":
        s = summarize_file(o.file, o.focus)
        print(json.dumps({k: v for k, v in s.items() if k != "report"}, ensure_ascii=False, indent=1) if o.json else s["report"])
    elif o.cmd == "gcl":
        with open(o.file, encoding="utf-8") as f:
            print(json.dumps(gcl_check(json.load(f)), ensure_ascii=False, indent=1))
    elif o.cmd == "cbs":
        print(json.dumps(cbs(o.link, o.bw, None, o.max_frame, o.interference), ensure_ascii=False, indent=1))
    elif o.cmd == "can":
        print(json.dumps(can_timing(o.clock, o.bitrate, o.sp), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
