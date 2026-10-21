#!/usr/bin/env bash
# PreToolUse(Read) hook — TWO arms over unbounded Reads of large memory files.
#   ARM A (2026-06-01): WARN on a full Read of a large project-memory tracker.
#   ARM B (2026-08-01; widened 2026-08-06): DENY on an unbounded Read of a large skill
#     `MEMORY*.md` — the ROUTER and its `MEMORY-ARCHIVE*.md` shards alike (see the case block).
# The arms differ in FAILURE MODE on purpose — see "Why ARM B denies" below.
#
# ============================ ARM A — trackers (WARN) ============================
# MEMORY-budget Phase 4 (2026-06-01, Option 2 = grep-only discipline + enforce).
#
# Background:
#   Two project-memory trackers (368,860 B and 186,661 B) are
#   append-only files — re-derive with `wc -c`, never from this line, which read
#   "~195 KB" and "~66 KB" until 2026-09-09 (1.9x and 2.8x stale). ⛔ the larger has
#   since crossed the Read tool's 262,144 B HARD-ERROR ceiling by 106,716 B, so an
#   unbounded Read of it now FAILS rather than merely costing context; ARM A still only
#   WARNs, which is correct — the Read tool's own error is the backstop, and the failure
#   is loud either way. They are NOT auto-loaded (only MEMORY.md is), so they
#   never hit the 25 KB auto-load cap — but a full `Read` loads the whole file into context
#   for data a grep returns in <1 KB. The two real access patterns are already
#   in-shell and never load the file into model context:
#     - status scan:  awk the Status column      (counts; processed in bash)
#     - one flow/feat: grep -nE '^\| <N> \|' / '^\| F<N> \|' over the tracker GLOB
#       (returns just that row). NOT rg "Flow #N" / "F#" <file>, which this line
#       carried until 2026-09-09 and is REFUTED twice over: rows are keyed | N |,
#       so the prose form fails to return the right row for 26 of 69 -- 13 return
#       nothing and 13 return a DIFFERENT flow's row -- and a single <file>
#       reads the ROUTER alone, which is a clean zero for every sharded row.
#   Only a direct Read leaks the whole file. This hook nudges Read -> awk/rg.
#
# Scope: a no-limit Read of a >50 KB */project-memory/*.md (or symlinked
#   */memory/*.md). Partial reads (offset+limit) are the acceptable surgical
#   pattern -> allowed silently. MEMORY.md (~15 KB) / MEMORY-INDEX.md (~10 KB)
#   are under threshold -> never warn; the threshold auto-covers future bloat.
#
# Decision: WARN only (exit 0 + stderr). Warn-first; escalate to deny
#   only if the warn is observed-ignored (SC-2). Companion to check-memory-budget.sh
#   (the WRITE-side gate) — this is the READ-side gate.
#
# ========================= ARM B — skill MEMORY.md (DENY) =========================
# GUARD 1 (2026-08-01).
#
# Background:
#   `.claude/skills/*/MEMORY.md` is not auto-loaded, but every expert agent is
#   instructed to Read it at consultation start. The Read tool imposes TWO caps,
#   and BOTH are tool-level constants — no context window ever raises them:
#     - ~262,144 B  -> hard ERROR, no content at all (loud).
#     - 25,000 TOKENS per call -> binds ~4.3x lower (~58 KB at the measured
#       2.350-2.572 B/tok density). This one returns a well-formed PREFIX with
#       the truncation disclosed ONLY in a trailing reminder — no error string.
#   Measured over 4,184 fleet dispatches (2026-08-01): 356 capped reads, of which
#   243 (68%) never paged; in the hard-BYTE class 229 errors / 29 recoveries =
#   87.3% of agents ran BLIND on their own memory and said nothing.
#
# Why ARM B DENIES where ARM A only warns (the waiver is principled, not lazy):
#   1. The warn channel is MEASURED-INVISIBLE to the reader that matters. An
#      exit-0 stderr warning reaches the USER transcript, never the MODEL —
#      check-memory-budget.sh:158-161 documents exactly this (the
#      wired-but-inert class). On a sub-agent's
#      own Read, `permissionDecisionReason` is the ONLY model-visible channel, so
#      a warn here would be inert BY CONSTRUCTION — not "softer", just absent.
#   2. Baseline passes trivially. An unbounded Read of a >57.5 KB file ALREADY
#      fails or silently truncates today; denying it strictly improves the
#      outcome. Warn-first exists to measure a false-positive rate against a
#      working baseline — there is no working baseline here to protect.
#   3. It is the only arm that closes the SILENT class. Deny converts every
#      outcome into either a full read or a DELIBERATE page.
#
# Threshold 57,500 B — NOT 262,144. A guard at the byte ceiling would certify all
#   18 token-band files as fine, which is the single highest-probability
#   test-theater outcome for this whole change.
#
# Fail-OPEN on any parse/stat failure and on absent jq. This is a RESOURCE guard,
#   not a security gate: the cost of a false deny (an agent can't read its memory)
#   exceeds the cost of a false allow (the truncation that happens today anyway).
#   Contrast block-subagent-memory-write.sh, which fails CLOSED — different class.
# Escape: SKIP_MEMORY_READ_GUARD=1
#
# Verification is an OUTCOME, not a smoke arm: re-run the Guard-3 audit 7 days
#   post-ship; the 12.7% recovery rate must move. A hook whose whole effect lives
#   in ANOTHER agent's context cannot be mutation-tested from here.

set -u

# Advisory must reach the MODEL, not only the terminal (see lib/warn-emit.sh).
# Fallback FIRST and errexit suspended across the source: `.` is a POSIX special
# builtin, so under set -e a failed source is FATAL and `|| true` cannot rescue it.
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

# FIRES LOG (2026-09-13). ARM B DENIES on
# three paths and kept no record of any of them, so its deny could not be calibrated — no corpus, no
# false-positive rate (session-cadence.md § READING A GUARD'S FIRES). Each ARM B deny now calls _wltr_fire
# BEFORE it emits; records land in .claude/logs/memory-read-guard-fires.jsonl, named for the "Memory-read
# guard" the denied seat is shown. ARM A only advises and is not logged, and a smoke arm REDs if it starts to.
# ⛔ THE LIBRARY RUNS IN A SUBSHELL, AND EVERY VALUE AT A CALL SITE IS BRACED: the same fix as
# block-dangerous.sh, whose FIRES LOG comment gives the mechanism; lib/fires-log.sh § WHERE TO SOURCE has the
# measurements. sid / agent_id are THIS call's payload fields `session_id` / `agent_id`, never the environment,
# read on the deny path: one jq spawn measured 2.7 ms against 14.2 ms for a whole Read of a path no arm governs.
# ARM B denies only where jq exists (it cannot build its envelope without it), so there is no fallback here.
_wltr_payload_field() {
  printf '%s' "${INPUT:-}" | jq -r --arg k "$1" '.[$k] // empty | tostring' 2>/dev/null
}
_wltr_fire() {
  ( fires_log() { :; }
    . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log memory-read-guard sid "$(_wltr_payload_field session_id)" agent_id "$(_wltr_payload_field agent_id)" "$@"
  ) >/dev/null 2>&1 || true
}

TRACKER_THRESHOLD=51200    # 50 KB — ARM A (warn)
SKILLMEM_THRESHOLD=57500   # ARM B (deny) — 25k-token read cap, not the 256KB byte cap

# ⛔ A PRESCRIBED WINDOW MUST FIT THE BAND THIS GUARD ENFORCES, OR THE GUARD REFUSES ITS OWN ADVICE.
# A FIXED line count was handed out in all three places this file prescribes a newest-first remedy,
# and a fixed number measures nothing. Swept 2026-09-13 over the 124 skill-memory files ARM B
# governs: 44 of them (35%) had a 300-line tail LARGER than SKILLMEM_THRESHOLD — worst 167,589 B,
# 291% of the band. A caller who followed the remedy was denied AGAIN by this same arm, which is
# precisely the loop the ARM-B walk exists to prevent. That walk was made measuring on 2026-08-01
# and these three prescriptions were left behind on the old estimate-shaped reasoning.
# Same method as that walk — accumulate REAL line bytes — run BACKWARD from EOF, so the answer is
# the LARGEST tail window that fits. LC_ALL=C makes length() count BYTES (UTF-8 corpus; a
# character-counting length() under-counts and over-prescribes, the trap the forward walk names).
# Prints "<offset> <limit>". A final line bigger than the whole band clamps to a 1-line window
# rather than 0, so the caller always has a representable next step.
tail_window() {
  LC_ALL=C awk -v cap="$2" '
    { len[NR] = length($0) + 1 }
    END {
      if (NR == 0) { print 1, 0; exit }
      s = 0
      for (i = NR; i >= 1; i--) {
        s += len[i]
        if (s > cap) { k = NR - i; if (k < 1) k = 1; print NR - k + 1, k; exit }
      }
      print 1, NR
    }' "$1" 2>/dev/null
}

INPUT=$(cat 2>/dev/null || echo "{}")
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
LIMIT=$(printf '%s' "$INPUT" | jq -r '.tool_input.limit // ""' 2>/dev/null)
OFFSET=$(printf '%s' "$INPUT" | jq -r '.tool_input.offset // ""' 2>/dev/null)

[ -z "$FILE_PATH" ] && exit 0

# Classify the path into an ARM. skill MEMORY.md is matched in BOTH its relative
# and absolute spellings; note it does NOT collide with ARM A's */memory/*.md
# pattern (case globs are case-sensitive: "MEMORY.md" has no lowercase /memory/
# path COMPONENT), so the ordering here is for readability, not correctness.
#
# ⛔ MEMORY-ARCHIVE*.md JOINS ARM B (2026-08-06). The old patterns ended `/MEMORY.md`, so an
# archive matched NEITHER arm and fell through the `*)` exit — completely ungated. That is the
# guard's own failure mode pointed at its largest possible target: 24 expert archives exist today
# at 38 KB-405 KB, SIX of them already past the 262,144 B hard-error ceiling
# (qa-expert 405,654 B), and the meta split adds ~17 more shards at ~200 KB each. An unbounded
# Read of any of them is exactly the silent-prefix / hard-refusal outcome ARM B exists to convert
# into a deliberate page.
#
# The THRESHOLD does not change and must not: the Read tool's 25k-token cap does not care that a
# file is "an archive". A 200 KB shard is over the band whatever we call it, so archives get the
# same measured-window treatment and the same computed paging advice as any other skill memory.
# Being cold storage changes the WRITE cadence, never the READ physics.
#
# `MEMORY*.md` (not `MEMORY-ARCHIVE*.md`) so the family stays closed under future naming —
# dated shards, `MEMORY-ARCHIVE-legacy-*`, a plain `MEMORY-ARCHIVE.md` — all one pattern. The
# `skills/*/` segment keeps it scoped; nothing outside a skill dir is touched.
#
# ⛔ meta/RULES.md JOINED ARM B 2026-08-06, when it was 353,008 B and a Read returned a RAW HARD
# ERROR leaving the reader to guess whether the file was missing, empty or too big — the outcome
# this guard converts into a directed page. ⚠️ **IT WAS SPLIT ON 2026-09-04 and the entry stays,
# for a different reason.** The router is now ~14 KB and exits at the size gate below, so this
# line no longer fires today; it is retained because the path can grow again and the arm costs
# nothing while silent. **The clause "it is deliberately NOT being split" is STRUCK** — its
# rationale (a router cannot route a lookup whose key is a fuzzy trigger phrase, so N shards
# means grepping all N) was answered rather than refuted: the contract was always GREP, and
# `grep .claude/skills/meta/RULES*.md` reaches all N in one command at the same cost. What the
# split bought was one section, which had passed the partial-view band and could not be read whole
# by ANY route. Scoped to meta/ on purpose: no other skill has a RULES.md, and a bare
# `*/RULES.md` would silently adopt one the day someone adds it.
#
# ⚠️ THE DESIGN EXPECTED THIS TO INVERT A PINNED SMOKE ASSERTION. It does NOT, because that
# design assumed a `*/RULES.md` widening and this is scoped to `meta/`. The pinned arm's fixture
# lives at `<tmp>/.claude/skills/fixture-skill/RULES.md`, which this pattern does not match —
# MEASURED both ways before writing this line: fixture-skill/RULES.md stays SILENT, meta/RULES.md
# FIRES. So the old pin keeps its exact meaning (a non-meta skill's RULES.md is still out of
# family) and a NEW fire-arm was ADDED alongside it rather than flipping it. Preserving a pin and
# adding coverage beats re-deciding a pin whenever the narrower scope buys the same result.
KIND=""
IS_WHOLEREAD=""  # sub-kind of tracker: a file that is READ WHOLE by convention and is large
                 # enough that the generic tracker advisory is false on it. Same WARN arm,
                 # different payload. TWO populations today: a large SKILL.md, and a plan doc.
                 # ⛔ RENAMED from IS_SPEC 2026-09-13 when plans/ joined — the old name asserted
                 # a population the flag no longer selects, and a flag whose name lies is the
                 # rot class this file warns about elsewhere. 4 internal sites + one comment in
                 # scripts/skill-lint.mjs, swept in the same change.
WR_NOUN=""       # what the payload calls it: "spec" | "plan". The advisory's CLAIMS hold for
                 # both (measured: 119 of 119 over-band plan files carry `## ` headings, and
                 # dated blocks land at the end exactly as a spec's corrections do) — only the
                 # noun differed, so the noun is a variable rather than the text being forked.
case "$FILE_PATH" in
  .claude/skills/*/MEMORY*.md|*/.claude/skills/*/MEMORY*.md) KIND=skillmem ;;
  .claude/skills/meta/RULES.md|*/.claude/skills/meta/RULES.md) KIND=skillmem ;;
  # The RULES SHARDS join the same arm (2026-09-04). They are sized BY `scripts/rules-tier-split.mjs`
  # to sit under SKILLMEM_THRESHOLD — it reads that constant out of THIS file rather than restating
  # it — so today every one of them exits at the size gate below and this line is silent. It is here
  # for the day a section grows past the cap between splits: without it a shard falls through `*)`
  # ungated and returns a raw partial view, which is exactly how the CHANGELOG/WATCH-TIER/
  # ADOPTION-QUEUE siblings lost coverage the moment they left MEMORY.md.
  #
  # ⛔ AND THIS ARM IS ITSELF NAME-KEYED, WHICH IS WHAT THE LINE ABOVE FORBIDS.
  # Derived from the OBLIGATION (which files are read WHOLE and can
  # be oversize?), the population includes every large `SKILL.md`: measured 2026-09-04 against this
  # file's own SKILLMEM_THRESHOLD, five read SILENT — wrap 173,181 B (3.0x), expert-review 155,271,
  # meta 128,204, summary 71,318, review-hub 71,085 — and every expert brief in this repo says
  # "read your SKILL.md first", so they are read whole by construction. NOT widened in the same
  # change that found it: adding a deny arm over five specs on the critical path of most procedures
  # is a fleet-wide behaviour change and belongs in its own commit with the smoke counts read, not
  # as a ride-along in a RULES-split fold.
  # ⛔ "ON THE CRITICAL PATH OF MOST PROCEDURES" IS ~28x OVERSTATED FOR *THIS* HOOK AND IS STRUCK.
  # The specs are on that path, but this hook
  # sits on the READ plane and they are almost always delivered by the SKILL plane instead: 2,652
  # Skill invocations of the five against 93 Read calls on them, of which only 7 were UNBOUNDED —
  # the sole shape this arm warns on, about one fire per ten days. Both numbers are FLOORS: 756 of
  # 5,641 invocation records are unparseable JSON (13%). That rate is also the reasoned
  # answer to warn-vs-deny — one fire per ten days cannot habituate anyone, and it equally bounds
  # the value. Keep the arm; price any follow-up against 3.5% of deliveries, not against "most".
  .claude/skills/meta/RULES-SHARD-*.md|*/.claude/skills/meta/RULES-SHARD-*.md) KIND=skillmem ;;
  # ⛔ THE SIBLINGS THE `MEMORY*` KEY CANNOT REACH (2026-08-06). ARM B was widened to the
  # MEMORY family and that key is SHAPE-based, so three files in the SAME
  # directory at the SAME size fell straight through the `*)` exit: the CHANGELOG shards
  # (199,661 B — LARGER than any MEMORY shard) and the two registers carved out of
  # MEMORY.md, which HAD this coverage while they were inside it and silently
  # lost it the moment they became their own files. Measured before this line existed:
  # MEMORY-ARCHIVE deny / CHANGELOG-ARCHIVE ungated / WATCH-TIER ungated / ADOPTION-QUEUE
  # ungated. Derive this set from the OBLIGATION (which files are oversize and get read
  # whole?) — never from the naming family, which is what made the gap invisible.
  .claude/skills/*/CHANGELOG-ARCHIVE-*.md|*/.claude/skills/*/CHANGELOG-ARCHIVE-*.md) KIND=skillmem ;;
  .claude/skills/*/WATCH-TIER*.md|*/.claude/skills/*/WATCH-TIER*.md)                 KIND=skillmem ;;
  .claude/skills/*/ADOPTION-QUEUE*.md|*/.claude/skills/*/ADOPTION-QUEUE*.md)         KIND=skillmem ;;
  */project-memory/*.md|*/memory/*.md)                       KIND=tracker  ;;
  # ⛔ SKILL.md JOINS ARM A — THE **WARN** ARM, DELIBERATELY, NOT ARM B. Obligation-derived
  # (which files are read WHOLE and can be oversize?): every expert brief says "read your
  # SKILL.md first", and measured 2026-09-04 five sit 1.2-3.0x over SKILLMEM_THRESHOLD while
  # returning a PARTIAL view with is_error FALSE — wrap 173,181 B (3.0x), expert-review
  # 155,271, meta 128,204, summary 71,318, review-hub 71,085. Control before this line: a Read
  # of wrap/SKILL.md emitted 0 B on BOTH channels.
  # ⚠️ ROUTED TO tracker RATHER THAN skillmem ON PURPOSE. ARM B DENIES (three
  # `permissionDecision:"deny"` sites), and denying five specs on the critical path of most
  # procedures is a fleet event; ARM A only advises. That distinction is the whole reason this
  # shipped as one line instead of staying filed — and it rests on a measurement, not a reading:
  # ARM A's `warn_emit` at :83 is a FALLBACK that :86 OVERRIDES by sourcing lib/warn-emit.sh, so
  # it reaches the model via additionalContext. Verified with a positive control (a 358 KB
  # project-memory file: 458 B of additionalContext on stdout, 364 B on stderr). A review read
  # :83 alone and concluded the warn channel was mute; that is the one line to re-measure rather
  # than re-read if this is ever revisited.
  .claude/skills/*/SKILL.md|*/.claude/skills/*/SKILL.md)     KIND=tracker; IS_WHOLEREAD=1; WR_NOUN=spec ;;
  # ⛔ plans/ JOINS THE WARN ARM. The plan file is the POST-COMPACTION
  # RE-READ PATH — `compact-save.sh` prints it at every compaction and `post-compact/SKILL.md`
  # Step 6 calls it "the only copy" — and this hook had ZERO plans/ arms, so a recovering session
  # reading its own plan got a silent PREFIX at the exact moment its context was gone.
  # MEASURED before wiring, fleet-wide over 242 top-level transcripts: 441 Read calls on plans/
  # paths, of which 105 UNBOUNDED — against 7 for the five over-band SKILL.md specs that already
  # hold an arm, so this class is ~15x more active than the one already covered. A FLOOR: the
  # sub-agent plane (11,266 files) is not in that count.
  # WARN and not DENY, deliberately: 119 tracked plan files are already over TRACKER_THRESHOLD,
  # so the baseline is DIRTY and warn-before-block applies. A deny arm over a dirty baseline
  # is a fleet-wide behaviour change, and this file's own SKILL.md note says such a widening
  # belongs in its own commit with the smoke counts read — not as a ride-along.
  # Scope: `*` crosses `/` in a case pattern (measured, both spellings), so nested and absolute
  # plan paths match while `notplans/x.md` and `src/plans.md` correctly do not.
  plans/*.md|*/plans/*.md)                                   KIND=tracker; IS_WHOLEREAD=1; WR_NOUN=plan ;;
  *) exit 0 ;;
esac

# ⛔ A PRESENT `limit` IS NOT PROOF OF A SURGICAL READ.
# `limit` bounds LINES; both Read caps are BYTES/TOKENS. The two quantities are
# related only through a per-file DENSITY this hook must never assume. Measured on
# meta/MEMORY.md (2,956,509 B, mean 239 B/line, MAX line 8,718 B): 6,568 of 12,042
# sliding 300-line windows — 54.5% — exceed the 57,500 B band, and 30 exceed even
# the 262,144 B hard cap (worst 272,570 B at line 288). The predicate this replaced
# (`[ -n "$LIMIT" ] && exit 0`) allowed every one of them. That is worse than a
# plain miss: the paged remedy this guard PRESCRIBES silently truncates more than
# half the time, and the agent then reports `Memory-load: PARTIAL(A-B)` believing
# it received A-B — a guard manufacturing the exact false confidence it exists to
# prevent. meta is the only over-threshold file post-wave and is exempt from the
# ratchet + split, so this read guard is its ONLY defense.
# ⚠️ AND THE MEAN IS NOT A USABLE PROXY: one 8,718 B line is 36x the mean, so any
# density ESTIMATE is refuted by this file's own shape. MEASURE the window (awk is
# milliseconds on a 3 MB file); never estimate it.
# The TRACKER arm keeps the shortcut — its concern is context VOLUME, which any
# limit genuinely reduces, and it has no token-cap cliff to fall off.
# ⛔ THAT JUSTIFICATION IS FALSE FOR A LARGE `SKILL.md`, WHICH IS DEFINED BY HAVING
# EXACTLY THAT CLIFF. Measured on wrap/SKILL.md:
# 91.6% of its sliding 300-line windows exceed the band — against the 54.5% cited
# ~15 lines up as the reason ARM B MEASURES rather than trusting `limit`. LATENT,
# not live at the time of the fix (0 of 86 observed limited reads on the five specs
# exceeded the band, median 1,133 B), and folded here rather than filed because it
# is a handful of lines inside the arm that was already being corrected.
# So: real trackers keep the shortcut; a WHOLE-READ file (a spec OR a plan) falls through and its window is
# MEASURED in the ARM A payload below, where $bytes and the file check already ran.
if [ "$KIND" = "tracker" ] && [ -z "$IS_WHOLEREAD" ] && [ -n "$LIMIT" ]; then exit 0; fi

[ -f "$FILE_PATH" ] || exit 0
bytes=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
case "$bytes" in ''|*[!0-9]*) exit 0 ;; esac   # non-numeric guard — fail open

# ---------------------------- ARM B — skill MEMORY.md ----------------------------
if [ "$KIND" = "skillmem" ]; then
  [ -n "${SKIP_MEMORY_READ_GUARD:-}" ] && exit 0
  [ "$bytes" -le "$SKILLMEM_THRESHOLD" ] && exit 0
  # No jq => cannot emit the deny envelope at all. Fail OPEN (see header).
  command -v jq >/dev/null 2>&1 || exit 0
  lines=$(wc -l < "$FILE_PATH" 2>/dev/null | tr -d ' ')
  case "$lines" in ''|*[!0-9]*) exit 0 ;; esac   # fail open

  # BOUNDED read — MEASURE the requested window instead of trusting `limit`.
  if [ -n "$LIMIT" ]; then
    case "$LIMIT" in *[!0-9]*) exit 0 ;; esac     # non-numeric limit — fail OPEN
    # OFFSET: absent ⇒ 1 (a legitimate default). Garbage or negative ⇒ fail OPEN,
    # EXACTLY like the limit sibling above. Normalizing junk to 1 (what this did
    # until 2026-08-01) silently RETARGETED the guard: an offset of "xyz" became a
    # verdict about lines 1-300 — a region the caller never asked about — and the
    # advice named line numbers they had not requested. A guard may refuse, and it
    # may stand aside; it must never answer a question it was not asked.
    off="$OFFSET"; [ -z "$off" ] && off=1
    case "$off" in *[!0-9]*) exit 0 ;; esac       # non-numeric/negative — fail OPEN
    [ "$off" -lt 1 ] && exit 0                    # 0 or below — fail OPEN
    win=$(awk -v o="$off" -v l="$LIMIT" 'NR>=o && NR<o+l' "$FILE_PATH" 2>/dev/null | wc -c | tr -d ' ')
    case "$win" in ''|*[!0-9]*) exit 0 ;; esac    # awk/wc failure — fail OPEN
    # Genuinely surgical: the window fits in one read. Unchanged behaviour.
    [ "$win" -le "$SKILLMEM_THRESHOLD" ] && exit 0
    # ⛔ THE SUGGESTION IS WALKED, NOT SCALED (2026-08-01). This was
    # `LIMIT * THRESHOLD / win` — a proportional estimate off the window MEAN, while
    # the line above MEASURES. Measuring to DECIDE and estimating to ADVISE
    # contradicts this arm's own header one level down, and the error is not
    # academic: density is front-loaded and the narrowed window keeps the same
    # START, so the estimate assumes a density the shortened window does not have.
    # Swept over all 12,042 positions of meta/MEMORY.md: only 47% of the 6,568
    # denying windows converged in ONE step, 53% needed 2+, 4.2% needed >=7, worst
    # 23 — a guard that hands out advice needing 23 rounds is a guard nobody
    # follows. It also UNDER-shot (55 where 64 fit at offset 1497), wasting window.
    # The walk below accumulates real line bytes from the real offset and returns
    # the LARGEST k that fits: one step always, maximal window, no density model.
    # LC_ALL=C makes awk's length() count BYTES (these files are UTF-8; a
    # character-counting length() would under-count and over-suggest).
    sug=$(LC_ALL=C awk -v o="$off" -v cap="$SKILLMEM_THRESHOLD" '
      NR < o { next }
      { s += length($0) + 1; if (s > cap) { print NR - o; done = 1; exit } }
      END { if (!done) print NR - o + 1 }' "$FILE_PATH" 2>/dev/null)
    case "$sug" in ''|*[!0-9-]*) exit 0 ;; esac   # walk failure — fail OPEN
    end=$(( off + LIMIT - 1 ))
    wkb=$(( win / 1024 ))
    # LOOP-BREAK: the walk returns 0 when the SINGLE line at $off already exceeds the
    # band — no limit can satisfy the request, so re-prescribing one would loop the
    # caller forever. Do not emit a limit; redirect to a different strategy. (Not
    # reachable in today's corpus — meta's longest line is 8,718 B, 6.6x under the
    # band — but the walk makes it representable, so it is handled rather than
    # assumed away. The proportional estimate it replaced clamped to 1 here and
    # would have prescribed an impossible read.)
    if [ "$sug" -lt 1 ]; then
      lb_tw=$(tail_window "$FILE_PATH" "$SKILLMEM_THRESHOLD"); lb_off=${lb_tw% *}; lb_lim=${lb_tw#* }
      # ⛔ TWO SEPARATE CASES, NEVER `"$lb_off$lb_lim"` — a concatenation with ONE side empty still
      # reads all-digits and passes. `tail_window` was the only numeric acquisition in this file with
      # no fail-open guard while the header promises "Fail-OPEN on any parse/stat failure"; an empty
      # return produced two `[: : integer expression expected` errors and a payload reading
      # `offset= limit=   # MEASURED to fit the band` — a malformed prescription asserted as measured.
      case "$lb_off" in ''|*[!0-9]*) exit 0 ;; esac   # tail_window failure — fail OPEN
      case "$lb_lim" in ''|*[!0-9]*) exit 0 ;; esac
      [ "$lb_off" -lt 1 ] && lb_off=1
      [ "$lb_lim" -lt 1 ] && lb_lim=1
      # ⛔ SUPPRESS THE NEWEST-FIRST BULLET WHEN IT POINTS BACK AT THE OFFSET THAT WAS JUST REFUSED.
      # `tail_window`'s awk clamps `if (k < 1) k = 1`, so
      # on a file whose LAST line alone exceeds the band it returns that line — and when the caller
      # already asked for it, this bullet re-prescribes the identical coordinate. Measured on a
      # 400-line fixture with a 70,000 B final line: the parent converged in 3 rounds, this arm
      # returned `offset=400 limit=1` for six rounds and NEVER converged, while the header claims
      # "the caller always has a representable next step". LATENT today — longest final line across
      # the governed corpus is 2,248 B, 25.6x under the band — but the walk makes it representable,
      # so it is handled rather than assumed away. The grep strategy above is always a real step.
      if [ "$lb_off" = "$off" ]; then
        lb_bullet=""
      else
        lb_bullet="  * Or take the newest-first default, which starts from a different region:
        Read ${FILE_PATH} offset=${lb_off} limit=${lb_lim}   # MEASURED to fit the band
"
      fi
      REASON="Memory-read guard (GUARD 1, bounded-read arm): the SINGLE line at offset ${off} of ${FILE_PATH} is on its own larger than the ~${SKILLMEM_THRESHOLD} B one-read band, so NO \`limit\` can make this window fit — do not retry with a smaller number.

Use a different strategy:
  * Grep your consult topic in this file, then read a narrow window AROUND the hit
    (a few lines each side of the matched line number).
${lb_bullet}
Report what you actually received: Memory-load: PARTIAL(lines A-B of ${lines}).
Escape: SKIP_MEMORY_READ_GUARD=1"
      _wltr_fire arm bounded-loopbreak file "${FILE_PATH:-}" bytes "${bytes:-}" offset "${off:-}" limit "${LIMIT:-}"
      jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
      exit 0
    fi
    REASON="Memory-read guard (GUARD 1, bounded-read arm): your requested window of ${FILE_PATH} — lines ${off}-${end} (limit=${LIMIT}) — measures ${win} B (~${wkb} KB), past the ~${SKILLMEM_THRESHOLD} B one-read band. It was MEASURED with awk, not estimated.

A \`limit\` bounds LINES; the Read caps are BYTES/TOKENS. In this file those are related only by a density that varies per region, so a line count that looks modest can still overflow one read — and when it does, the result comes back looking complete and you would report \`Memory-load: PARTIAL(${off}-${end})\` having received less than that.

Narrow it — this is the LARGEST window that fits, walked line-by-line from your
own offset (not scaled from an average):
        Read ${FILE_PATH} offset=${off} limit=${sug}

Then report what you ACTUALLY received:
        Memory-load: PARTIAL(lines ${off}-<end> of ${lines})

⚠️ If any result carries a trailing truncation reminder, you did NOT get the whole
window: page again from where it stopped and SAY SO in your Memory-load line. An
unreported partial read is the failure this guard exists to prevent — a reported
one is a normal, honest outcome. Escape: SKIP_MEMORY_READ_GUARD=1"
    _wltr_fire arm bounded-window file "${FILE_PATH:-}" bytes "${bytes:-}" offset "${off:-}" limit "${LIMIT:-}" window "${win:-}"
    jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
  fi
  # COMPUTED remedy: these files are chronological with the NEWEST entry LAST,
  # so the useful default slice is the tail, not the head.
  tw=$(tail_window "$FILE_PATH" "$SKILLMEM_THRESHOLD"); tail_off=${tw% *}; tail_lim=${tw#* }
  case "$tail_off" in ''|*[!0-9]*) exit 0 ;; esac   # tail_window failure — fail OPEN
  case "$tail_lim" in ''|*[!0-9]*) exit 0 ;; esac   # two cases: a concatenation hides an empty half
  [ "$tail_off" -lt 1 ] && tail_off=1
  [ "$tail_lim" -lt 1 ] && tail_lim=1
  kb=$(( bytes / 1024 ))
  REASON="Memory-read guard (GUARD 1): ${FILE_PATH} is ${bytes} B (~${kb} KB) / ${lines} lines. An UNBOUNDED Read does NOT return this file whole — the Read tool caps at 25,000 tokens per call (~58 KB) and hard-errors past 262,144 B. Between those two, it returns a well-formed PREFIX and discloses the truncation only in a trailing reminder, so a blind read LOOKS complete and is not. Measured across 4,184 fleet dispatches: 87.3% of byte-capped reads never paged and never said so.

Read it deliberately instead — pick ONE:
  * NEWEST-FIRST (these files are chronological, newest LAST):
        Read ${FILE_PATH} offset=${tail_off} limit=${tail_lim}   # MEASURED to fit the band
  * TOPIC-FIRST (better when you know your consult topic):
        Grep your topic in this file to get line offsets, then Read that slice.

Then report this line in your output so synthesis can weight your verdict:
        Memory-load: PARTIAL(lines A-B of ${lines})

A partial read is not a failure — it is the honest outcome. A verdict from a
memory-blind expert is still admissible; it is the UNREPORTED blindness that
corrupts synthesis. Escape (you genuinely need the unbounded call, e.g. the file
is about to be split): SKIP_MEMORY_READ_GUARD=1"
  _wltr_fire arm unbounded file "${FILE_PATH:-}" bytes "${bytes:-}"
  jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
fi

# ------------------------------- ARM A — trackers --------------------------------
if [ "$bytes" -gt "$TRACKER_THRESHOLD" ]; then
  # ARM A is aimed at the ACTOR's NEXT tool call ("use a grep, not a full Read"), which is
  # the definition of a model-aimed advisory — and it was on bare stderr, the channel the
  # 2026-08-24 A/B proved the model never sees. ARM B above already reaches the model, but
  # only because it DENIES; the non-blocking half was mute. Mutually exclusive by control
  # flow: ARM B exits before reaching here, so two JSON documents can never concatenate.
  # ⛔ A WHOLE-READ FILE GETS ITS OWN PAYLOAD — THE TRACKER TEXT IS FALSE ON ALL THREE COUNTS HERE
  # (spec OR plan since 2026-09-13; both comments here named only SPEC until then — the same rot class
  #  the IS_SPEC->IS_WHOLEREAD rename was for, left behind by that rename.)
  # ⚠️ THIS WARN IS UNINSTRUMENTED BY DESIGN AND ITS LADDER HAS NO BOTTOM RUNG. All three _wltr_fire
  #  call sites sit in ARM B, each before a deny; this branch writes NO fires record, and the smoke
  #  suite PINS that absence as a deliberate negative control. So the warn-then-block ladder cannot
  #  be climbed from here — "observed-ignored" can never be established on a channel that produces no
  #  observations. Promoting this tier needs a fires channel FIRST, and adding one re-decides that
  #  pinned arm, which is the real cost rather than the one line. Stated rather than left implicit,
  #  as the alternative to instrumenting it.
  # The three counts:
  #   (1) "a full Read loads it ALL into context" is the OPPOSITE of the failure this arm
  #       was extended to cover. ARM B's own payload says an unbounded Read returns a
  #       well-formed PREFIX. Telling a seat the read was complete-but-wasteful is the
  #       false confidence the guard exists to prevent, emitted BY the guard.
  #   (2) Both prescriptions are dead on the five specs over the threshold: `"| Status"`
  #       is 0 in every one, and of 31 `Flow #` hits ZERO are headings — they are prose
  #       inside table cells and a command signature, so `rg` returns matches that are
  #       not addressable slices.
  #   (3) It named no remedy at all. ARM B computes a tail coordinate and demands a
  #       `Memory-load: PARTIAL(A-B of N)` report; this arm gave neither, leaving a seat
  #       that obeyed it no better off than one that got silence.
  if [ -n "$IS_WHOLEREAD" ]; then
    slines=$(wc -l < "$FILE_PATH" 2>/dev/null | tr -d ' ')
    case "$slines" in ''|*[!0-9]*) exit 0 ;; esac        # fail OPEN
    # BOUNDED read: MEASURE the window rather than trust `limit` (the ARM B discipline,
    # for the same reason — `limit` bounds LINES, the caps are BYTES/TOKENS).
    if [ -n "$LIMIT" ]; then
      case "$LIMIT" in *[!0-9]*) exit 0 ;; esac          # non-numeric — fail OPEN
      soff="$OFFSET"; [ -z "$soff" ] && soff=1
      case "$soff" in *[!0-9]*) exit 0 ;; esac           # non-numeric/negative — fail OPEN
      [ "$soff" -lt 1 ] && exit 0
      swin=$(awk -v o="$soff" -v l="$LIMIT" 'NR>=o && NR<o+l' "$FILE_PATH" 2>/dev/null | wc -c | tr -d ' ')
      case "$swin" in ''|*[!0-9]*) exit 0 ;; esac        # awk/wc failure — fail OPEN
      [ "$swin" -le "$SKILLMEM_THRESHOLD" ] && exit 0    # the window genuinely fits — silent
    fi
    stw=$(tail_window "$FILE_PATH" "$SKILLMEM_THRESHOLD"); stw_off=${stw% *}; stw_lim=${stw#* }
    case "$stw_off" in ''|*[!0-9]*) exit 0 ;; esac   # tail_window failure — fail OPEN
    case "$stw_lim" in ''|*[!0-9]*) exit 0 ;; esac   # two cases: a concatenation hides an empty half
    [ "$stw_off" -lt 1 ] && stw_off=1
    [ "$stw_lim" -lt 1 ] && stw_lim=1
    # ⛔ A SESSION-WIDE CLAIM DERIVES OVER THE WHOLE PLAN, and it is noun-gated
    # because it is a fact about PLANS, not about specs: no closability verdict or other
    # session-wide statement may rest on less than the full plan. The
    # PARTIAL report below labels the LOAD; this labels the CLAIM SCOPE, and a seat can honestly
    # report a partial load and still emit an unscoped session-wide verdict.
    WR_SCOPE=""
    [ "$WR_NOUN" = plan ] && WR_SCOPE="A session-wide claim — a closability verdict, a status table, \"nothing is open\" — DERIVES OVER THE WHOLE PLAN. A windowed read supports a WINDOW claim, and it must say which window."
    # ⛔ TWO CONSTANTS, ONE PATH, AND AN UNPRICED POPULATION BETWEEN THEM — FIXED 2026-09-13.
    # This branch FIRES at TRACKER_THRESHOLD and SIZES its
    # window at SKILLMEM_THRESHOLD, so for a file in the gap the old single payload asserted a
    # truncation that was not happening and then prescribed `offset=1 limit=<every line>` — which IS
    # the unbounded read the sentence above it had just called unsafe — under a step labelled TAIL
    # that delivered the HEAD. Measured at HEAD: 120 plan files fire, **14 of them (11.7%) sit in the
    # gap**, one of them a session-*.md, i.e. the post-compaction consumer this arm was built for.
    # It was LATENT for the old population and this commit made it LIVE: of 9 over-band SKILL.md
    # specs, ZERO are in the gap, which is exactly why the spec era never exposed it.
    if [ "$bytes" -gt "$SKILLMEM_THRESHOLD" ]; then
    warn_emit <<EOF || true

ℹ️  large-$WR_NOUN Read: $FILE_PATH is $bytes B (~$((bytes / 1024)) KB) / $slines lines. An unbounded Read does NOT return it whole — the Read tool caps at ~25,000 tokens per call and hard-errors past 262,144 B; between those it returns a well-formed PREFIX and discloses the truncation only in a trailing reminder, so the read LOOKS complete and is not.
Read it deliberately instead — pick ONE:
  * TOPIC-FIRST (best here — a $WR_NOUN is navigable by heading, not by row):
        grep -n '^#\+ ' $FILE_PATH        # then Read that slice by offset
  * TAIL (a $WR_NOUN's corrections and dated rulings land at the END of a section):
        Read $FILE_PATH offset=$stw_off limit=$stw_lim   # MEASURED to fit the band
Then report what you ACTUALLY received:
        Memory-load: PARTIAL(lines A-B of $slines)
$WR_SCOPE
An unreported partial read of a procedure is how a mandated step goes missing. This arm only advises — nothing is blocked.

EOF
    else
    # IN THE GAP: over the advisory line, under the one-read band. The file almost certainly DOES
    # return whole, so claiming otherwise is false and a TAIL coordinate here is the whole file.
    # But the real cap is TOKENS and this constant is a BYTE proxy, so a dense file this size can
    # still truncate — hence "check", not "it is fine". Never re-merge this with the branch above.
    warn_emit <<EOF || true

ℹ️  large-$WR_NOUN Read: $FILE_PATH is $bytes B (~$((bytes / 1024)) KB) / $slines lines — over the $TRACKER_THRESHOLD B advisory line but UNDER the $SKILLMEM_THRESHOLD B one-read band, so an unbounded Read most likely DID return it whole. This arm fires on BYTES and the real cap is TOKENS, so a dense $WR_NOUN this size can still truncate: do not assume either way — CHECK for a trailing truncation reminder on the read you just made.
If it truncated, or you only need one part:
  * TOPIC-FIRST (a $WR_NOUN is navigable by heading, not by row):
        grep -n '^#\+ ' $FILE_PATH        # then Read that slice by offset
If it truncated, report what you ACTUALLY received:
        Memory-load: PARTIAL(lines A-B of $slines)
$WR_SCOPE
An unreported partial read of a procedure is how a mandated step goes missing. This arm only advises — nothing is blocked.

EOF
    fi
  else
    # The tracker is two-tier: a router plus -SHARD-*.md files beside it. Point the
    # reader at the GLOB, never at the single path they happened to Read — a grep of
    # the router alone is a clean zero for every row that now lives in a shard.
    TRACKER_GLOB="$(printf '%s' "$FILE_PATH" | sed 's/-SHARD-.*//; s/\.md$//')*.md"
    warn_emit <<EOF || true

ℹ️  large-tracker Read: $FILE_PATH is ~$((bytes / 1024)) KB — a full Read loads it ALL into context for data a grep returns in <1 KB. For status counts: awk the Status column, keying it off the header rather than a fixed field index (two row layouts exist). For one flow/feature, anchor on the ROW and grep the GLOB: grep -nE '^\| <N> \|' $TRACKER_GLOB (features: '^\| F<N> \|'). NOT rg "Flow #N" — rows are keyed | N |, so the prose form misses the right row for 26 of 69 (13 return nothing, 13 return a DIFFERENT flow's row), and a single-file grep reads the router alone. Use Read with offset+limit only if you need a specific slice.

EOF
  fi
fi

exit 0
