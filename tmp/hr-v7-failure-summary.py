from pathlib import Path
import re
text=Path('output/ees-hr-v7/full-tests.txt').read_text(encoding='utf-8-sig')
for marker in ['Buew conflicting services','status thresholds and impossible']:
    start=text.rfind('✖ '+marker)
    end=text.find('\ntest at ',start+1)
    block=text[start:end if end!=-1 else start+3000]
    print(block[:2500])
