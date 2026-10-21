#!/usr/bin/env bash
# PostToolUse hook — warn when any MEMORY.md grows past the size threshold.
#
# Rationale (meta companion + frequency-not-scope fix for memory hygiene):
# the meta skill's MEMORY.md + each expert's MEMORY.md grow monotonically
# without pruning because memory work only happens during explicit /meta runs.
# A size-warn hook surfaces the need for pruning at the write-time boundary
# rather than letting files drift until the next (rare) /meta session.
#
# Thresholds (editable):
#   WARN=600 lines     → soft SCANNABILITY note, does not block. Lines are a proxy
#                        for readability ONLY — they cannot see the real cliff.
#   The urgent tier is BYTE-keyed (skill MEMORY.md), not line-keyed — the 4000-LINE
#   URGENT was retired 2026-08-01 as structurally blind (see the block at ~:99):
#     SKILL_WARN_BYTES=46000     → headroom shrinking, distil when convenient
#     SKILL_CEILING_BYTES=57500  → past the 25k-token per-Read cap. ⛔ NOT "silent truncation":
#                        MEASURED FALSE 2026-08-06. warn-large-tracker-read.sh ARM B matches
#                        .claude/skills/*/MEMORY*.md at the SAME 57500 and emits
#                        permissionDecision:"deny" WITH computed paging coordinates — the agent
#                        is TOLD and handed a tail-first offset. The cost is a paging round-trip
#                        plus a stale index, NOT silent memory loss. Severity correction only:
#                        the files ARE over band and still SHOULD be rolled.
#     SKILL_HARD_BYTES=250000    → at the ~262144 B hard-refusal ceiling
#   BLOCK=-1           → never block (non-blocking by policy; memory work
#                        requires context-rich judgment, shouldn't be a
#                        commit-time gate per meta principle "do memory
#                        work yourself, don't delegate")
#
# Threshold calibration (2026-04-18): raised WARN 400→600 and URGENT 600→1500.
# Re-calibration (2026-05-20): URGENT 1500→2000. Driver: meta/MEMORY.md hit 1504
# lines in normal-evolution use (after two audit waves). Distill
# isn't the right cause-fix every time — sometimes the corpus is legitimately
# load-bearing and 1500 is just the wrong ceiling. New 2000 cap + 1800 distill
# trigger preserves the 200-line "approach URGENT" buffer.
# Re-calibration (2026-05-25): URGENT 2000→3000. Driver: post-2026-05-21-distill
# (1294 lines) grew to 2148 in 4 days = ~213 lines/day at high-velocity sprint.
# Planned distill→1863 buys <2 weeks before URGENT re-breach. A note from
# the 2026-05-21 distill codified the diminishing-returns reality: "Remaining
# bloat is in densely-codified L# lessons that don't compress further without
# losing canonical-source role." L# corpus now 322 entries / 271 distinct
# lessons — each new lesson adds 15-25 lines of evidence. Meta is the single
# most-load-bearing skill (cross-skill orchestration + self-awareness). Same
# rationale as the 2026-05-20 raise, now with stronger evidence. New 3000 cap +
# 2700 distill trigger preserves the 300-line "approach URGENT" buffer.
# Re-calibration (2026-06-09): URGENT 3000→4000 + DROPPED the 2700 approach-nag.
# Reframe — the prior "hits 3000 = cap still wrong, raise again"
# revisit-trigger is SUPERSEDED. The reactive bump-chase (1500→2000→3000) was
# treating a SOFT budget like a cliff. Skill/meta MEMORY are on-demand (loaded
# only when the skill runs) → no HARNESS truncation. Stop reactively chasing
# the line number.
#
# ⛔ CORRECTION (2026-07-31, MEASURED — the clause above was load-bearing-FALSE).
# "On-demand ⇒ no cliff" conflated TWO different caps. On-demand loading escapes
# the always-loaded HARNESS cap (check-memory-budget.sh gates CAP_BYTES bytes) but NOT
# the READ TOOL's own limits, which apply to every file regardless of load mode.
# THREE caps exist, measured this date:
#   1. ~262,144 B (256 KB) → Read HARD-ERRORS, returns ZERO content.
#   2. ~25,000 tokens       → Read returns an ANNOUNCED PARTIAL view.
#   3. 2,000 lines          → the documented default limit.
# Cap 2 binds FIRST for real prose at ~58.8-64.3 KB — a BAND, not a number: the
# boundary moves with content density. MEASURED 2026-07-31 with two built fixtures
# cut from real memory prose: qa-expert 70,000 B -> 29,787 tok (TRUNCATED, 2.350
# B/tok); a second expert's 85,000 B -> 33,050 tok (2.572 B/tok); qa-expert 55,000 B
# -> not truncated. The 61500 threshold below sits inside that band.
# ⛔ THIS LINE PREVIOUSLY READ "~90 KB" AND WAS WRONG BY ~50%. It shipped in the
# same commit that killed the false on-demand-no-cliff premise, carried from an
# estimate the authoring lens tagged UNVERIFIED — and the commit message said so.
# A caveat in a commit message does not restrain the number once it is in the file:
# the sibling hook check-memory-budget.sh then stated 61.5 KB, so two always-loaded
# hooks written the same day carried mutually inconsistent measured boundaries.
# Killed by a review that built the fixtures instead of estimating.
# So a file can be far under both line thresholds and still not be readable whole.
# Measured: qa-expert/MEMORY.md
# at 1,912 lines (under WARN's own successor thresholds) = 404,583 B → hard error;
# 4 expert memories were over cap 1 and unread by their agents for weeks, silently.
# Line count is the WRONG QUANTITY for these caps — bytes/tokens are the real axis.
# Threshold fix + append-order fix tracked separately; this note kills the premise.
# after observing 6 legitimate-content files trigger WARN (meta 573 / qa 566 /
# prompt 401 / performance 599 / legal 388 / saas-architect 374) and 2 long-
# ingrained load-bearing files trigger URGENT (security-expert 1422 with TOC,
# saas-engineer 1275 with per-feature findings). Line count is a proxy for
# staleness — it doesn't correlate with actual stale-to-current ratio (a
# continuous metric with a threshold boundary is
# noisy by design). New thresholds reduce false-positive noise while keeping
# URGENT as a "genuinely out of control" ceiling. Skills that legitimately
# exceed WARN are expected; /meta memory-audit still runs when triage needs.
#
# The hook reads the tool-call payload from stdin (JSON), extracts the
# edited file path, and greps for MEMORY.md. If matched + past threshold,
# prints a warning to stderr (visible in the user's terminal) but exits 0
# so the edit still lands.

set -u

# Model-aimed advisory on PostToolUse. Measured 2026-08-25 in a throwaway rig: bare stderr
# delivers ZERO text to the model on this event; hookSpecificOutput.additionalContext is
# quoted back verbatim. WARN_EMIT_EVENT is REQUIRED — the lib defaults to PreToolUse, which
# is wrong here and would misroute the payload (caught on the first conversion).
# Fallback FIRST, errexit suspended across the source: `.` is a POSIX special builtin, so a
# failed source under `set -e` is FATAL and `|| true` cannot rescue it.
WARN_EMIT_EVENT=PostToolUse
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

WARN=600
# SOFT budget for LINES (2026-06-09). ⛔ Its "no cliff" rationale is CORRECTED
# above (2026-07-31): on-demand loading escapes the HARNESS cap but not the READ
# TOOL's 256 KB hard-error / ~25k-token partial-view caps, which are real cliffs
# and are keyed on BYTES, not lines. Treat any line threshold here as a
# scannability proxy ONLY — it cannot detect the failure that actually fires.
# This number is therefore arbitrary by
# nature; it exists only to flag "this is getting big, distill for scannability
# when convenient." Raised 3000→4000 + dropped the 2700 approach-nag
# (the file was re-nagging ~200 lines below the cap for an owner-judgment task).
# NOTE: the HARD cap with real silent-truncation is the ALWAYS-loaded project
# MEMORY.md — enforced by the SEPARATE check-memory-budget.sh (CAP_BYTES, in bytes).
# Don't conflate the two: that one is a cliff, this one is a budget.
#
# ⛔ URGENT=4000 LINES IS RETIRED (2026-08-01). It was the last
# LINE-keyed cliff predicate in this file and it was structurally blind: skill
# MEMORY.md runs 139-318 B/line, so a 4000-line trigger assumes ~65 B/line and
# fires 3-4x PAST the byte cliff — measured, 22 of 23 capped files never reached
# it. The urgent tier now lives in the SKILL-TIER BYTE BRANCH below, keyed on the
# same numbers the two gates use (check-memory-budget.sh ARM 2 = write side,
# warn-large-tracker-read.sh ARM B = read side). One quantity, one number, three
# instruments — the disagreement a run flagged is what this closes.
# WARN (lines) survives as a pure SCANNABILITY note; it never claimed to be a cliff.
SKILL_WARN_BYTES=46000     # headroom shrinking — distil when convenient
SKILL_CEILING_BYTES=57500  # the 25k-token per-Read cap. NOT silent: warn-large-tracker-read.sh ARM B DENIES here (SKILLMEM_THRESHOLD=57500) with paging coordinates
SKILL_HARD_BYTES=250000    # at/over the Read tool's ~262144 B hard-refusal ceiling

# ── ARCHIVE TIER (2026-08-06, PHASE 1 of the meta memory archive split) ──────────────────────
# MEMORY-ARCHIVE*.md matched NEITHER glob in this hook, so 24 archive files (38 KB-405 KB, six
# already past the hard-refusal ceiling) have been entirely size-unmonitored since 2026-08-01.
# The hot file's own URGENT message prescribes "split into a period-scoped MEMORY-ARCHIVE-*.md"
# — and the thing it prescribes was the one thing this hook could not see.
#
# ⛔ THE HOT THRESHOLDS ARE THE WRONG INSTRUMENT HERE — do not reuse them. An archive is COLD,
# GREP-CONSUMED storage: it is never auto-loaded, no agent is instructed to Read it at
# consultation start, and the codified retrieval path for it is a dir-scoped grep
# (.claude/rules/active-recall.md: "grep the skill DIR, not the file … older bodies are split
# out to MEMORY-ARCHIVE.md"). Judging a 200 KB shard against SKILL_CEILING_BYTES=57500 would fire
# on EVERY legitimate shard by design and on all 24 existing archives — and an always-noisy warn
# is a disabled warn (the reader stops reading, which is how the hot file's own URGENT went
# unactioned across 132 commits). A guard that cannot be satisfied teaches people to ignore it.
#
# So the archive tier is keyed on the two boundaries that still MEAN something for a cold store:
#   ARCHIVE_WARN_BYTES=200000  — the split's OWN cap. A correctly-sized shard is silent and a
#                                shard that has outgrown the split's rule says so.
#   ⛔ THIS WAS 210000 ("the design cap plus ~5% headroom") UNTIL 2026-08-07, AND THE HEADROOM
#   OPENED A 10 KB BLIND BAND THAT THE LIVE CORPUS WAS SITTING IN. `--roll`'s own predicate is
#   `bytes > SHARD_CAP_BYTES` (200,000, memory-tier-split.mjs), so between 200,000 and 210,000 a
#   roll was DUE and this hook said nothing — measured on
#   a meta memory-archive shard at 203,900 B, over cap and silent,
#   while `--roll --dry-run` reported "over cap" for that exact file. The sentence above it
#   ("a shard that has outgrown the split's own rule says so") was therefore load-bearing-FALSE
#   for the only band in which it matters. Two instruments, one quantity, two numbers — the
#   disagreement this file's own URGENT-retirement note says to close.
#   It MUST track SHARD_CAP_BYTES; a hook cannot import a .mjs constant, so re-derive on change:
#     grep -n 'SHARD_CAP_BYTES = ' scripts/memory-tier-split.mjs
#   SKILL_HARD_BYTES (250000)  — REUSED, not re-derived. Past here a Read returns ZERO content,
#                                and that cliff is a property of the Read tool, not of the file's
#                                temperature. One quantity, one number (this file's own doctrine
#                                at the URGENT-retirement note above).
# Only the hard tier matters for the EXPERT archives specifically: they are grep-consumed, so
# being over 250 KB costs nothing until something actually Reads one — at which point it gets
# zero content, silently, which is precisely what the paired read-side guard
# (warn-large-tracker-read.sh ARM B, widened in the same change) now converts into a deliberate
# page. The message below says that rather than crying emergency at a file doing its job.
ARCHIVE_WARN_BYTES=200000  # == SHARD_CAP_BYTES in memory-tier-split.mjs; past this a --roll is DUE

# Read JSON payload from stdin and extract file_path. Tolerate missing
# fields — hook payload shape may vary by tool.
payload=$(cat 2>/dev/null || echo "{}")

# Pull file_path from common locations in the payload schema.
file_path=$(echo "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# ── BASH-CHANNEL REACHABILITY (2026-08-07) ───────────────────────────────────────
# ⛔ THIS HOOK WAS WIRED PostToolUse ON `Edit|Write` ONLY, AND THE SANCTIONED WAY TO
# PERSIST TO A MEMORY FILE IS A BASH APPEND — so every warn below was structurally
# UNREACHABLE on the channel the writes actually use.
#   block-subagent-memory-write.sh DENIES Edit/Write on .claude/skills/*/MEMORY*.md
#   and its own deny reason names `>>` as "the ONE canonical path for MEMORY
#   persistence". An Edit is refused one event earlier; a `cat >> shard.md <<EOF`
#   emits no Edit|Write event at all. The arm was reachable only via the
#   /tmp/claude-meta-mem-allow escape marker — never on the documented path.
# Measured 2026-08-07: the live meta shard sat at 203,900 B against a 200,000 B roll
# cap with BOTH memory hooks emitting 0 bytes / rc=0, while `--roll --dry-run`
# reported "over cap" for that exact file. Two lenses of a 7-lens review found this
# independently; neither found it by reading the threshold, which was also wrong and
# is a separate fix.
# The sibling dup-durable-append-warn.sh is wired on BOTH matchers and already solved
# this; the redirect-target extraction below is ported from it verbatim.
# WHY RE-INVOKE SELF rather than loop the body: the ~95 lines below are verified and
# fleet-wide. Re-invoking with a synthesized Edit-shaped payload leaves them
# byte-identical. No recursion — the synthesized payload always carries a file_path,
# so the re-invoked run takes the normal path on its first branch.
if [[ -z "${file_path:-}" ]]; then
  if command -v jq >/dev/null 2>&1; then
    cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)
  else
    cmd=$(printf '%s' "$payload" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' 2>/dev/null)
  fi
  [[ -n "${cmd:-}" ]] || exit 0
  # Redirect targets: tokens after > or >>, excluding fd-dups like 2>&1.
  targets=$(printf '%s' "$cmd" | grep -oE '>>?[[:space:]]*"?[^"[:space:]|&;><]+' 2>/dev/null | sed -E 's/^>>?[[:space:]]*"?//')
  [[ -n "${targets:-}" ]] || exit 0
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    # Pre-filter so an ordinary Bash redirect costs one case-match rather than a re-invocation
    # subshell. ⚠️ THAT IS NOT THE SAME AS "FREE", and the earlier wording here ("cheap … one
    # case-match") implied ~0. MEASURED: end-to-end ~14 ms on an
    # ordinary Bash call, ~12 ms with a payload carrying no command at all — i.e. ~12 ms is pure
    # PROCESS STARTUP, which no pre-filter can reach, and only ~2 ms is the jq parse. So the honest
    # cost of putting this hook on the Bash matcher is ~12 ms × every Bash call × every seat. Small
    # against typical Bash-tool latency and worth the reachability defect it fixes — but it is a
    # fleet-wide constant, not a rounding error, and the next person weighing another Bash-matcher
    # hook should price it at ~12 ms rather than at zero.
    case "$t" in *MEMORY*.md|*WATCH-TIER*.md|*ADOPTION-QUEUE*.md) ;; *) continue ;; esac
    # ⛔ RESOLVE A RELATIVE TARGET AGAINST THE REPO ROOT. The first version of this port took the
    # sibling's REGEX and left its RESOLUTION behind: dup-durable-append-warn.sh computes a
    # REPO_ROOT (:49) and rebases relative targets onto it (:112-113); this hook had none
    # (`grep -c 'REPO_ROOT|CLAUDE_PROJECT_DIR|show-toplevel'` -> 0, against 20 of 41 hooks that
    # compute a root). It matters because the CANONICAL prescribed append is repo-RELATIVE --
    # `>> .claude/skills/<expert>/MEMORY.md`, the literal in block-subagent-memory-write.sh:131 --
    # so the reachability fix was itself unreachable from any cwd but the repo root, on exactly
    # the path shape the documentation prescribes. MEASURED on a 205,000 B fixture of canonical
    # shape: absolute FIRES · relative from the resolving dir FIRES · relative from elsewhere
    # SILENT. Reproduced here only on the third attempt -- my
    # first probe used an UNDER-cap fixture I had labelled "over" (silent for the right reason),
    # and my second used a path with no leading component, which cannot match the `*/skills/*/`
    # case below for an unrelated reason. Both read as confirmation.
    if [[ ! -f "$t" ]]; then
      _root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
      [[ -n "$_root" && -f "$_root/$t" ]] && t="$_root/$t"
    fi
    printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$t" | bash "${BASH_SOURCE[0]}" || true
  done <<<"$targets"
  exit 0
fi

# Only check the MEMORY tier family: the hot file and its archive shards.
# `*MEMORY-ARCHIVE*.md` is spelled out rather than folding both into `*MEMORY*.md`, which would
# newly admit the project-level MEMORY-INDEX.md — a file this hook has never governed and whose
# budget belongs to check-memory-budget.sh.
IS_ARCHIVE=0
IS_REGISTER=0
case "$file_path" in
  *MEMORY-ARCHIVE*.md) IS_ARCHIVE=1 ;;
  */skills/meta/WATCH-TIER.md|*/skills/meta/WATCH-TIER-PART-[0-9]*.md|*/skills/meta/ADOPTION-QUEUE.md) IS_REGISTER=1 ;;
  *MEMORY.md) : ;;
  *) exit 0 ;;
esac

# Read the file size AFTER the edit already landed (PostToolUse).
if [[ ! -f "$file_path" ]]; then
  exit 0
fi

lines=$(wc -l < "$file_path" 2>/dev/null || echo 0)

# The LINE warn is a SCANNABILITY note for a file a human is expected to skim — it does not apply
# to an archive, which is machine-grepped cold storage that is SUPPOSED to be thousands of lines.
# Firing it there would emit a "consider distilling" nag on every write to a file whose entire
# purpose is to hold what was distilled OUT. (The byte tiers below still govern archives.)
# ⛔ A LIVE REGISTER IS THE SAME CASE, and the exclusion is load-bearing rather than tidiness:
# WATCH-TIER.md is ~213 KB / tens of thousands of lines by design, so without IS_REGISTER here the
# register arm below would ship an unconditional "consider /meta stale" nag on EVERY register
# append — an always-noisy warn is a disabled warn (this file's own archive-tier note says so), and
# the nag would take the MODEL channel (warn_emit) while the actual over-cap message, like every
# byte tier here, goes to stderr only. The register arm's own SAFE smoke case asserts stderr is
# EMPTY at 190,000 B, which a live line warn makes unsatisfiable.
if [[ "$IS_ARCHIVE" -eq 0 && "$IS_REGISTER" -eq 0 && "$lines" -ge "$WARN" ]]; then
  warn_emit <<EOF || true

ℹ️  $file_path is $lines lines (warn threshold $WARN).
   Consider /meta stale on your next session-end.

EOF
fi

# Byte-budget branch (2026-06-01) — the PROJECT auto-loaded index is HARD-capped
# at ~24.4 KiB of CHARACTERS by the harness (bounded 24,964-25,300; gated at 24985 bytes),
# NOT 25600 bytes as this comment read until 2026-08-13 (tail-truncation past it: announced, never itemised). Line count alone
# is blind to this (the breach was 176 lines but 26 KB). Scoped to the auto-loaded
# index. Companion to the PreToolUse gate check-memory-budget.sh (this is the
# PostToolUse warn backstop).
#
# SKILL-TIER BYTE BRANCH (2026-07-31) — this block previously said "skill
# MEMORY.md is not byte-capped" and scoped itself out. MEASURED-FALSE: skill
# memory is not AUTO-loaded, but every expert Reads it at consultation start,
# and the Read tool caps at ~262144 B unbounded AND 25000 TOKENS per call. The
# TOKEN cap is the binding one and it is the SILENT one: over the byte ceiling
# the read HARD-FAILS (loud, zero content); UNDER it but over the token cap the
# read SUCCEEDS PARTIALLY and looks complete. Measured 2026-07-31:
# saas-architect 270285 B -> refused; frontend-developer 261840 B -> returned
# 214 of 1069 lines. So "just under the byte ceiling" is the WORSE state, and
# the existing line thresholds (WARN 600 / URGENT 4000) cannot see either:
# these files run 192-263 B/line, but a 4000-line trigger against a 262144 B
# ceiling assumes 65 B/line, so it fires ~3-4x PAST the cliff. The four
# breached files sit at 26-47% of the line trigger. Thresholds below are
# token-derived (~2.46 B/token, measured on saas-architect: 270285 B =
# 109792 tok). Warn-mode; the blocking PreToolUse gate is a follow-up
# after an observation window.
case "$file_path" in
  */skills/meta/WATCH-TIER.md|*/skills/meta/WATCH-TIER-PART-[0-9]*.md|*/skills/meta/ADOPTION-QUEUE.md)
    # ⛔ RE-KEYED 2026-10-10.
    # The approach tier below keyed on ONE file at >= 198,000 B. A later sharding (a
    # 57,500 B part cap) split the register into WATCH-TIER.md + WATCH-TIER-PART-NN.md, each ~51 KB,
    # so that tier could no longer fire and the retire sweep lost its only routine caller. For a
    # WATCH-TIER part the predicate is now the sweep's own DUE NOW count (bare mode, read-only — its
    # only writes are inside --apply). Fallback, summed part bytes in the written file's dir against
    # the shard cap, ONLY when the sweep cannot answer for this path: node absent; the path is not
    # <root>/.claude/skills/meta with a scripts/watch-tier-retire-sweep.mjs at <root> (the sweep reads
    # that cwd-relative dir and nothing else, so running it for any other tree would report a
    # DIFFERENT register); or the run failed. The message names the predicate that fired, and both of its lines go
    # through warn_emit — stderr AND one additionalContext document — because this header measured bare stderr reaching
    # no model on PostToolUse (a review finding). The register's line warn is off (IS_REGISTER), so that is
    # the only document. The byte tiers here stay stderr-only.
    # COST: ~0.1 s per write to a WATCH-TIER part and nothing elsewhere — every other path left at
    # the file-selection case above, and a Bash call reaches here only through the register pre-filter.
    # ADOPTION-QUEUE.md and the >= cap tier are unchanged.
    # A live register is kept WHOLE by design, so `--roll` is a no-op here and the
    # ARCHIVE arm's "roll a new dated shard" advice is wrong for this path — the
    # remedy is CURATION (WATCH-TIER.md's AGE RULE + the archive's revival rule).
    # ⛔ AND THE REMEDY MUST NAME A PREDICATE THAT CAN RETURN NON-ZERO. Until 2026-09-13 this
    # arm said "run the AGE RULE curation pass" and that pass's own first branch had become
    # UNREACHABLE — it needs occurrences 1 AND past the 60-day horizon AND no `retire-if:` of its
    # own, and every row gained a date on 2026-09-13, so the third conjunct is false for every row
    # permanently. An operator following this line got ZERO and concluded the register was clean:
    # a permanent alarm whose prescribed remedy is a verified no-op, which is the shape the
    # 2026-08-25 review rejected. It now names the sweep that READS the date field, which is a live
    # predicate — measured the day it shipped: 0 retirable today, 26 within 7 days (29,532 B),
    # 107 within 30 (80,723 B), against a 224,381 B live register.
    # Warn-only; the register is append-only via `>>` (block-subagent-
    # memory-write.sh forces that), which is the channel this hook already watches.
    bytes=$(wc -c < "$file_path" 2>/dev/null || echo 0)
    if [[ "$bytes" -ge "$ARCHIVE_WARN_BYTES" ]]; then
      echo "⚠️  REGISTER OVER SHARD CAP: $file_path is $bytes bytes, past the ${ARCHIVE_WARN_BYTES} B SHARD_CAP_BYTES. A --roll CANNOT cut a named live register that has NO part cap (ADOPTION-QUEUE.md today; WATCH-TIER has a part cap and is SHARDED by the roll, so its parts never reach this branch), so memory-tier-split.mjs will report REGISTER-OVER-CAP and REFUSE to refresh the meta router — every entry appended since the last roll is then absent from the router's digest index and a grep of MEMORY.md alone MISSES it. Remedy is CURATION: apply this file's AGE RULE (the paragraph under its first heading), then node scripts/memory-tier-split.mjs --roll .claude/skills/meta --force" >&2
    elif [[ "$file_path" == */WATCH-TIER*.md ]]; then
      _wt_tail="Run the retire-if sweep BEFORE the next append (\`node scripts/watch-tier-retire-sweep.mjs\`, then \`--apply\`), not after. It reads each row's own expiry and excludes promote-due rows; the AGE RULE's 60-day branch alone is unreachable now that every row carries a date."
      case "$file_path" in /*) _wt_abs="$file_path" ;; *) _wt_abs="$PWD/$file_path" ;; esac
      _wt_root=""; _wt_due=""; _wt_why=""
      case "$_wt_abs" in */.claude/skills/meta/WATCH-TIER*.md) _wt_root="${_wt_abs%/.claude/skills/meta/*}" ;; esac
      # Only THIS hook's own tree: a payload path must never choose which script the hook executes (security).
      _wt_self="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd -P)"
      [[ -z "$_wt_root" ]] || _wt_root="$(cd "$_wt_root" 2>/dev/null && pwd -P)"
      if ! command -v node >/dev/null 2>&1; then
        _wt_why="node is unavailable"
      elif [[ -z "$_wt_root" || ! -f "$_wt_root/scripts/watch-tier-retire-sweep.mjs" ]]; then
        _wt_why="no <root>/.claude/skills/meta + scripts/watch-tier-retire-sweep.mjs for this path, and the sweep reads only that register"
      elif [[ "$_wt_root" != "$_wt_self" ]]; then
        _wt_why="the path is outside this hook's own tree, and the hook runs no other tree's sweep"
      else
        _wt_out=$(cd "$_wt_root" && GIT_OPTIONAL_LOCKS=0 node scripts/watch-tier-retire-sweep.mjs 2>/dev/null); _wt_rc=$?
        _wt_due=$(printf '%s\n' "$_wt_out" | grep -m1 '^  DUE NOW  ' | awk '{print $NF}')
        case "$_wt_rc:$_wt_due" in 0:[0-9]*) case "$_wt_due" in *[!0-9]*) _wt_due="" ;; esac ;; *) _wt_due="" ;; esac
        [[ -n "$_wt_due" ]] || _wt_why="the sweep exited $_wt_rc with no readable DUE NOW count"
      fi
      if [[ -n "$_wt_due" ]]; then
        if [[ "$_wt_due" -gt 0 ]]; then
          warn_emit "ℹ️  $file_path — predicate fired: the retire-if sweep reports DUE NOW $_wt_due (read-only run by this hook). $_wt_tail" || true
        fi
      else
        _wt_sum=0
        for _wt_p in "${file_path%/*}"/WATCH-TIER.md "${file_path%/*}"/WATCH-TIER-PART-[0-9]*.md; do
          [[ -f "$_wt_p" ]] && _wt_sum=$(( _wt_sum + $(wc -c < "$_wt_p") ))
        done
        if [[ "$_wt_sum" -ge "$ARCHIVE_WARN_BYTES" ]]; then
          warn_emit "ℹ️  $file_path — predicate fired: FALLBACK, the WATCH-TIER parts beside it sum to $_wt_sum bytes, at/over the ${ARCHIVE_WARN_BYTES} B shard cap (DUE NOW unread: $_wt_why). $_wt_tail" || true
        fi
      fi
    elif [[ "$bytes" -ge 198000 ]]; then
      echo "ℹ️  $file_path is $bytes bytes — within 2,000 B of the ${ARCHIVE_WARN_BYTES} B shard cap. Run the retire-if sweep BEFORE the next append (\`node scripts/watch-tier-retire-sweep.mjs\`, then \`--apply\`), not after. It reads each row's own expiry and excludes promote-due rows; the AGE RULE's 60-day branch alone is unreachable now that every row carries a date." >&2
    fi
    ;;
  */skills/*/MEMORY-ARCHIVE*.md)
    bytes=$(wc -c < "$file_path" 2>/dev/null || echo 0)
    if [[ "$bytes" -ge "$SKILL_HARD_BYTES" ]]; then
      echo "" >&2
      echo "⚠️  ARCHIVE OVER READ-CEILING: $file_path is $bytes bytes — past the Read tool's ~262144 B hard-refusal ceiling, so a Read of this shard returns ZERO content. That is survivable ONLY while it stays grep-only (grep the skill DIR, never Read the archive). If anything needs to Read it, re-cut it into <=200 KB date-ranged shards — ALREADY-SHARDED dir (a sibling MEMORY.md carrying a shard manifest): node scripts/memory-tier-split.mjs --roll ${file_path%/*} · CLASSIC single-archive dir: node scripts/memory-tier-split.mjs <skill>" >&2
      echo "" >&2
    # ⛔ `-gt`, NOT `-ge` — MATCH THE ROLL'S PREDICATE EXACTLY. rollLayout fires on
    # `bytes(p.text) > shardCap` (STRICTLY greater). At exactly 200,000 B a `-ge` here warns
    # while `--roll` declines with "every file is within cap" — a one-byte window where the
    # instrument prescribes a command that does nothing, which is the "one quantity, two
    # numbers" defect this whole threshold arc exists to close, reappearing at the boundary.
    # ⚠️ THE OPERATOR IS PRE-EXISTING; THE DISAGREEMENT IS MINE. While ARCHIVE_WARN_BYTES was
    # 210,000 the two predicates could never coincide, so `-ge` vs `>` was unreachable.
    # Aligning the numbers is what made it live — fixing one defect armed another.
    elif [[ "$bytes" -gt "$ARCHIVE_WARN_BYTES" ]]; then
      echo "ℹ️  $file_path is $bytes bytes — past the ${ARCHIVE_WARN_BYTES} B shard budget (design cap 200 KB). Roll a new dated shard before it reaches the ${SKILL_HARD_BYTES} B Read-refusal ceiling: node scripts/memory-tier-split.mjs --roll ${file_path%/*}" >&2
    fi
    ;;
  */skills/*/MEMORY.md)
    bytes=$(wc -c < "$file_path" 2>/dev/null || echo 0)
    # ⛔ 61500 -> 57500 (2026-08-01). The old number sat INSIDE the measured cliff
    # BAND (58,750-64,300 B), so it could only fire once truncation may ALREADY be
    # happening. 57,500 sits just BELOW the band's lower edge — the margin is the
    # point, and it is the same number the two gates enforce. Do not "correct" it
    # back toward the measured cliff: a warn that fires at the cliff is a warn that
    # arrives late.
    if [[ "$bytes" -ge "$SKILL_HARD_BYTES" ]]; then
      echo "" >&2
      echo "⚠️  URGENT (BYTES): $file_path is $bytes bytes — at/over the Read tool's ~262144 B ceiling. An expert instructed to read this at consultation start gets a HARD REFUSAL and silently falls back to a partial read. Split the oldest entries into a period-scoped MEMORY-ARCHIVE-*.md NOW." >&2
      echo "" >&2
    elif [[ "$bytes" -ge "$SKILL_CEILING_BYTES" ]]; then
      echo "" >&2
      echo "⚠️  OVER-BAND (paging round-trip, NOT silent loss): $file_path is $bytes bytes (~$((bytes*1000/2460)) tok) — past the Read tool's 25000-token per-call cap (~${SKILL_CEILING_BYTES} B). An UNBOUNDED Read is DENIED by warn-large-tracker-read.sh ARM B at this same threshold, which hands back computed paging coordinates — the reader is TOLD, not silently truncated (that premise was MEASURED FALSE 2026-08-06). Real cost: a paging round-trip plus a stale index. Still worth rolling — run: node scripts/memory-tier-split.mjs <skill> — moves cold entry BODIES to MEMORY-ARCHIVE.md, keeps dated digests in MEMORY.md." >&2
      echo "" >&2
    elif [[ "$bytes" -ge "$SKILL_WARN_BYTES" ]]; then
      echo "ℹ️  $file_path is $bytes bytes (warn ${SKILL_WARN_BYTES}; read-ceiling ${SKILL_CEILING_BYTES} — past that an unbounded Read of it is DENIED with paging coordinates, so the expert pays a round-trip rather than silently reading a PREFIX). Distil when convenient: node scripts/memory-tier-split.mjs <skill>" >&2
    fi
    ;;
  */project-memory/MEMORY.md|*/memory/MEMORY.md)
    bytes=$(wc -c < "$file_path" 2>/dev/null || echo 0)
    # 24985 = 24.4 KiB x 1024 off a ROUNDED banner; the harness counts CHARACTERS and its cliff is only
    # BOUNDED, 24,964-25,300 (measured
    # 2026-08-13). This arm gated 25600 until then — 615 above the cliff — so it stayed quiet
    # on a file the harness was already truncating. bytes >= chars, so a byte test at the
    # character number errs strict and can never permit an overrun.
    if [[ "$bytes" -ge 24985 ]]; then
      echo "" >&2
      echo "⚠️  URGENT (BYTES): $file_path is $bytes bytes — past the 24985-byte gate (the harness cliff is ~24.4 KiB of CHARACTERS); past that cliff the harness truncates the tail and says so, but never WHICH rows (vendor reference_* pointers drop). Move topical pointers to MEMORY-INDEX.md or prune NOW." >&2
      echo "" >&2
    elif [[ "$bytes" -ge 18432 ]]; then
      echo "ℹ️  $file_path is $bytes bytes (warn 18KB; gate 24985 B; harness cliff ~24.4 KiB of chars). Keep topical pointers in the cold MEMORY-INDEX.md." >&2
    fi
    ;;
esac

# Always exit 0 — this is a surfacing hook, not a gate.
exit 0
