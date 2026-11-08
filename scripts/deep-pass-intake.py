#!/usr/bin/env python3
"""Print what a deep pass's helpers actually took in, measured from their own transcripts.

A helper's `Unscanned regions: none` is its own claim. This line is the number it cannot author:
the characters its tool results returned, summed over the pass's slice helpers, against the bytes
the pass was meant to cover. It reads, prints and exits; nothing gates on it (the pass-return
gate stays, and this line sits beside it).

Usage: deep-pass-intake.py --slices N --bytes B [--since EPOCH] [--sid SID] [--subagents-dir DIR]
  --slices   how many slice helpers this pass dispatched
  --bytes    the stripped bytes the pass covered
  --since    the pass's start: count every helper newer than this, replacements and top-ups included
Prints: intake: <N> helpers, <X> MB returned of <Y> MB (<p>%), median <M> chars a helper
Exit 0 on a printed line. Exit 2, printing why, when it cannot count N finished slice helpers or
cannot read one's transcript: a wrong number here would read as a measurement.

A slice helper is a finished sub-agent described `Deep-pass slice <id>`, the form the dispatch step
requires and wrap-reconcile keys on. Without --since the helpers are the N newest, which reach back
into an earlier pass in the same session after a replacement, a top-up or a pass named another way;
the line then says how many it chose from. The count includes the brief each helper read; about
24,000 chars of each helper's figure is that brief.
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys

# wrap-reconcile.mjs DP_SLICE_ID_RE, without the id: a bare "slice" also takes triage and sweep waves.
PASS_SLICE = re.compile(r"\bdeep[- ]?(?:pass|scan)\b.*?\bslices?\b", re.I)


def tool_result_chars(path):
    """Return (chars, readable): readable is False when no record parsed or a result has a new shape."""
    chars = records = strange = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not isinstance(rec, dict):
                continue
            records += 1
            message = rec.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                body = block.get("content")
                if isinstance(body, str):
                    chars += len(body)
                elif isinstance(body, list):
                    chars += sum(len(x.get("text") or "") for x in body if isinstance(x, dict))
                elif body is not None:
                    strange += 1
    return chars, records > 0 and strange == 0


def slice_helpers(directory, since=None):
    found = []
    for meta in glob.glob(os.path.join(directory, "agent-*.meta.json")):
        try:
            with open(meta, encoding="utf-8") as f:
                info = json.load(f)
        except (OSError, ValueError):
            continue
        if not PASS_SLICE.search(str(info.get("description", ""))) or not info.get("finished"):
            continue
        transcript = meta[: -len(".meta.json")] + ".jsonl"
        if os.path.isfile(transcript) and (since is None or os.path.getmtime(transcript) >= since):
            found.append((os.path.getmtime(transcript), transcript))
    return [path for _, path in sorted(found, reverse=True)]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--slices", type=int, required=True)
    ap.add_argument("--bytes", type=int, required=True)
    ap.add_argument("--since", type=float)
    ap.add_argument("--sid", default=os.environ.get("CLAUDE_CODE_SESSION_ID", ""))
    ap.add_argument("--subagents-dir")
    a = ap.parse_args()
    if a.slices < 1 or a.bytes < 1:
        print("intake: refused, --slices and --bytes must be positive")
        return 2
    directory = a.subagents_dir
    if not directory:
        if not a.sid:
            print("intake: refused, no session id")
            return 2
        cwd_key = os.getcwd().replace("/", "-")
        directory = os.path.expanduser(f"~/.claude/projects/{cwd_key}/{a.sid}/subagents")
    helpers = slice_helpers(directory, a.since)
    if len(helpers) < a.slices:
        print(f"intake: refused, found {len(helpers)} finished slice helper(s), expected {a.slices}, in {directory}")
        if not a.subagents_dir and re.fullmatch(r"[0-9a-f]{8}", a.sid or ""):
            print("intake: --sid looks like the 8-character short form; the folder is named by the full session id")
        return 2
    chosen = helpers if a.since is not None else helpers[: a.slices]
    results = [tool_result_chars(p) for p in chosen]
    unread = sum(1 for _, readable in results if not readable)
    if unread:
        print(f"intake: refused, {unread} of {len(chosen)} helper transcript(s) could not be read")
        return 2
    counts = [chars for chars, _ in results]
    total = sum(counts)
    spread = f" (newest of {len(helpers)} found, may span an earlier pass)" if len(helpers) > len(chosen) else ""
    print(
        f"intake: {len(chosen)} helpers{spread}, {total / 1e6:.2f} MB returned of {a.bytes / 1e6:.2f} MB "
        f"({100 * total / a.bytes:.1f}%), median {int(statistics.median(counts))} chars a helper"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
