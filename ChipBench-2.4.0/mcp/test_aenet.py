"""python mcp/test_aenet.py — tests for aenet.py (same expectations as tests/net.test.js)"""
import pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent; sys.path.insert(0, str(HERE))
import aenet
fails = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
a = aenet.analyze(aenet.read_capture((HERE.parent / 'tests/fixtures/ivn_sample.pcap').read_bytes()))
ok(a['count'] == 29 and a['protos']['gPTP'] == 21, 'pcap read + gPTP count')
ok(a['gptp']['sync'] == 11 and a['gptp']['followUp'] == 10 and any('3 倍' in i['msg'] for i in a['issues']), 'gPTP sync gap')
ok(a['doip']['路由激活响应'] == 1 and a['doip']['诊断报文'] == 3, 'DoIP types')
ok(any(p.get('doip', {}).get('uds') == 'NRC 0x31 for ReadDataByIdentifier' for p in a['packets']), 'UDS NRC')
ok(any('重传' in i['msg'] for i in a['issues']) and any('RST' in i['msg'] for i in a['issues']), 'TCP issues')
ok(a['someipServices'][0]['sub'] == 1 and any('SubscribeAck' in i['msg'] for i in a['issues']), 'SOME/IP-SD')
ok(a['vlans'] == {'10/PCP5': 1}, 'VLAN')
ok('### 会话时序' in aenet.report_markdown(a, 'x', 'doip'), 'doip report')
g = aenet.gcl_check({'link': '1Gbps', 'cycle': '500us', 'express': [7, 6], 'preemptable': [0, 1, 2, 3], 'entries': [{'dur': '100us', 'gates': '11000000'}, {'dur': '390us', 'gates': '00111111'}, {'dur': '10us', 'gates': '00000000'}]})
ok(g['ok'] and g['queues'][0]['open_pct'] == 20 and g['queues'][0]['worst_wait_us'] == 400, 'GCL clean')
g2 = aenet.gcl_check({'cycle': '400us', 'express': [7], 'entries': [{'dur': '100us', 'gates': [7]}, {'dur': '200us', 'gates': [0, 1]}]})
ok(any('总时长' in i['msg'] for i in g2['issues']) and any('保护带' in i['msg'] for i in g2['issues']), 'GCL issues')
c = aenet.cbs('100Mbps', 75)
ok(c['idleSlope_kbps'] == 75000 and c['sendSlope_kbps'] == -25000 and abs(c['hiCredit_bits'] - 9132) < 1 and abs(c['loCredit_bits'] + 3044) < 1, 'CBS')
t = aenet.can_timing('80MHz', '500k', 80)
ok(t and t[0]['sample_point_pct'] == 80 and 80e6 / t[0]['brp'] / t[0]['tq_per_bit'] == 500e3, 'CAN timing')
print('ALL PASS' if not fails else '%d FAILED' % len(fails)); sys.exit(1 if fails else 0)
