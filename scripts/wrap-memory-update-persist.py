#!/usr/bin/env python3
"""wrap-memory-update-persist.py — /wrap Step 4a: find the `### Memory Update` blocks this session's helpers
handed back and report which ones no expert MEMORY carries; `--apply` appends each missing one to its expert's
current shard (MAX END-DATE, never mtime).

Usage:
  python3 scripts/wrap-memory-update-persist.py [--sid <full session id>] [--apply]

Reads each helper transcript under ~/.claude/projects/<repo key>/<sid>/subagents/, takes its SubagentHandback
inputs (the delivered report) or, when there are none, its last text block. Every `Memory Update` heading
counts (`#`-prefixed, numbered like `### 5. Memory Update`, or bold) unless it is the message's first line; the
block under it runs to the next non-dated `#`-`###` heading, a `---` line or a `Memory-load:` line, the first line
under the heading included, and is split into one entry per dated line (`## 2026-10-26 — …`), so a block carrying
two lessons yields two; text above the first dated line is dropped. An entry ends at the blank line after its
`Revisit:` paragraph (what follows is the hand-back's own Files changed / Scratch files / STATUS text) unless a
dated line sits below it. The expert is the agent's `agentType` from its meta.json; a type with no
`.claude/skills/<type>/` directory (general-purpose, Explore, or no meta.json) has no MEMORY and is reported,
never written. Each entry's title (after the date and dash, case and markup folded) is matched against the
`## <date> — <title>` headings in that expert's `MEMORY*.md`: CARRIED on a full-title match; PREFIX when only the
first 30 characters match (printed for a hand read, never appended — a reworded persist or a different lesson
with the same opening); else MISSING. The summary line counts the deep-pass slice agents skipped (they hand back
findings, not lessons) and the helpers that yielded no entry: no Memory Update heading, or only an empty block.
Known limits: a non-dated `#`-`###` sub-heading inside an entry still ends it, and a `####` heading does not; an
entry with no `Revisit:` line runs to its block's end.

Built from an ad-hoc scratch version a wrap ran on 2026-10-27, which found 20 unpersisted blocks;
the tiers, the entry split and the stops came from a tested review patch on an earlier commit.
"""
import glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_status  # noqa: E402  (the harness's project key for this repository, derived; must follow the sys.path line above)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MU_HEAD = re.compile(r'\n(?:#+ ?(?:\d+\.\s*)?|\*\*)Memory Update[^\n]*\n', re.I)
MU_STOP = re.compile(r'\n(?:#{1,3} (?!20\d\d-)|-{3,}[ \t]*\n|Memory-load:)')
ENTRY = re.compile(r'^(?:## |\*\*)?20\d\d-\d\d-\d\d [—-] ', re.M)
# An entry ends at the blank line after its Revisit paragraph; what follows is the hand-back's own text
# (Files changed, Scratch files, STATUS), unless a dated line the entry split missed sits below it.
REVISIT_END = re.compile(r'^(?:\*\*)?Revisit\b.*?(?=\n[ \t]*\n|\Z)', re.M | re.S)

def norm(t):
    return ' '.join(re.sub(r'[`*]', '', t).casefold().split())

def blocks(sub_dir):
    for f in sorted(glob.glob(os.path.join(sub_dir, 'agent-*.jsonl'))):
        try:
            meta = json.load(open(f[:-6] + '.meta.json'))
        except Exception:
            meta = {}
        desc, typ = meta.get('description', ''), meta.get('agentType', '')
        if desc.startswith('Deep-pass slice'):
            yield typ, desc, None; continue
        hand, last = [], ''
        for line in open(f, errors='replace'):
            try:
                rec = json.loads(line)
            except Exception:
                continue
            content = (rec.get('message') or {}).get('content')
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'tool_use' and b.get('name') == 'SubagentHandback':
                    hand.append(b.get('input', {}).get('message', ''))
                if rec.get('type') == 'assistant' and b.get('type') == 'text' and b.get('text'):
                    last = b['text']
        found = False
        for text in (hand or [last]):
            for m in MU_HEAD.finditer(text):
                found = True
                # The leading newline lets MU_STOP test the first line under the heading too.
                body = '\n' + text[m.end():]
                stop = MU_STOP.search(body)
                block = (body[:stop.start()] if stop else body).strip()
                starts = [e.start() for e in ENTRY.finditer(block)] or [0]
                for a, b in zip(starts, starts[1:] + [len(block)]):
                    entry = block[a:b].strip()
                    rv = REVISIT_END.search(entry)
                    if rv and not re.search(r'^(?:#+ |\*\*)?20\d\d-\d\d-\d\d\b', entry[rv.end():], re.M):
                        entry = entry[:rv.end()].rstrip()
                    yield typ, desc, entry
        if not found:
            yield typ, desc, ''

def current_shard(d):
    dated = [p for p in glob.glob(os.path.join(d, 'MEMORY-ARCHIVE-20*.md')) if re.search(r'-\d{4}-\d\d-\d\d\.md$', p)]
    return max(dated, key=lambda p: (p[-13:-3], p[-24:-14])) if dated else os.path.join(d, 'MEMORY.md')

def main(argv):
    sid = argv[argv.index('--sid') + 1] if '--sid' in argv else os.environ.get('CLAUDE_CODE_SESSION_ID', '')
    if not sid:
        print('INSTRUMENT FAILURE: no session id (pass --sid or set CLAUDE_CODE_SESSION_ID)'); return 2
    sub = os.path.join(session_status.project_key_dir(), sid, 'subagents')
    if not os.path.isdir(sub):
        print(f'INSTRUMENT FAILURE: no subagents directory at {sub}'); return 2
    apply, n, missing, skipped, bare = '--apply' in argv, 0, 0, 0, 0
    for typ, desc, body in blocks(sub):
        if body is None:
            skipped += 1; continue
        if body == '':
            bare += 1; continue
        n += 1
        first = body.split('\n', 1)[0]
        m = re.match(r'^(?:## |\*\*)?(20\d\d-\d\d-\d\d [—-] .+?)\**$', first)
        d = os.path.join(ROOT, '.claude/skills', typ)
        if not typ or not os.path.isdir(d):
            print(f'NO-MEMORY  {typ:<24} {desc[:50]}'); continue
        if not m:
            print(f'NO-TITLE   {typ:<24} {desc[:50]} (read it by hand)'); continue
        title = m.group(1)
        key = norm(re.sub(r'^[0-9-]+ [—-] ', '', title))
        corpus = ''.join(open(p, encoding='utf-8', errors='replace').read() for p in glob.glob(d + '/MEMORY*.md'))
        have = [t for t in re.findall(r'^## 20\d\d-\d\d-\d\d [—-] (.+?)\s*$', corpus, re.M)]
        if key in {norm(t) for t in have}:
            print(f'CARRIED    {typ:<24} {title[:70]}'); continue
        near = [t for t in have if norm(t)[:30] == key[:30]]
        if near:
            print(f'PREFIX     {typ:<24} {title[:70]}\n           shares its first 30 chars with: {near[0][:70]} (read both; --apply skips it)'); continue
        missing += 1
        tgt = current_shard(d)
        print(f'MISSING    {typ:<24} {title[:70]} -> {tgt}')
        if apply:
            cur = open(tgt, encoding='utf-8').read()
            sep = '' if cur.endswith('\n\n') else ('\n' if cur.endswith('\n') else '\n\n')
            rest = body.split('\n', 1)[1] if '\n' in body else ''
            open(tgt, 'a', encoding='utf-8').write(sep + '## ' + title + '\n' + rest.rstrip() + '\n')
    print(f'{n} block(s) found · {missing} missing' + (' · appended' if apply and missing else '')
          + f' · {bare} hand-back(s) with no Memory Update heading · {skipped} deep-pass slice(s) skipped')
    if apply and missing:
        print('next: commit these appends, then /wrap Step 6b `node scripts/memory-tier-split.mjs --heal .claude/skills` re-dates, re-indexes and rolls the shards (it skips a dir already dirty when it starts)')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
