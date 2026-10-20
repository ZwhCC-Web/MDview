"""Generate a large mixed Markdown document:  python gen_doc.py 20000 > big20k.md"""
import sys, random
random.seed(1)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
words = '电机 控制 算法 实时 中断 寄存器 采样 补偿 滤波 推理 MCU DFA FPU timer ADC PWM latency throughput buffer pipeline cache'.split()
out = []; sec = 0
while len(out) < N:
    sec += 1
    out += [f'## {sec}. 章节标题 {random.choice(words)}', '']
    for _ in range(3):
        out += [' '.join(random.choice(words) for _ in range(40)) + f' **重点{sec}** 与 `code_{sec}` 以及 [链接](https://example.com/{sec}) $x_{sec}^2$', '']
    out += [f'- 列表项 {i} {random.choice(words)}' for i in range(5)] + ['']
    if sec % 3 == 0:
        out += ['```c'] + [f'int v{i} = adc_read({i}) * k + {i};' for i in range(8)] + ['```', '']
    if sec % 4 == 0:
        out += ['| 参数 | 数值 | 单位 |', '| --- | ---: | :-: |'] + [f'| p{i} | {random.randint(1,999)} | ms |' for i in range(5)] + ['']
    if sec % 5 == 0:
        out += ['> 引用说明 ' + ' '.join(random.choice(words) for _ in range(20)), '']
print('\n'.join(out[:N]))
