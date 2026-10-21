#!/usr/bin/env bash
# dup-durable-append-warn.sh — PreToolUse Edit + Bash hook.
#
# Warns when an Edit or Bash-heredoc append ADDS an entry whose identifying
# heading line ALREADY EXISTS verbatim in the target durable-memory file — the
# observable signature of a false-absence corrective re-write (re-adding
# an entry you wrongly believe is missing, which DUPLICATES it).
#
# Prevents the recurrence class: false-absence → corrective-write → durable
#   corruption.
#
# ── Feasibility note (why this guards the CONSEQUENCE, not the TRIGGER) ──
#   The queued idea was "warn on a write whose same-turn justification was an
#   absent/missing/0 grep." That literal item is INFEASIBLE at acceptable FP:
#   (1) a PreToolUse hook receives only {tool_name, tool_input, transcript_path}
#       — the "my grep returned 0" justification is in the conversation, not the
#       payload; scanning transcript_path for it is FP-DOMINANT because
#       check-before-add is CORRECT practice (most durable writes legitimately
#       follow an absence grep) and the discriminator "was the absence FALSE" is
#       unknowable to the hook without re-running a better grep it can't author.
#   (2) the actual incident's corrective write was a `cat >> MEMORY.md <<EOF`
#       heredoc — which an Edit|Write matcher never even sees.
#   So this hook guards the OBSERVABLE CONSEQUENCE — a duplicate entry — at the
#   moment before it lands, across the two surfaces the orchestrator actually
#   uses to append durable memory. It cannot prevent the false-absence reasoning,
#   only the bad write that reasoning produces (which is the damage we care about).
#
# Surfaces:
#   - Edit  : a heading present in new_string, ABSENT from old_string, yet
#             ALREADY in the target file → adding a duplicate heading.
#             (old_string-exclusion is the FP-killer: an in-place edit keeps the
#             heading in both old+new, so it is not flagged.)
#   - Bash  : a `>>`/`>` redirect (incl. `cat <<EOF` heredoc — the documented
#             orchestrator MEMORY-append path) to a durable file whose inline
#             body carries a heading already in that file.
#   - Write : intentionally NOT covered — a full-file Write to an existing MEMORY
#             would collide on every heading (FP); durable appends never use Write.
#
# Warn-mode (NEW hook — warn first; promote to block-mode only after
# clean-fire + 0-FP observation read from `dup-durable-append-warn-fires.jsonl`). Escape: SKIP_DUP_DURABLE_WARN=1.

set -u

# This warn must reach the MODEL, not only the terminal: a bare-stderr PreToolUse warn is
# invisible to it (measured twice — see lib/warn-emit.sh). The inline fallback keeps this
# hook behaving exactly as before if the lib is ever missing or unreadable.
# ⛔ FALLBACK FIRST, AND ERREXIT SUSPENDED ACROSS THE SOURCE — `.` is a POSIX SPECIAL
# BUILTIN, so under `set -e` a failed source is FATAL to the shell and `|| true` CANNOT
# rescue it. Measured 2026-08-24: a corrupt lib under `set -e` / `set -euo pipefail`
# exits **rc=2** — which is the PreToolUse BLOCK code — and a missing one exits rc=1;
# in both cases execution never reaches the next line. On a matcher=Bash hook that would
# DENY EVERY BASH CALL for every seat, with the SKIP_* escape unreachable because it sits
# below the fatal line. Defining the fallback first and suspending errexit only across the
# source makes a broken lib degrade to stderr-only instead of to a fleet-wide block.
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
# ⛔ BOTH arms of this `case` assign, and the `*)` arm is LOAD-BEARING IN SIX OF THE NINE
# hooks — the ones running `set -u` WITHOUT `-e`. It reads like defensive boilerplate and
# is exactly the kind of arm a tidier deletes. Delete it and the restore line below
# dereferences an UNSET variable, `set -u` kills the hook, and this fleet-lockout FIX
# BECOMES A FLEET LOCKOUT. (The failure mode is confirmed real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

[[ "${SKIP_DUP_DURABLE_WARN:-0}" == "1" ]] && exit 0

PAYLOAD="$(cat)"
# Run ledger: ONE row per run that examined a durable file or a router, clean included.
_w1_fire() { local _r=$?; [ -n "${_w1_seen:-}${router_hits:-}" ] || return 0; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${PAYLOAD:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log dup-durable-append-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "$([ -n "${collisions:-}${router_hits:-}" ] && echo found || echo clean)" rc "$_r" ) >/dev/null 2>&1 || true; }; trap _w1_fire EXIT

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"

# extract <dotted.path> — prefer jq, fall back to python3 (mirrors the
# commit-pathspec-warn.sh extraction pattern). Returns "" on any miss.
extract() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$PAYLOAD" | jq -r ".$1 // \"\"" 2>/dev/null
  else
    printf '%s' "$PAYLOAD" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); sys.exit(0)
cur=d
for k in '$1'.split('.'):
    cur=cur.get(k,{}) if isinstance(cur,dict) else {}
print(cur if isinstance(cur,str) else '')" 2>/dev/null
  fi
}

TOOL_NAME="$(extract tool_name)"

# Durable-memory targets where a duplicated entry is the corruption class.
# (RULES.md excluded — its ENTRIES are table rows, not heading-shaped, so the heading detector
# would not catch a dup row there anyway. ⚠ TRUTH-UP 2026-08-06: the content split gave RULES.md
# 18 new `## ` section headings (20 → 38). That does NOT change this exclusion or its reasoning —
# the headings are SECTION dividers, never entry identifiers, so a duplicated RULE still has no
# heading for the detector to see. Recorded because the parenthetical reads like "RULES.md has no
# headings", which is now false on its face and would invite someone to "fix" the exclusion.)
#
# ⛔ 2026-08-06 — THIS REGEX WAS SILENT ON 100% OF THE LIVE APPEND PATH FOR ~1 HOUR.
# The two-tier split made `MEMORY.md` a ROUTER and moved every lesson body into
# `MEMORY-ARCHIVE-*.md` shards + the `WATCH-TIER.md` / `ADOPTION-QUEUE.md` registers.
# The old pattern anchored `MEMORY\.md$`, which matches the router — the ONE file the
# router's own text says never receives an append — and missed every file that now does.
# The guard reported nothing and looked healthy, because a guard that matches no path
# is indistinguishable from a guard with nothing to flag.
# Worse: the six comment lines directly ABOVE this one were added the same hour, in a
# commit whose whole purpose was truthing up what the split did to this file's targets.
# The comment was updated; the line it describes was not read. When you truth up a
# comment about a pattern, RE-DERIVE THE PATTERN — the edit that brings you here is
# proof you are already holding the fact that invalidates it.
# WATCH-TIER/ADOPTION-QUEUE take [^/]* so their -ARCHIVE siblings are covered too — the
# archive was outside this net from its creation (2026-08-25) until review caught it:
# an unguarded archive lets a recurrence be re-filed as a duplicate instead of revived.
DURABLE_RE='(MEMORY[^/]*\.md|WATCH-TIER[^/]*\.md|ADOPTION-QUEUE[^/]*\.md|/project-memory/.*\.md|/memory/.*\.md|DECISIONS\.md)$'

# emit_headings — read text on stdin, emit entry-IDENTIFYING heading lines.
# A line qualifies if it is a markdown H2-H4 (`## `..`#### `) or a **L###** bold
# header AND is "specific" (contains a date, a 2+digit id, or is >30 chars).
# Generic short headers ("### Memory Update", "## Notes") are excluded to keep
# the false-positive rate ~0.
emit_headings() {
  grep -E '^(#{2,4} |\*\*L[0-9]+)' 2>/dev/null | while IFS= read -r line; do
    if printf '%s' "$line" | grep -qE '[0-9]{4}-[0-9]{2}|[0-9]{2,}' || [[ ${#line} -gt 30 ]]; then
      printf '%s\n' "$line"
    fi
  done
}

collisions=""

# check_against <target_file> <added_text> [pre_edit_text]
check_against() {
  local target="$1" text="$2" old="${3:-}"
  if [[ ! -f "$target" && -n "$REPO_ROOT" && -f "$REPO_ROOT/$target" ]]; then
    target="$REPO_ROOT/$target"
  fi
  [[ -f "$target" ]] || return 0
  _w1_seen=1
  while IFS= read -r h; do
    [[ -n "$h" ]] || continue
    # skip headings carried over from the pre-edit context (in-place edit)
    if [[ -n "$old" ]] && grep -Fxq "$h" <<<"$old"; then continue; fi
    if grep -Fxq "$h" "$target"; then
      collisions+="  • ${h}"$'\n'
    fi
  done < <(printf '%s' "$text" | emit_headings)
}

# ─────────────────────────────────────────────────────────────────────────────
# ROUTER-APPEND check — a SECOND, independent hazard on the same two surfaces.
#
# Prevents: an entry appended to a two-tier ROUTER instead of its current shard.
# Everything below a router's `ROUTER PREAMBLE ENDS` marker is REGENERATED. Before
# 2026-08-07, `memory-tier-split.mjs --roll` DELETED such an entry and still
# printed "conservation: OK"; since then `rollLayout` REFUSES, `--force` included, so the
# cost is a router that cannot roll or re-derive until someone moves the entry by hand.
#
# WHY A WRITE-TIME GUARD WHEN A DETECTOR ALREADY EXISTS. `--scan-routers` reports
# this as ERROR and has since 2026-08-07. It has not stopped it:
# six rescue events on five dates in the six days after that detector shipped
# (the last two are one day apart, three different sessions). Detection fires when a human
# happens to run the scan, days later; this fires on the write. Closer to a
# STEADY STATE than a recurrence, so the steady-state disposition applies: change the
# design, do not wait for another occurrence.
#
# WHY THE MARKER IS ANCHORED TO THE HTML-COMMENT FORM. A bare grep for the
# marker text matches PROSE ABOUT it — a shard that discusses the marker inside
# one of its entries. An unanchored detector would therefore fire on a shard, the
# one file that SHOULD be receiving appends, which is the worst possible false
# positive. Use-vs-mention.
#
# WHY THE HEADING PREDICATE IS DATE/L#-ANCHORED, NOT "any `## `". Validated
# against the perfectly-labelled corpus of entries the six rescue events above
# actually moved out of routers: 8/8 real entries match, 0/4 structural router
# headings match (`## How this file works`, `## Shard manifest`, and the two
# `## Current shard — digest index (...)` forms, which carry a date INSIDE a
# filename and are excluded by requiring the date at heading-start).
#
# ⛔ STATE THE BOUND, because "8 members" reads like a sampling choice and is not
# one (measured 2026-08-13, repo-wide over all 12
# routers): there are 36 `## ` headings below the marker fleet-wide and ALL 36
# are structural — **ZERO dated entries exist in the live tree**. The class is
# repaired on sight, so the 8 historical members recovered from the rescue
# commits are not a small sample of an available population, they are the ENTIRE
# positive evidence that exists. Two consequences: (1) this predicate's recall
# can never be re-measured from the tree, which will keep reading clean by
# construction; (2) the only durable positive control is therefore a PLANTED
# FIXTURE — which the smoke arms do carry (`$RTR_FX` + `$RTR_ENTRY` in
# `scripts/smoke-test-hooks.sh`), so the control survives the empty population.
# The same run also confirmed the marker anchoring against a WIDER scope than was
# first checked — 18 files carry the marker text, 12 at line start, all routers,
# zero non-routers: no third shape exists.
ROUTER_MARKER='^<!-- ROUTER PREAMBLE ENDS'
ENTRY_HEADING_RE='^## (20[0-9]{2}-[0-9]{2}-[0-9]{2}|L[0-9]+)'

router_hits=""
ROUTER_TARGET=""
ROUTER_TARGETS=""
ROUTER_SHARD=""

# current_shard_for <router> — DERIVE the remedy path, never hardcode it.
# A remediation string is the one stale pointer that gets FOLLOWED rather
# than read, so this reads the router's OWN regenerated "Appends" line (which the
# roll rewrites on every cut) and then VERIFIES THE FILE EXISTS before offering
# it. On any miss it returns "" and the message degrades to an instruction
# instead of naming a path that may not be there.
current_shard_for() {
  local router="$1" dir name
  dir="$(dirname "$router")"
  name="$(grep -m1 -E '^- \*\*Appends\*\*' "$router" 2>/dev/null \
          | grep -oE '`[^`]+`' | head -1 | tr -d '`')"
  [[ -n "$name" && -f "$dir/$name" ]] || return 0
  printf '%s' "$name"
}

# check_router_append <target_file> <added_text> [pre_edit_text]
check_router_append() {
  local target="$1" text="$2" old="${3:-}" h
  local anyappend="${4:-}"
  if [[ ! -f "$target" && -n "$REPO_ROOT" && -f "$REPO_ROOT/$target" ]]; then
    target="$REPO_ROOT/$target"
  fi
  [[ -f "$target" ]] || return 0
  # FENCE-AWARE (measured + closed 2026-08-14). A bare `grep` for the marker
  # ANYWHERE in the file classifies a SHARD that merely QUOTES a router preamble inside
  # a ```fence as a router — and shards are append-only, so once armed it NEVER
  # self-clears and fires on ~100% of that shard's dated appends. Worse, the remedy
  # degrades to nonsense: reproduced verbatim before this fix, the hook told the author
  # to "Append to the CURRENT SHARD instead: MEMORY-ARCHIVE-<x>.md" — the very file they
  # were appending to. Live shards already carry 4-10 column-0 fences each, so this was
  # latent, not hypothetical.
  # NOT the fix that was prescribed: the filed row proposed "require the marker at a line
  # index ABOVE the added heading" for BOTH this and the other false positive. Measured, that closes the other and
  # NOT this one — a shard's appends land at the END, so a fenced marker mid-file is still
  # above them and the branch fires anyway. Two false positives, two mechanisms (a
  # fix is a hypothesis). The other false positive is still open; it needs the heading's position, which
  # this predicate does not compute.
  # Positive control (validate against the corpus you already know the answer for):
  # all 13 live routers classify ROUTER under both predicates; only the fenced-marker
  # fixture flips. Arm: `dup-durable-append-warn: fenced marker does NOT arm a shard`.
  awk -v re="$ROUTER_MARKER" '
    /^[[:space:]]*```/  { infence = !infence; next }
    !infence && $0 ~ re { found = 1; exit }
    END                 { exit(found ? 0 : 1) }
  ' "$target" 2>/dev/null || return 0   # not a router
  # The other false positive (filed 2026-08-13, closed 2026-08-24). The warning below
  # asserts the entry landed "below its regeneration marker" and NOTHING ever checked that.
  # A heading added to the VERBATIM PREAMBLE — above the marker, the one region the
  # regenerator does not touch — fired the identical warning, which is false there and sends
  # the author off to a shard for an edit that belongs exactly where they put it.
  # Reproduced before touching anything, two-arm scratch fixture: an edit anchored in the
  # preamble and one anchored below the marker BOTH fired.
  # Scope: only an Edit can land above the marker. A Write replaces the file and a `cat >>`
  # append lands at EOF, so both are unconditionally below and keep the old behaviour —
  # which is why this is gated on a non-empty "$old".
  local mline aline hits olines
  mline="$(awk -v re="$ROUTER_MARKER" '
    /^[[:space:]]*```/  { infence = !infence; next }
    !infence && $0 ~ re { print NR; exit }
  ' "$target" 2>/dev/null || true)"
  if [[ -n "$old" && -n "$mline" ]]; then
    # Anchor the edit by its FIRST line, and require that line to be UNIQUE. An ambiguous
    # anchor KEEPS the warning rather than silently going blind: on a warn-mode guard a
    # false positive costs one read, a false negative costs the thing the guard exists for.
    #
    # ⛔ MEASURE THE ANCHOR'S **END**, NEVER ITS START (reproduced here
    # before fixing). The hazard is where the ADDED HEADING LANDS, which is
    # start + lines(old) - 1. The first version of this block compared the START, so any
    # old_string that BEGINS above the marker and SPANS it suppressed a genuine below-marker
    # append: measured 2 false positives removed, 8 false negatives added, reachable on 12 of
    # the 13 live routers. The comment three lines up states the principle that version broke
    # — the guard was written against ambiguity and the failure came in through POSITION, so
    # the answer to "what else can go wrong with this anchor" was not a weirder one but a
    # LONGER one. Requiring the WHOLE anchor above the marker is strictly harder to satisfy,
    # so it can only turn a suppress into a keep and cannot add a false positive.
    #
    # ⛔ EVERY SUBSTITUTION HERE TAKES `|| true`, AND THAT IS NOT DEFENSIVE STYLE. Line 68
    # RESTORES inherited errexit (`[ "$_WE_HAD_E" = 1 ] && set -e`), so a caller running
    # `set -e` has it LIVE at this point — and `grep` exits 1 on no match, which for a bare
    # assignment is fatal. Measured, not reasoned: with errexit forced on, a mid-line anchor
    # took the whole hook to rc=1 with ZERO output and no stderr, while the same payload
    # normally fires twice. A warn-mode guard that vanishes silently is the exact failure the
    # comment above is about. `|| true` and NOT `|| echo 0` — the latter prints AND the ||
    # still fires, yielding a two-line "0\n0" that breaks every numeric test downstream.
    hits="$(grep -Fxn -- "$(printf '%s' "$old" | head -1)" "$target" 2>/dev/null || true)"
    aline="$(printf '%s\n' "$hits" | grep -c '^[0-9]' || true)"
    olines="$(printf '%s\n' "$old" | grep -c '' || true)"
    if [[ "$aline" == "1" && "${hits%%:*}" =~ ^[0-9]+$ ]] \
       && [[ $(( ${hits%%:*} + olines - 1 )) -lt "$mline" ]]; then
      return 0   # verbatim preamble — the router-regeneration branch does not apply here
    fi
  fi
  while IFS= read -r h; do
    [[ -n "$h" ]] || continue
    # an in-place edit keeps the heading in BOTH old and new — not an add.
    if [[ -n "$old" ]] && grep -Fxq "$h" <<<"$old"; then continue; fi
    # DEDUPE. On a Bash command this function is called once per TARGET and each call
    # scans the WHOLE command, so with N router targets every heading is collected N
    # times. Measured 2026-08-25 on two router fixtures: 2 distinct headings produced
    # FOUR bullets. Nothing downstream de-duplicates, so the count in the warning was
    # targets x headings.
    # Same anchoring, same reason: a heading containing "  • " would let this match start
    # INSIDE a prior bullet and silently drop a DISTINCT entry from the list. Zero of 7,175
    # entry-shaped headings contain U+2022 today, so this is latent — but it is one line.
    if [[ $'\n'"$router_hits" != *$'\n'"  • ${h}"$'\n'* ]]; then
      router_hits+="  • ${h}"$'\n'
    fi
    ROUTER_TARGET="$target"
    # ACCUMULATE, don't overwrite. ROUTER_TARGET alone is last-write-wins, so a command
    # touching two routers named only the LAST one and derived the remedy shard from it
    # — telling the author to put the FIRST router's entry into the SECOND router's
    # shard. That is the harmful half: following the remedy literally misfiles the entry.
    # ANCHORED both ends: an unanchored substring test is not set membership. "/MEMORY.md"
    # is a substring of "/docs/MEMORY.md", and while these paths are normally absolute, :76
    # falls back to an EMPTY REPO_ROOT and :140/:224 then CONSTRUCT the path — on that branch
    # the two collapse to one router. Measured order-dependent: healthy root gives 2 both
    # orders; empty root gives 1 in one order and 2 in the other.
    if [[ $'\n'"$ROUTER_TARGETS" != *$'\n'"${target}"$'\n'* ]]; then
      ROUTER_TARGETS+="${target}"$'\n'
    fi
  done < <(printf '%s' "$text" | grep -E "$ENTRY_HEADING_RE" 2>/dev/null)
  # CONTENT-AGNOSTIC `>>` (2026-09-25). A Bash append whose BODY comes from a file
  # (`cat f.md >> <router>`) puts no heading in the command, so the loop above adds nothing and
  # the guard was silent. Nothing legitimately appends to a regenerated router, so an append
  # target that IS a router fires whatever the command text holds. `>` stays heading-gated:
  # `git show <ref>:<router> > <router>` is a legitimate restore.
  if [[ -n "$anyappend" && $'\n'"$ROUTER_TARGETS" != *$'\n'"${target}"$'\n'* ]]; then
    h="  • (no entry heading in the command — the appended body comes from a file or a variable)"
    [[ $'\n'"$router_hits" == *$'\n'"${h}"$'\n'* ]] || router_hits+="${h}"$'\n'
    ROUTER_TARGET="$target"
    ROUTER_TARGETS+="${target}"$'\n'
  fi
  [[ -n "$ROUTER_TARGET" ]] && ROUTER_SHARD="$(current_shard_for "$ROUTER_TARGET")"
  return 0
}

case "$TOOL_NAME" in
  Edit)
    fp="$(extract tool_input.file_path)"
    check_router_append "$fp" "$(extract tool_input.new_string)" "$(extract tool_input.old_string)"
    if [[ "$fp" =~ $DURABLE_RE ]]; then
      check_against "$fp" "$(extract tool_input.new_string)" "$(extract tool_input.old_string)"
    fi
    ;;
  Write)
    # Write is deliberately NOT given to check_against (a full-file Write collides
    # on every heading — the FP reason recorded above). The ROUTER check IS safe
    # here: a correct router carries no dated/L# entry heading at all, so a
    # faithful full-file Write cannot trip it — only one carrying an ENTRY does.
    # This matcher was already wired ('Edit|Write'); the payload previously fell
    # through to *) and was ignored.
    fp="$(extract tool_input.file_path)"
    check_router_append "$fp" "$(extract tool_input.content)" ""
    ;;
  Bash)
    cmd="$(extract tool_input.command)"
    # A redirect the command PERFORMS lives on a command LINE; a redirect it merely
    # QUOTES lives in a heredoc BODY. Extracting targets from the whole string cannot
    # tell them apart, so a write-up that quotes `>> <a router>` while correctly
    # appending to its shard was flagged against the file it never touched — and
    # 6 files already carry that idiom (fresh-context calibration, 2026-08-13).
    # Strip heredoc bodies BEFORE extracting targets; the body is still
    # scanned for headings below, which is what the real append needs.
    # ⛔ THE STRIPPER MUST FAIL SAFE, AND THAT MATTERS MORE THAN PARSING SHELL CORRECTLY.
    # The first version of this block enumerated heredoc syntax and got it wrong twice: `<<-EOF`
    # permits a TAB-INDENTED terminator (so `\tEOF` never equalled `EOF`) and `<<<word` was
    # misparsed as a heredoc from its 2nd and 3rd `<`. In BOTH cases `inbody` never cleared, so
    # every LATER command line was dropped from target extraction and a REAL router append went
    # SILENT — trading one false positive for two silent false negatives on the guard's core job
    # (both reproduced here before fixing).
    #
    # So the load-bearing fix is NOT a better regex — it is `END { if (inbody) exit 3 }` plus the
    # `|| cmd_lines="$cmd"` fallback below. Any delimiter form this parser fails to close, KNOWN
    # OR NOT YET DISCOVERED, now degrades to the pre-strip behaviour (a possible false POSITIVE)
    # instead of a silent false NEGATIVE. For this guard that asymmetry is the whole point: a
    # spurious warning costs one re-read, a missed warning costs the entry — the router is
    # regenerated, so an append landing there is wiped with no signal.
    #
    # The explicit `<<-` / `<<<` / quoted-delimiter handling below is the FP-reduction half and is
    # strictly secondary; it can be wrong again without re-opening the silent-miss class.
    # `\047` is a single quote — written as an escape so this program carries NO literal quote and
    # cannot be broken by the shell-quoting that has bitten every prior edit to this block.
    #
    # ⛔ THE SECOND MENTION CHANNEL — A COMMAND LINE THAT *TALKS ABOUT* A REDIRECT.
    # The heredoc stripper above closes the mention channel in a BODY. It does not close the
    # one on a COMMAND LINE, and that half looks closed because the arm for the body half
    # passes: measured at HEAD, `# never do: cat >> <router>` followed by a correct append to
    # the SHARD fired ROUTER-APPEND against the router it never touched — so the guard is
    # loudest exactly when someone documents the guard (the documentation-burst shape).
    # ⚠️ STRIPPING `#`-COMMENTS IS THE WRONG FIX and was rejected on measurement: a mention
    # sits just as happily in a QUOTED ARGUMENT (`echo "never: cat >> <router>"`), which no
    # comment filter can see. The discriminating question is not WHERE the text sits, it is
    # whether the redirect is the command`s actual TARGET — i.e. whether that `>` is in
    # OPERATOR position. `neutralize()` answers exactly that, and one mechanism covers both
    # shapes: it blanks every `>` inside a quoted region or after an unquoted `#`, and leaves
    # every other byte alone — so a QUOTED TARGET (`>> "my file.md"`) still extracts, because
    # its `>` is outside the quotes.
    # FAIL-SAFE, same asymmetry the stripper above is built on: an UNTERMINATED quote returns
    # the ORIGINAL line, so an unparseable command degrades to a possible false POSITIVE and
    # never to a silent miss. A spurious warning costs one re-read; a missed one costs the
    # entry, because the router is regenerated and the append is wiped with no signal.
    # NOTE the program still carries NO literal single quote (`\047`), for the reason above.
    cmd_lines="$(printf '%s' "$cmd" | awk '
      function neutralize(s,   i, c, n, q, out, incomment, prev) {
        # REGRESSION GUARD (2026-08-26, four-arm control): blanking `>` inside a
        # TERMINATED quote made a genuine append SILENT whenever its operator was wrapped for an
        # inner shell — `bash -c "cat >> <router>" <<EOF` fired before the quote-blanking change and did not at HEAD,
        # while the plain control fired at both. That is a silent MISS, which the header three
        # lines up promises never to produce. A shell-invoking word means the quoted span is a
        # COMMAND, not prose, so its operators are real: hand the line back untouched. FP-safe by
        # construction — neither FP fixture contains one, and returning `s` is the same
        # degrade-to-spurious-warning branch the unterminated-quote arm already takes.
        if (s ~ /(^|[^A-Za-z0-9_-])(bash|sh|zsh|eval|ssh)([^A-Za-z0-9_-]|$)/) return s
        n = length(s); out = ""; q = ""; incomment = 0; prev = " "
        for (i = 1; i <= n; i++) {
          c = substr(s, i, 1)
          if (incomment) { out = out ((c == ">") ? " " : c); prev = c; continue }
          if (q == "") {
            if (c == "\\") { out = out c; i++; if (i <= n) out = out substr(s, i, 1); prev = "x"; continue }
            if (c == "#" && (i == 1 || prev == " " || prev == "\t")) { incomment = 1; out = out c; prev = c; continue }
            if (c == "\047" || c == "\"") { q = c; out = out c; prev = c; continue }
            out = out c; prev = c; continue
          }
          if (q == "\"" && c == "\\") { out = out c; i++; if (i <= n) out = out substr(s, i, 1); prev = "x"; continue }
          if (c == q) { q = ""; out = out c; prev = c; continue }
          out = out ((c == ">") ? " " : c); prev = c
        }
        if (q != "") return s
        return out
      }
      { if (inbody) {
          t = $0
          if (dash) sub(/^[[:space:]]+/, "", t)
          if (t == delim) { inbody = 0 }
          next
        }
        line = $0
        gsub(/<<<[^[:space:];|&)]*/, " ", line)
        if (match(line, /<<-?[[:space:]]*["\047\\]?[A-Za-z_][A-Za-z0-9_]*["\047\\]?/)) {
          d = substr(line, RSTART, RLENGTH)
          dash = (d ~ /^<<-/)
          sub(/^<<-?[[:space:]]*/, "", d)
          gsub(/["\047\\]/, "", d)
          delim = d; inbody = 1
        }
        print neutralize($0) }
      END { if (inbody) exit 3 }')" || cmd_lines="$cmd"
    # redirect targets: tokens after > or >> (excludes fd-dups like 2>&1).
    targets="$(printf '%s' "$cmd_lines" | grep -oE '>>?[[:space:]]*"?[^"[:space:]|&;><]+' 2>/dev/null | sed -E 's/^>>?[[:space:]]*"?//')"
    appends="$(printf '%s' "$cmd_lines" | grep -oE '>>[[:space:]]*"?[^"[:space:]|&;><]+' 2>/dev/null | sed -E 's/^>>[[:space:]]*"?//' || true)"
    # ⛔ VARIABLE TARGETS (measured 2026-09-25): all 4 entries stranded in one
    # expert's memory router on 2026-09-22..24 went in through `M=<router>; cat >> "$M"`
    # (2) or a function's `>> "$f"` (2). The regex above extracts the literal `$M`, which is no
    # file, so `check_router_append` returned at its `-f` test on every one. Resolve same-command
    # `NAME=value` assignments one level, LAST assignment wins. A function positional (`$1`)
    # stays unresolved: named residual, not closed here.
    _sq=$'\047'
    _asg_re="(^|[;&|[:space:](])[A-Za-z_][A-Za-z0-9_]*=(\"[^\"\$\`]*\"|${_sq}[^${_sq}\$\`]*${_sq}|[^[:space:];&|\"${_sq}\$\`()<>]+)"
    assigns="$(printf '%s\n' "$cmd_lines" | grep -oE "$_asg_re" 2>/dev/null | sed -E 's/^[;&|[:space:](]//' | awk '{a[NR]=$0} END {for (i = NR; i > 0; i--) print a[i]}' || true)"
    resolve_var_target() {
      local t="$1" line name val
      [[ "$t" == *'$'* && -n "$assigns" ]] || { printf '%s' "$t"; return 0; }
      while IFS= read -r line; do
        name="${line%%=*}"; val="${line#*=}"; val="${val#[\"\']}"; val="${val%[\"\']}"
        t="${t//\$\{$name\}/$val}"
        while [[ "$t" =~ ^(.*)\$${name}([^A-Za-z0-9_].*)?$ ]]; do t="${BASH_REMATCH[1]}${val}${BASH_REMATCH[2]}"; done
      done <<<"$assigns"
      printf '%s' "$t"
    }
    if [[ -n "$targets" ]]; then
      while IFS= read -r t; do
        [[ -n "$t" ]] || continue
        # heredoc / echo body is inline in the command string — scan it whole.
        raw_t="$t"; t="$(resolve_var_target "$t")"
        anyapp=""; [[ $'\n'"$appends"$'\n' == *$'\n'"${raw_t}"$'\n'* ]] && anyapp=1
        check_router_append "$t" "$cmd" "" "$anyapp"
        [[ "$t" =~ $DURABLE_RE ]] || continue
        check_against "$t" "$cmd" ""
      done <<<"$targets"
    fi
    ;;
  *)
    exit 0
    ;;
esac

if [[ -n "$router_hits" ]]; then
  # MULTI-ROUTER: name every target with its OWN shard. Single-target output is
  # byte-identical to before — the else-branch below is the original code path.
  # ⛔ THE FIX IS DELIBERATELY *NOT* TO ATTRIBUTE HEADINGS TO TARGETS. Doing that
  # means deciding which heredoc body belongs to which redirect, i.e. parsing shell
  # — and the stripper comment above records that this file got shell parsing wrong
  # TWICE, each time trading a false positive for a SILENT FALSE NEGATIVE on the
  # guard's core job. So the guard now reports honestly what it knows (these routers,
  # these headings, unattributed) instead of guessing an attribution it cannot ground.
  ROUTER_COUNT="$(printf '%s' "$ROUTER_TARGETS" | grep -c . || true)"
  ROUTER_COUNT="${ROUTER_COUNT:-0}"
  if [[ "$ROUTER_COUNT" -gt 1 ]]; then
    TARGET_LINES=""
    while IFS= read -r rt; do
      [[ -n "$rt" ]] || continue
      rs="$(current_shard_for "$rt" || true)"
      TARGET_LINES+="      ${rt}"$'\n'
      if [[ -n "$rs" ]]; then
        TARGET_LINES+="          -> its shard: ${rs}"$'\n'
      else
        TARGET_LINES+="          -> its shard: NOT derivable (Appends line missing or stale)"$'\n'
      fi
    done <<< "$ROUTER_TARGETS"
    TARGET_LINES="${TARGET_LINES%$'\n'}"   # the heredoc supplies the blank line itself
    remedy="    This command touches ${ROUTER_COUNT} ROUTERS. Append each entry to the shard of the
    router it was actually destined for, named beside each path above.
    ⚠️  The heading list is the WHOLE command's and is NOT attributed per router —
    this guard does not parse which heredoc belongs to which redirect, on purpose."
  elif [[ -n "$ROUTER_SHARD" ]]; then
    TARGET_LINES="      ${ROUTER_TARGET}"
    remedy="    Append to the CURRENT SHARD instead:
      ${ROUTER_SHARD}
    (derived from that router's own \"Appends\" line and confirmed to exist.)"
  else
    # Reached when the Appends line is ABSENT, or names a shard that no longer
    # exists (a peer's --roll renamed it mid-write). Both were tested; the guard
    # fails SAFE — it never names a path it could not confirm (a stale
    # remediation string is the pointer that gets FOLLOWED). Do NOT tell the
    # reader to "read the Appends line" here: in the absent case there is no such
    # line, which is a dead end of its own. Name the derivation instead.
    TARGET_LINES="      ${ROUTER_TARGET}"
    remedy="    Append to the CURRENT SHARD instead. This router's \"Appends\" pointer is
    MISSING or names a file that no longer exists, so there is no name to quote —
    take the newest-dated *-ARCHIVE-*.md beside the router, or re-derive with:
      node scripts/memory-tier-split.mjs --scan-routers"
  fi
  warn_emit <<EOF || true

⚠️  dup-durable-append-warn / ROUTER-APPEND: you are adding an ENTRY to a
    two-tier ROUTER, below its regeneration marker:

${TARGET_LINES}

${router_hits}
    Everything below a router's \`ROUTER PREAMBLE ENDS\` marker is REGENERATED, so
    \`memory-tier-split.mjs\` REFUSES to roll or re-derive this router (--force
    included) until the entry is moved by hand.

${remedy}

    Six rescue events on five dates preceded this guard; the existing detector
    (\`--scan-routers\`) only reports it when a human runs it, days later.

    Disable per-invocation: SKIP_DUP_DURABLE_WARN=1

EOF
fi

[[ -n "$collisions" ]] || exit 0

warn_emit <<EOF || true

⚠️  dup-durable-append-warn: content you're about to add to a durable
    memory file carries an entry heading that ALREADY EXISTS verbatim in it:

${collisions}
    This is the signature of a false-absence corrective write — a
    grep/ls/count said an entry was "missing" so you're re-adding it, but it
    exists (heterogeneously-titled entries defeat a single-literal grep). The
    re-add DUPLICATES it.

    Cross-confirm the absence with a 2nd method BEFORE proceeding:
      git show HEAD:<file> | grep -i '<entry>'   # or Read the region / wider -i grep
    If the entry already exists → do NOT re-add; it was never missing.

    Disable per-invocation: SKIP_DUP_DURABLE_WARN=1

EOF

# Warn-mode: the write proceeds. Promote to exit 1 (block-mode) only after a
# clean-fire + 0-false-positive window read from `dup-durable-append-warn-fires.jsonl`.
exit 0
