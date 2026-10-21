#!/usr/bin/env bash
# orchestrator-inject.sh <part> — SessionStart. Delivers the ORCHESTRATOR-ONLY doctrine to the main
# session in ≤9,700-character parts, one part per registered hook entry.
#
# WHY THIS EXISTS:
#   Every non-fork sub-agent receives CLAUDE.md, its @-includes and every unscoped .claude/rules/*.md
#   at launch — 358,986 B ≈ 157k tokens, 94% of a fresh seat's 166.7k starting context, cache-WRITTEN
#   on 176 of 177 dispatches measured 2026-09-03. About 101 KB of that corpus is doctrine only the
#   orchestrator can act on (commit verbs, mail plane, marker prefix, owner register, wrap gates).
#   Measured in a throwaway repo (rig1): a SessionStart hook's output reaches the MAIN session and
#   does NOT reach a dispatched sub-agent; SubagentStart is the mirror channel. So orchestrator-only
#   doctrine lives in .claude/orchestrator/*.md and is delivered HERE, not via CLAUDE.md.
#   ⛔ AT LAUNCH ONLY. A sub-agent's own COMPACTION fires SessionStart(source=compact) INSIDE the agent,
#   with the parent's session_id and no agent_id, so every part below is written into the compacted
#   agent's transcript after its boundary: all 10 agent compactions on 2.1.266-2.1.280 on this box,
#   about 120K chars each (the harness gates out only a delegated-observation agent). Nothing in the
#   payload tells this hook it is in an agent.
#
# CAP (rig2 + rig3, same day): one hook entry delivers 8,000 chars whole and cuts a 143,353-char
#   payload to a stub under 2 KB; separate entries deliver independently. band-o-inject.sh measured the
#   additionalContext cap at 10,000 chars and chunks at 9,700 — same figure here. Parts split on LINE
#   boundaries only; a single line over the cap is its own part and WILL be cut (the smoke arm asserts
#   none exists).
#
# REGISTRATION: settings.json carries REGISTERED entries, `orchestrator-inject.sh 1` .. `<REGISTERED>`.
#   If the sources grow past REGISTERED parts, the LAST delivered part carries a loud OVERFLOW line so
#   the seat reads the sources directly — never silent. The smoke arm asserts parts <= REGISTERED.
#
# SOURCES, in delivery order (a missing file is skipped, not an error):
#   .claude/orchestrator/conventions.md
#   .claude/orchestrator/session-doctrine.md  ← wrap / peer / mail / shard / attribution rows and sections
# NOT here since 2026-09-09: .claude/orchestrator/commit-doctrine.md is delivered by commit-doctrine-inject.sh
#   (PreToolUse) on the first commit-shaped Bash call of each compaction epoch — round two of the exhortation-cut
#   experiment. Re-adding it here doubles it.
#
# Fires on startup | resume | clear | compact — the same re-delivery CLAUDE.md gets. Plain stdout is
# the channel (measured injecting, like session-start.sh). Always exit 0: doctrine must never block a
# session. Escape: SKIP_ORCHESTRATOR_INJECT=1 (session env or settings.json env block).
set -uo pipefail
[[ "${SKIP_ORCHESTRATOR_INJECT:-0}" == "1" ]] && exit 0
PART="${1:-1}"
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
REGISTERED=25
MIN_HEADROOM=5   # the smoke suite goes RED when fewer spare parts than this remain below REGISTERED.
                 # 5, not 3 (2026-09-07): the largest single-commit growth of the
                 # three sources ever measured under this split is +4.68 parts; 3 parts of
                 # runway could overflow on ONE such commit with the previous push green. The suite pins
                 # the same floor independently, so lowering this constant alone is a RED there.
CAP=9700
cat >/dev/null 2>&1 || true   # drain the hook payload; nothing in it is needed
python3 - "$DIR" "$PART" "$REGISTERED" "$CAP" <<'PY' || true
import sys, os
root, part, registered, cap = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
# commit-doctrine.md is deliberately ABSENT from this list — EVENT-delivered by commit-doctrine-inject.sh since 2026-09-09.
# (Keep the list line free of other .md names: the smoke suite extracts the delivered set from that line alone.)
files = ["conventions.md", "session-doctrine.md"]
texts, broken = [], []   # broken: an unreadable or missing source used to emit NOTHING at rc=0
for f in files:
    p = os.path.join(root, ".claude/orchestrator", f)
    try:
        with open(p, encoding="utf8") as fh:
            texts.append(fh.read().rstrip("\n") + "\n")
    except (OSError, UnicodeDecodeError) as e:
        broken.append(f"{f} ({type(e).__name__})")
if broken and texts and part == 1:
    print(f"<!-- ORCHESTRATOR-DOCTRINE DARK: could not read .claude/orchestrator/{', '.join(broken)} — that doctrine is NOT loaded this session; say so before relying on one. -->")
if not texts:
    if part == 1:
        print("<!-- ORCHESTRATOR-DOCTRINE DARK: no .claude/orchestrator/{conventions,session-doctrine}.md found — orchestrator-only rules NOT loaded this session; say so before relying on one. -->")
    sys.exit(0)
body = "\n".join(texts)
HDR_ROOM = 600   # the part header (316) AND the overflow banner (217) both fit under this — the banner is appended after sizing
chunks, cur = [], ""
for ln in body.split("\n"):
    add = ln + "\n"
    if cur and len(cur) + len(add) > cap - HDR_ROOM:
        chunks.append(cur); cur = add
    else:
        cur += add
if cur.strip():
    chunks.append(cur)
n = len(chunks)
# Deliberately AFTER the read and the chunking: n is not known until the corpus is split, and a
# spare part costs ~18 ms interpreter start + ~14 ms read+chunk, so eight spares are ~256 ms against
# ~3,433 ms for all three SessionStart hooks (measured 2026-09-07). Exiting earlier would need a
# second sizing pass to learn n — dearer than the exit it would save.
if part > n:
    sys.exit(0)
hdr = (f"<!-- ORCHESTRATOR-DOCTRINE part {part}/{n} — delivered at SessionStart to the MAIN session only; "
       f"sub-agents never receive it (measured 2026-09-03). "
       f"Sources: .claude/orchestrator/{{conventions,session-doctrine}}.md; the commit doctrine arrives on this window's "
       f"first commit-shaped Bash call (commit-doctrine-inject.sh). If parts are missing, Read the sources. -->\n")
out = hdr + chunks[part - 1]
if part == registered and n > registered:
    out += (f"\n⛔ ORCHESTRATOR-DOCTRINE OVERFLOW: {n} parts needed, {registered} registered in settings.json — "
            f"parts {registered + 1}..{n} were NOT delivered. Read .claude/orchestrator/*.md now and raise "
            f"REGISTERED in orchestrator-inject.sh + settings.json.\n")
sys.stdout.write(out)
PY
exit 0
