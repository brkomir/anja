#!/usr/bin/env python3
"""Census of L<n> glosses INSIDE inline backtick code spans, over the git blobs at a ref.
Usage: python3 gloss-span-census.py <ref> [<ref> ...]
Population: every file tracked at <ref> whose path ends in one of EXT (text corpora only).
Span: a single-line backtick span, regex  `[^`\n]+`   (fenced blocks are not spans; a span may not cross a line).
Gloss: inside such a span, the pattern  \bL\d+ \((?:[^()\n]|\([^()\n]*\))*\)  — an L-number followed by a
parenthesised gloss, one nested paren level allowed. Counts SPANS (a span with two glosses counts once)."""
import re,subprocess,sys
EXT=('.md','.txt','.ts','.tsx','.mts','.mjs','.js','.sh','.py','.json','.yml','.yaml')
SPAN=re.compile(r'`[^`\n]+`'); GLOSS=re.compile(r'\bL\d+ \((?:[^()\n]|\([^()\n]*\))*\)')
def census(ref):
    paths=[p for p in subprocess.run(['git','ls-tree','-r','--name-only',ref],capture_output=True,text=True,check=True).stdout.split('\n') if p.endswith(EXT)]
    inp='\n'.join(f'{ref}:{p}' for p in paths)+'\n'
    out=subprocess.run(['git','cat-file','--batch'],input=inp.encode(),capture_output=True,check=True).stdout
    i=0;n=0;files={}
    for p in paths:
        j=out.index(b'\n',i); hdr=out[i:j].decode(errors='replace').split()
        if hdr[-1]=='missing': i=j+1; continue
        size=int(hdr[2]); body=out[j+1:j+1+size]; i=j+1+size+1
        try: t=body.decode('utf-8')
        except UnicodeDecodeError: continue
        c=sum(1 for m in SPAN.finditer(t) if GLOSS.search(m.group(0)))
        if c: files[p]=c; n+=c
    return n,len(paths),files
for ref in sys.argv[1:]:
    n,pop,files=census(ref)
    print(f'{ref}: glossed code spans = {n}  (population: {pop} tracked text files; {len(files)} files carry one)')
