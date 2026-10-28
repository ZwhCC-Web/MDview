"""Generate tests/fixtures/ivn_sample.pcap — gPTP + DoIP (with NRC, retransmission, RST) + SOME/IP-SD (Subscribe without Ack)."""
import struct, pathlib
def eth(et, pl, vlan=None): return bytes([1,0x80,0xc2,0,0,0x0e, 2,0,0,0,0,1]) + ((b'\x81\x00' + struct.pack('>H', (vlan[1] << 13) | vlan[0])) if vlan else b'') + struct.pack('>H', et) + bytes(pl)
def ipv4(proto, pl): return bytes([0x45,0]) + struct.pack('>H', 20+len(pl)) + bytes([0,0,0,0,64,proto,0,0,192,168,1,10,192,168,1,20]) + pl
def udp(sp, dp, pl): return struct.pack('>HHHH', sp, dp, 8+len(pl), 0) + pl
def tcp(sp, dp, seq, fl, pl): return struct.pack('>HHII', sp, dp, seq, 0) + bytes([0x50, fl, 0xff, 0xff, 0,0,0,0]) + pl
def ptp(mt, seq): a = bytearray(44); a[0] = 0x10 | mt; a[1] = 2; a[30:32] = struct.pack('>H', seq); return bytes(a)
def doip(pt, pl): return bytes([2, 0xfd]) + struct.pack('>HI', pt, len(pl)) + bytes(pl)
def someip(sid, mid, mt, pl): return struct.pack('>HHI', sid, mid, 8+len(pl)) + bytes([0,1,0,1,1,1,mt,0]) + pl
def sd(entries):
    e = b''.join(bytes([t,0,0,0x10]) + struct.pack('>HH', svc, 1) + bytes([1, ttl>>16 & 255, ttl>>8 & 255, ttl & 255, 0,0,0,0]) for t, svc, ttl in entries)
    return someip(0xffff, 0x8100, 2, bytes([0xc0,0,0,0]) + struct.pack('>I', len(e)) + e + struct.pack('>I', 0))
def frames():
    F = []
    for i in range(10): F += [(i*0.125, eth(0x88f7, ptp(0, i))), (i*0.125+0.0001, eth(0x88f7, ptp(8, i)))]
    F.append((0.5, eth(0x0800, ipv4(6, tcp(50000, 13400, 1, 0x18, doip(0x0005, [0x0e,0x80,0,0,0,0,0]))))))
    F.append((0.51, eth(0x0800, ipv4(6, tcp(13400, 50000, 1, 0x18, doip(0x0006, [0x0e,0x80,0x10,0x01,0x10,0,0,0,0]))))))
    F.append((0.52, eth(0x0800, ipv4(6, tcp(50000, 13400, 20, 0x18, doip(0x8001, [0x0e,0x80,0x10,0x01,0x22,0xf1,0x90]))))))
    F.append((0.53, eth(0x0800, ipv4(6, tcp(50000, 13400, 20, 0x18, doip(0x8001, [0x0e,0x80,0x10,0x01,0x22,0xf1,0x90]))))))
    F.append((0.54, eth(0x0800, ipv4(6, tcp(13400, 50000, 40, 0x18, doip(0x8001, [0x10,0x01,0x0e,0x80,0x7f,0x22,0x31]))))))
    F.append((0.6, eth(0x0800, ipv4(6, tcp(13400, 50000, 99, 0x14, b'')))))
    F.append((0.7, eth(0x0800, ipv4(17, udp(30490, 30490, sd([(1, 0x1234, 3), (6, 0x1234, 3)]))), (10, 5))))
    F.append((0.8, eth(0x0800, ipv4(17, udp(30501, 30502, someip(0x1234, 0x8001, 2, bytes([1,2,3,4])))))))
    F.append((2.0, eth(0x88f7, ptp(0, 10))))  # late Sync -> gap
    return F
def pcap(F):
    out = bytearray(struct.pack('<IHHiIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1))
    for t, f in F:
        s = int(t); us = round((t - s) * 1e6); out += struct.pack('<IIII', s, us, len(f), len(f)) + f
    return bytes(out)
if __name__ == '__main__':
    p = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'ivn_sample.pcap'; p.write_bytes(pcap(frames())); print('wrote', p, p.stat().st_size, 'bytes')
