# static sanity checks (no Rust toolchain in this environment): proper tokenizer for brace balance, every #[tauri::command] registered exactly once
import re,glob,sys
def braces(s):
    i=0;n=len(s);o=c=0
    while i<n:
        ch=s[i]
        if s.startswith('//',i): i=s.find('\n',i); i=n if i<0 else i; continue
        if s.startswith('/*',i): i=s.find('*/',i)+2; continue
        if ch=='r' and re.match(r'r#*"',s[i:i+4]) and (i==0 or not (s[i-1].isalnum() or s[i-1]=='_')):
            m=re.match(r'r(#*)"',s[i:]); end='"'+m.group(1); j=s.find(end,i+len(m.group(0))); i=j+len(end); continue
        if ch=='"':
            i+=1
            while s[i]!='"': i+=2 if s[i]=='\\' else 1
            i+=1; continue
        if ch=="'":
            m=re.match(r"'(?:\\.[^']*|[^'\\])'",s[i:])
            if m: i+=len(m.group(0)); continue
        if ch=='{': o+=1
        elif ch=='}': c+=1
        i+=1
    return o,c
import os; os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src-tauri'))
bad=0; reg=open('src/main.rs',encoding='utf-8').read(); h=reg[reg.index('generate_handler'):]; cmds=set()
for f in sorted(glob.glob('src/*.rs')):
    s=open(f,encoding='utf-8').read(); o,c=braces(s)
    if o!=c: print('UNBALANCED',f,o,c); bad+=1
    for m in re.finditer(r'#\[tauri::command[^\]]*\]\s*pub fn (\w+)',s): cmds.add((f[4:-3],m.group(1)))
reg_set=set(re.findall(r'(\w+)::(\w+)',h))-{('tauri','generate_context')}
print('commands',len(cmds),'registered',len(reg_set))
if cmds-reg_set: print('NOT REGISTERED',cmds-reg_set); bad+=1
if reg_set-cmds: print('UNKNOWN',reg_set-cmds); bad+=1
sys.exit(bad)
