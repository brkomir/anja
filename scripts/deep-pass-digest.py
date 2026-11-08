#!/usr/bin/env python3
"""Build the digest a deep-pass slice helper reads: one `L<n>` entry per transcript record.

The default deep pass hands each slice helper this digest instead of the raw slice. The helper
reads it WHOLE, then opens a raw line by its number only where a cut body decides a finding.
Measured on 4 stretches: 24 planted faults, digest + ask caught 20 at 2 of 3 reps, the raw light
slice 0; every planted fault sat where the digest keeps text, so faults deep inside a long output
stay untested.

What it keeps: owner speech, assistant text and thinking whole; each tool call's first and last
1,500 characters; each tool result's first and last 600; a non-owner queued command's first 1,200;
a compaction summary's first 1,200; harness meta text (a skill body, a hand-back notice) its first 200, in either content shape. Attachments that are not queued commands and system records
are dropped. The `L<n>` numbers are the input file's own line numbers, so `sed -n '<n>p'` on the
same file opens the raw record.

Usage: deep-pass-digest.py IN FIRST LAST OUT
  IN     the stripped transcript the pass slices ($TXT)
  FIRST  first line of the slice, 1-based
  LAST   last line of the slice, inclusive
  OUT    the digest file to write (mode 0600: it holds transcript text)
Prints one line: digest: lines <first>-<last read>, <records> records, <entries> entries, <capped> bodies capped, <bytes> B
Exit 2, printing why and leaving no file, on bad arguments, a range that holds no record, or a
record the reader cannot walk (a nesting past Python's recursion limit). Prints no transcript text.
"""
import json
import os
import sys

CALL = 1500
RES = 600
Q = 1200


def cap(s, head, tail=0):
    if len(s) <= head + tail:
        return s
    return s[:head] + f" …[{len(s) - head - tail} chars cut]… " + (s[-tail:] if tail else "")


def flat(o):
    if isinstance(o, str):
        return o
    if isinstance(o, dict):
        return " ".join(f"{k}={flat(v)}" for k, v in o.items())
    if isinstance(o, list):
        return " ".join(flat(v) for v in o)
    return str(o)


def result_text(b):
    x = b.get("content")
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return " ".join(y.get("text", "") for y in x if isinstance(y, dict))
    return ""


def one_line(s):
    return s.replace("\r", " ").replace("\n", " ⏎ ")


def entries(r):
    t = r.get("type")
    m = r.get("message") if isinstance(r.get("message"), dict) else {}
    c = m.get("content")
    out = []
    if t == "assistant" and isinstance(c, list):
        for b in c:
            if not isinstance(b, dict):
                continue
            k = b.get("type")
            if k == "text":
                out.append(("text", b.get("text", "")))
            elif k == "thinking":
                out.append(("thinking", b.get("thinking") or "[redacted]"))
            elif k == "tool_use":
                out.append(("call " + str(b.get("name")), cap(flat(b.get("input")), CALL, CALL)))
    elif t == "user":
        if r.get("isCompactSummary"):
            out.append(("summary", cap(c if isinstance(c, str) else flat(c), Q)))
        elif isinstance(c, str):
            meta = bool(r.get("isMeta"))
            out.append(("meta" if meta else "owner", cap(c, 200) if meta else c))
        elif isinstance(c, list):
            for b in c:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_result":
                    out.append(("result" + (" err" if b.get("is_error") else ""), cap(result_text(b), RES, RES)))
                elif b.get("type") == "text":
                    meta = bool(r.get("isMeta"))
                    t = b.get("text", "")
                    out.append(("meta" if meta else "owner", cap(t, 200) if meta else t))
    elif t == "attachment":
        a = r.get("attachment") or {}
        if a.get("type") == "queued_command":
            p = a.get("prompt")
            p = p if isinstance(p, str) else flat(p)
            human = (a.get("origin") or {}).get("kind") == "human"
            out.append(("owner queued" if human else "queued", p if human else cap(p, Q)))
    return out


def main(argv):
    if len(argv) != 4:
        print("digest: refused, usage: deep-pass-digest.py IN FIRST LAST OUT")
        return 2
    src, first, last, dst = argv
    try:
        first, last = int(first), int(last)
    except ValueError:
        print("digest: refused, FIRST and LAST must be line numbers")
        return 2
    if first < 1 or last < first:
        print(f"digest: refused, bad range {first}-{last}")
        return 2
    if not os.path.isfile(src):
        print("digest: refused, input file not found")
        return 2
    tmp = dst + ".part"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)  # O_CREAT's mode binds only a new file; a stale .part keeps its own
    try:
        records, entries_n, capped = write_digest(src, first, last, fd)
    except Exception as e:  # RecursionError on a deeply nested record, OSError on a full disk
        os.remove(tmp)
        print(f"digest: refused, {type(e).__name__} reading lines {first}-{last}")
        return 2
    if records == 0:
        os.remove(tmp)
        print(f"digest: refused, no record in lines {first}-{last}")
        return 2
    os.replace(tmp, dst)
    print(f"digest: lines {first}-{first + records - 1}, {records} records, {entries_n} entries, {capped} bodies capped, {os.path.getsize(dst)} B")
    return 0


def write_digest(src, first, last, fd):
    records = entries_n = capped = 0
    with open(src, encoding="utf-8", errors="replace") as f, os.fdopen(fd, "w", encoding="utf-8") as w:
        w.write(f"-- digest of transcript lines {first}-{last}: name a region by its L<n> numbers, never this file's own line numbers --\n")
        for n, line in enumerate(f, 1):
            if n < first:
                continue
            if n > last:
                break
            records += 1
            try:
                r = json.loads(line)
            except ValueError:
                w.write(f"L{n} unparsed\n")
                continue
            if not isinstance(r, dict):
                w.write(f"L{n} unparsed\n")
                continue
            for kind, text in entries(r):
                capped += " chars cut]… " in text
                entries_n += 1
                w.write(f"L{n} {kind}: {one_line(text)}\n")
        w.write(f"-- end: lines {first}-{first + records - 1}, {records} records, {entries_n} entries, {capped} bodies capped --\n")
    return records, entries_n, capped


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
