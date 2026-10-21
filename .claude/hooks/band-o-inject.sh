#!/usr/bin/env bash
# UserPromptSubmit — inject the orchestrator-only Band (Band-O) into the orchestrator's own
# context every turn. Sub-agents do NOT fire UserPromptSubmit, so they never receive it — the
# whole point of the 2-band split (~14.5 KB off every sub-agent dispatch). additionalContext
# caps at 10K CHARACTERS/value (unit MEASURED 2026-07-31 with a divergent-unit CJK probe:
# 9,516 chars / 28,322 bytes landed intact, so no byte cap exists below 28,322; the earlier
# "probe-confirmed 2026-07-12" tag was ASCII, where chars==bytes, and could not discriminate
# the unit it was cited for). The FULL band ships in N concatenated chunks; arg $1 = the chunk
# number, split at the CHUNK-BOUNDARY markers in the source file. ⛔ THE COUNT IS DERIVED
# (`NPARTS`, :307) AND THIS HEADER MUST NOT RESTATE IT — it read "2 concatenated chunks … (1|2)"
# until 2026-09-05, while settings.json had wired THREE and 8,982 logged records carried chunk=3.
# A comment at :319 and :377 already said the count is derived and never hardcoded; the header
# contradicted them from 300 lines above, which is where a maintainer looks first.
#
# ⛔ EXERCISING THIS HOOK BY HAND WRITES A TELEMETRY RECORD — SET `BAND_O_NO_LOG=1`.
# Stated HERE because the guard is at :826, ~660 lines below where anyone looks, and the next
# hand-exerciser will do what the last one did: not find it, and write the record. The full
# rationale — including what the record does and does NOT bias — is at :803.
#
# ⛔ MAINTAINERS OF THE BAND FILE, READ THIS HERE — IT USED TO LIVE IN THE BAND ITSELF.
# The band's whole text reaches the orchestrator's live context, HTML comments INCLUDED: unlike
# CLAUDE.md and .claude/rules/*, which the harness strips comments from before injection, this
# file is read raw and injected verbatim. So a maintainer note in the band is paid on EVERY TURN,
# BY EVERY SEAT, forever. The note saying exactly that was itself 408 chars of it — self-refuting,
# and it was the single largest non-rule item in chunk 1 when the band breached its cap on
# 2026-08-18. Keep the band to RULES; every delivery mechanic, budget, split marker and rationale
# belongs in THIS file, which never reaches context.
#
# CAPACITY, MEASURED 2026-08-18 — the band is near its ceiling and this is not a stable state.
# Derived per-chunk source bounds are 9,534 (chunk 1, which carries a prepended hash marker) and
# 9,737 (chunk 2) => total capacity 19,271. The band was 20,009 and chunk 1 was CLAMPING: 626
# chars dropped from every orchestrator turn on every seat, silently — the tail of the context-%
# row cut mid-word plus the ENTIRE "don't skip a code review because the diff is small" row.
# Fixed by removing ~780 chars of incident narration (Evidence cells carrying dated case lists,
# archive-homed parentheticals) and REORDERING two rows so the 455-char one crosses the boundary
# rather than the 559-char one. Row order in a scan table carries no semantics; that reorder is
# free and is the lever to reach for first.
#
# ⚠️ THAT FIX BUYS ABOUT SIX DAYS. Band-O grew 15,322 -> 20,009 B in the 37 days since the split
# = ~127 B/day. Trimming is therefore NOT the answer to the next breach: a 400-char trim buys 3
# days, a THIRD CHUNK buys ~77. The code is already pre-placed for it (full_part() returns "" for
# an unrecognised index, deliberately), but wiring one is NOT a drive-by: `parts = split(MARK, 1)`
# caps at two, the "1"/"2" dispatch ladder needs a third branch, pack() targets AT MOST 2 parts,
# and chunk 2 FOLLOWS chunk 1's recorded decision through a state race that once lost rows
# (29 rows in, 21 delivered, 8 lost). Do it deliberately, with the digest path
# reasoned through, not at the tail of a long session.
#
# Probe-confirmed 2026-07-12: fires for the orchestrator on typed prompts, /autorun cron fires,
# and background/notification wakes; never sub-agents. (Moved here 2026-08-14 FROM the band
# file's own header comment, for the reason in the next paragraph.)
#
# ⛔ THE BAND FILE MUST NOT DESCRIBE ITS OWN DELIVERY, AND THIS IS WHERE THAT PROSE LIVES
#    INSTEAD. The band file's entire text — comments included — is injected verbatim into the
#    orchestrator's live context every turn. A sentence in there NAMING the split marker hands
#    the model a renderable artifact at the exact position (immediately before the user's first
#    prompt) where it is likeliest to continue the document rather than answer it. This hook is
#    never injected, so mechanism prose is free here and costly there.
#    HYPOTHESIS UNDER TEST (an authorized test — NOT a settled fix): FIVE sessions have
#    opened by emitting a fabricated Band-O-shaped document as their FIRST reply instead of
#    running the typed command. The emitted rows are NOVEL (confabulation, not leakage — one
#    invented rule cited a script with zero commits ever), yet every emission RENDERED a
#    CHUNK-BOUNDARY marker, and 3 of the 5 rendered a spelling that has never existed in any
#    file (`<!-- CHUNK-BOUNDARY -->` without the BAND-O- prefix, and `**CHUNK-BOUNDARY**`).
#    The band file's header comment was the ONLY in-context source of that token; the hook
#    STRIPS the real marker, so it can never be echoed from the delivered text.
#    Base rate is a step change: 0/68 BAND-O-ERA sessions (2026-07-12, the 2-band split, through
#    2026-08-08) and 5/13 after (38.5%, Wilson 95% CI 17.7-64.5%). ERA-SCOPED is the honest
#    denominator: a session predating the split cannot continue a document it was never sent, so
#    the all-sessions figure (0/134) is padded with structurally-immune sessions.
#    All five sat at assistant-message ordinal 1. Chunk size/split is ruled out
#    (chunk 1 was unchanged at 9,418 chars from 07-29 to this commit, 0 events over 24 sessions).
#    Strongest correlate is CLI >=2.1.225 — but DATE AND VERSION ARE COLLINEAR in this corpus and
#    CANNOT be separated by it, so a quiet week is not evidence this worked.
#    ⚠️ THE FIGURES ABOVE SUPERSEDE BOTH EARLIER COMMITS, AND THE DENOMINATOR TOOK THREE PASSES.
#    The first commit's message says 0/63 and 6/13 (a panel's counts, restated without re-derivation).
#    The second "corrected" the denominator to 0/134 — the WRONG WAY: 63 was ERA-SCOPED and
#    roughly right, while 134 counts sessions that predate Band-O and could not have echoed. The
#    numerator correction stands: a raw prose-shape scan returns 7, and hand-reading all 7 drops
#    two that merely SAY "Band-O" (a panel-sizing reply and a defer-trigger-scan readout), and
#    the Wilson interval every source quoted is arithmetically the one for 5/13, never 6/13.
#    Settled: 0/68 era-scoped, 5/13 after.
#    ⛔ A SECOND SUPPLIER, INDEPENDENT OF THE MARKER SENTENCE, FIXED IN THE SAME ARC. CLAUDE.md
#    described Band-O as holding `panel composition` and `hub delegation` rows. `git log -G` over
#    the band file's ENTIRE history finds neither, in any revision — the description was written
#    from the 2-band split's INTENT and never matched its contents (panel composition is a Band-U
#    SCAN TRIGGER, not a rule anywhere; hub delegation is behavioral-anti-patterns.md #9). So an
#    always-loaded file was PROMISING rows the injected file does not deliver, every turn. Two of
#    the emissions I read invent rows on exactly that missing topic — one "About to
#    synthesize a MULTI-AGENT panel/audit return", the other "About to write 'the panel
#    converged / N-way convergence'". A promised-but-absent topic is a slot the model fills.
#    The two levers are SEPARATELY FALSIFIABLE from one emission, so shipping both does not
#    confound the readout: the header deletion predicts the marker token stops being RENDERED;
#    the CLAUDE.md fix predicts invented rows stop CLUSTERING on panel composition.
#    CLAUDE.md's list is now derived from the 27 rows, each verified present.
#    READOUT: `python3 scripts/band-o-echo-scan.py` (self-tested, mention-vs-render split, and
#    the ladder is keyed to this commit's TIMESTAMP because the last event and the fix landed the
#    same day). Watch the marker FORM, not the rate — an emission rendering a token with no
#    in-context source is informative at N=1, a count is not. 7 clean starts rule out a 38% rate
#    at 95%, 14 rule out 20%, 29 rule out 10%. Record the CLI version per start or the readout
#    cannot be interpreted. A/B toggle: SKIP_BAND_O_INJECT=1 (below).
# ALWAYS exits 0 — a Band-O bug must never block a user's turn. Reference: mail-listen-arm-reminder.sh.
#
# ⛔ INPUT-KEYED SUPPRESSION (skip-the-turn dedup) STAYS DEAD — that decision is unchanged.
#    These rules fire on what the orchestrator is about to WRITE, not
#    on what arrived, so no input-keyed SKIP can predict whether a row is needed — and a
#    task-notification turn IS a composition turn (agent returns get dispositioned there).
#    No turn is ever skipped by this hook.
#
#    WHAT SHIPPED INSTEAD (the design panel's synthesis, approved to ship as-is):
#    DOSE REDUCTION. Every turn still receives
#    a payload — digest-eligible background wakes get a single-chunk DIGEST (every TRIGGER cell
#    VERBATIM + bounded action HEADS + a READ-on-match pointer at the [BAND-O-FULL <hash8>]
#    full copy upthread) instead of the two full chunks. FULL is emitted on: typed/slash
#    prompts (owner turns are always full) · absent/corrupt/foreign per-session state · the
#    first injection after ANY SessionStart (session-start.sh deletes the state file, so a
#    fresh window never starts on a digest) · a PreCompact marker (post-compact-pending-<sid>)
#    newer than the last full (compact-save.sh writes it at every compaction — the epoch key) ·
#    a band-file md5 change · a 10-turn heartbeat · any digest generation/parse failure · a
#    deterministic 1-in-10 HOLDOUT draw. The holdout arm IS the salience instrument that
#    decision named as its own re-open condition: compare holdout-arm vs digest-arm
#    compliance from the `mode`/`arm` log fields (pre-registered threshold: digest-arm >2x
#    miss-rate over >=10 paired observations => restore full dose).
#    digest_rate alarms — ⚠️ THE DENOMINATOR IS DIGEST-ELIGIBLE TURNS
#    (mode != full_typed), NEVER all injections. A typed prompt is never eligible by design, so
#    an all-injection rate tracks how much the owner is TYPING rather than parser health, and
#    trips the low alarm on a perfectly working hook: measured in the first 20 live records,
#    30.0% all-injection vs 54.5% eligible. Corrected here rather than in the field because the
#    original pre-registration omitted the denominator and would have argued for reverting a
#    working mechanism. Over ELIGIBLE turns: <50% => the digest path is dead and the savings are
#    silently gone; >96% => the HOLDOUT arm has stopped firing, so the salience instrument is
#    dead while the digest keeps running (the wired-but-inert direction, and the more useful reading of the
#    high alarm) — the holdout is 1-in-10 by construction, so a healthy eligible rate cannot
#    exceed ~90% and a sustained reading above that is itself the finding.
#    The pre-ship $0 baseline measured
#    compliance decaying 73%->50% across wake-run positions WITH full injection every turn,
#    and the decayed component was the rules' ACTION FORM — so the digest carries action
#    HEADS, not trigger-only (the panel's own pre-registered widening rule, fired pre-ship).
#
#    FAIL DIRECTION (constraint 1 of the panel spec): every decision/state/digest failure
#    emits FULL; the only silent path is today's pre-existing one (band file unreadable).
#    A hook bug must never block a turn NOR silently thin the band.
set -u
INPUT="$(cat 2>/dev/null || true)"
# Escape valve. 13 sibling hooks carry one; this had none. `=1` only, so a stray `=0`/`=no`
# cannot bypass. Placed AFTER the stdin drain so an opted-out turn still consumes its payload.
# Doubles as the A/B toggle for the context-echo hypothesis above: it turns Band-O off for one
# session without editing a fleet-wide file.
[[ "${SKIP_BAND_O_INJECT:-0}" == "1" ]] && exit 0
CHUNK="${1:-1}"
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
FILE="$DIR/.claude/orchestrator/active-recall-orchestrator.md"
# ⛔ VISIBLE-DARK, NOT SILENT-DARK. If the band file is missing, renamed or moved, both chunks
#    used to emit nothing at rc=0: the ENTIRE orchestrator band gone from every turn, on every
#    seat, with no signal anywhere — wired-but-inert, at the top of the hook that enforces
#    it. Chunk 1 now says so in one line. Still rc=0: a Band-O bug must never block a turn.
if [ ! -f "$FILE" ]; then
  [ "$CHUNK" = "1" ] && printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<!-- BAND-O DARK: .claude/orchestrator/active-recall-orchestrator.md is missing, so the orchestrator-only rules are NOT loaded this turn. Scan .claude/rules/active-recall.md instead, and say so before relying on any orchestrator-only rule. -->"}}'
  exit 0
fi
# NOTE: the payload goes via a TEMP FILE, not a pipe and not an env var.
#   - not a PIPE: `python3 - <<HEREDOC` takes the PROGRAM from stdin, so a piped payload is
#     unreachable at sys.stdin.read() -- that exact bug shipped here for one minute and logged
#     has_prompt=false for a payload that plainly had one. Caught by the positive control.
#   - not an ENV VAR: macOS caps env+args at ~1 MB (bisected 1,019 KB ok /
#     1,024 KB E2BIG); past it execve fails, the interpreter NEVER STARTS, and the `|| true`
#     swallows it. That failure is SIZE-SELECTIVE in the one direction that ruins the log: an
#     oversized payload is exactly a typed-prompt-with-a-large-paste (found by a
#     later review). Both chunks need the payload now (typed/wake classification + the
#     deterministic holdout draw), so the temp file is created for both.
PF="$(mktemp "${TMPDIR:-/tmp}/bandolog.XXXXXX" 2>/dev/null)" || PF=""
if [ -n "$PF" ]; then printf '%s' "$INPUT" > "$PF" 2>/dev/null || true; fi
python3 - "$FILE" "$CHUNK" "${PF:-/dev/null}" "$DIR" <<'PY' || true
import json, sys, os, re, time, hashlib, datetime

band_path, chunk, payload_path, root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

# ── chunk-size constants. ONE source, because they are not independent ───────────────
# additionalContext caps at 10K CHARACTERS/value (unit measured, see the file header), so a
# chunk above EMIT_CLAMP_ABOVE is truncated to a PREFIX rather than emitted whole.
EMIT_CLAMP_ABOVE = 9800          # emit() clamps anything STRICTLY above this
EMIT_CLAMP_TO = 9700             # ...to this prefix, plus a marker
# ⛔ DIGEST_CAP IS DERIVED, NOT CHOSEN, AND THE EQUALITY IS THE SAFETY ARGUMENT. The ladder
# accepts a render only when len(dg) <= DIGEST_CAP, and emit() clamps only when len(part) >
# EMIT_CLAMP_ABOVE. Setting them EQUAL makes "a digest is never clamped" true by construction
# rather than true by margin — at DIGEST_CAP exactly, `len > EMIT_CLAMP_ABOVE` is False. The
# digest is emitted ALONE (`emit(dg)`), so its length IS the chunk length; nothing is appended
# between build and emit, and emit's own `strip("\n")` can only shrink it.
# It was an independent literal 9200 until it was deliberately raised: a third constant
# with no stated relationship to the two above, so a future change to the clamp would silently
# strand it — the same shape as the MIN_DRAW_N defect in scripts/band-o-digest-metrics.py,
# where a companion constant did not track the derivation it belonged to.
# ⚠️ RAISING THIS DOES NOT BUY A HIGHER RUNG at the 2026-08-14 band: rung 80 renders 9,611,
# which overflows even at 9,500. It buys HEADROOM (129 -> 429 chars) against the silent
# fleet-wide death of the digest. Re-derive with
# `python3 scripts/band-o-digest-metrics.py`; never restate the number from here.
# RAISED 9,500 -> 9,800 (a deliberate decision to raise the cap and proceed) after
# the alarm re-fired at HEADROOM 78.
# ⛔ MEASURED OUTCOME, AND IT IS NOT THE ONE THE NOTE ABOVE PREDICTS: A CAP RAISE PARTIALLY
# SELF-CONSUMES, BECAUSE build_digest() PICKS THE HIGHEST RUNG THAT FITS. The +300 did not
# become +300 of headroom; the ladder climbed to RUNG 80 and spent 165 of it on a richer
# render. Digest 9,422 -> 9,587, headroom 78 -> 213. The note above is right that rung 80
# renders ~9,611 and overflows at 9,500 — what it misses is that raising the cap is exactly
# what makes that rung reachable, so 'it buys HEADROOM' is true only for a raise too small to
# unlock a rung. The gain is real but it is DOSE quality (action text 18.3% pooled / 26.2%
# median per row), not runway: headroom 213 is still under the 300 alarm, which still fires.
# ⛔ SO THE CAP LEVER IS SPENT. additionalContext caps at 10,000 chars and the digest is now
# 9,587, leaving ~413 even at a zero-margin ceiling — and the ladder would likely eat part of
# that too. The next headroom alarm is a DOSE question; do not answer it with another raise.
# ⛔ EVERYTHING IN THE PARAGRAPH ABOVE IS REFUTED — AND IT IS THE ONE CARRIER THAT NEVER GOT THE
#    CORRECTION (2026-08-18). The "213 headroom" it reasons from was the alarm reading part 1,
#    which is GREEDY-FILLED: pack() appends rows until the next one will not fit and then stops,
#    so part 1's remainder is bounded ABOVE by whichever row did not fit and is structurally
#    incapable of being large no matter how healthy the system is. It is a BOUNDARY ARTIFACT,
#    not capacity. The binding part is the LAST one — the only part pack() can refuse on — and
#    it read 7,943 spare at the same moment, about 28 median rows. The alarm was ~37x pessimistic
#    and it is what drove the cap raise. Fixed in the metrics script; the sawtooth
#    dies with it (moving the cap moves the SPLIT BOUNDARY, so the leftover lands between
#    different rows — a boundary wandering, never a capacity curve).
#    ⚠️ READ THE LIVE NUMBER, NEVER THIS PARAGRAPH: `python3 scripts/band-o-digest-metrics.py`
#    prints the binding part and its headroom. NO VALUE IS QUOTED HERE ON PURPOSE — an earlier
#    draft ended this line with a fresh reading, inside the one paragraph whose entire lesson is
#    that a written number rots. Six weeks out it would have read as current. The pointer does
#    the work; a number beside it only competes with the instrument.
#    ⛔ AND DO NOT DELETE THE REFUTED TEXT ABOVE — it is kept deliberately, fenced, because its
#    reasoning was sound on a false input and a reader who meets only the conclusion cannot tell
#    which half to distrust. **The transferable half is WHY this carrier was the one that rotted:
#    the refutation reached the metrics script and the tracker row and stopped, because those are
#    where the WORK was. This file is where the next person READS BEFORE TOUCHING THE CAP — it
#    carries a PRESCRIPTION ("do not answer it with another raise"), not just a stale snapshot,
#    so a stale reader here does not merely believe something false, they act on it.**
# ✅ THAT CEILING IS SETTLED, AND THE ANSWER RETIRES THE WORRY RATHER THAN CONFIRMING IT
# (2026-08-17, docs.claude.com/en/hooks.md § JSON output + § Add context for Claude, fetched
# and grepped). The cap is 10,000 CHARACTERS per additionalContext value — documented, unit
# explicit. ⛔ OVER-LIMIT IS NEITHER TRUNCATION NOR A DROP: the full text is written to a file
# in the session directory and Claude receives a PATH PLUS A PREVIEW, so exceeding it degrades
# LOUDLY and observably — the exact property the old "extrapolation is live" note feared was
# absent. And emit() never ships above EMIT_CLAMP_ABOVE, so the harness limit is unreachable
# by construction with 200 chars to spare. The 9,516 CJK probe stays the highest MEASURED
# value and is no longer load-bearing: the range above it now has documented semantics.
# ⛔ THE REAL SILENT-DROP PATH IS A DIFFERENT AXIS, AND NOBODY HAD IT: a UserPromptSubmit hook
# that reaches its TIMEOUT is cancelled and its output — additionalContext INCLUDED — is
# DISCARDED. No marker, no partial, no file; the whole band vanishes with no tell, which is
# strictly worse than any size behaviour above. settings.json declares no `timeout` for either
# band-o entry, so both run on the 30s default. Measured 2026-08-17 over 3 runs: this hook
# returns in 53-56 ms, a ~540x margin, so the hazard is NOT live — it is the one to watch if
# this hook ever grows an I/O wait (a network call, a lock, a large git operation).
DIGEST_CAP = EMIT_CLAMP_ABOVE

# ⛔ ROWS WHOSE ACTION CELL SHIPS IN FULL, NEVER TRUNCATED — a settled decision.
# A fresh-context audit classified all 27 cut remainders and found 3 STRANDED: rows whose cut
# half carries an EXCEPTION to a rule the always-loaded corpus ships in its most forceful form.
# Truncation is asymmetric there — it keeps the general rule (which lives elsewhere in full) and
# drops the local exemption (which lives ONLY in this cell), so the digest failed hardest on
# exactly the rows whose job is to say "the loaded rule does not apply here". Worked example: the
# conditional-severity row's head says SIZE THE POPULATION FIRST while its cut says ASK THE OWNER
# and names a recorded lesson as not applying — so from the head alone a reader reaches for a GATED instrument
# instead of one free question.
#
# ⚠️ A LONGER RUNG CANNOT FIX THIS AND THAT IS WHY THE LIST EXISTS. The carve-outs sit at char
# 167 / 332 / 623 of their action cells and the ladder's most generous rung is 240, so two of the
# three are rescued by NO rung. Exempting them costs +1,330 chars, which overflows one chunk and
# fits two — hence the two-part digest below.
#
# Keys are TRIGGER-cell prefixes, which are safe to key on precisely because trigger cells are
# FROZEN by scripts/band-directive-preservation.mjs (a changed cell REDs). If a key ever stops
# matching, build_digest() returns None and the turn falls back to FULL rather than silently
# dropping the exemption — the fail-loud direction, visible as fallback_full_digest in the log.
EXEMPT_TRIGGER_PREFIXES = (
    "A test fails (vitest",
    "About to ACT on / ESCALATE / BROADCAST",
    "About to `mail-send --to all`",
)
# Part 2's own opening. It repeats the table header in effect at the split so the continuation
# parses as a table standalone, and says plainly that it is a continuation — a reader who somehow
# receives only part 2 must not mistake it for the whole band.
# ⛔ THE SPLIT MUST BE ANNOUNCED IN **BOTH** DIRECTIONS, and the part-1 half is the one that is
# easy to forget: part 2 already says "if you did not receive part 1 this is PARTIAL", so the
# part-2-only reader is covered. The part-1-only reader was NOT — they saw a complete-LOOKING
# digest with three rows' worth of content silently absent and no signal at all. That is not a
# hypothetical: this hook's own chunk-2 comment records "a single turn missing chunk 2" as a real
# transient state under a mid-flight state race. Asymmetric protection is worse than none here,
# because the covered direction makes the mechanism look handled.
# LEADING, never trailing: emit() clamps to a PREFIX, so a footer notice is the first thing an
# over-budget digest loses — the same reason the VOID CHECK leads (smoke arm: "the digest's VOID
# CHECK sits in the leading block").
DIGEST_SPLIT = ("<!-- ⛔ THIS DIGEST IS SPLIT: a part 2 of 2 follows as a SECOND injection on this\n"
                "     same turn. If you did NOT receive a part 2, this band is PARTIAL — Read\n"
                "     .claude/orchestrator/active-recall-orchestrator.md NOW. -->")
DIGEST_CONT = ("<!-- BAND-O DIGEST — CONTINUATION (part 2 of 2). Same digest, same rules as part 1:\n"
               "     TRIGGER cells VERBATIM, ACTION cells truncated heads except where shipped in\n"
               "     full. If you did not receive part 1, this is a PARTIAL band — Read\n"
               "     .claude/orchestrator/active-recall-orchestrator.md NOW. -->")


def emit(part):
    part = part.strip("\n")
    if not part.strip():
        return
    if len(part) > EMIT_CLAMP_ABOVE:
        part = part[:EMIT_CLAMP_TO] + "\n<!-- BAND-O chunk over 9.8K — SPLIT FURTHER (see band-o-budget smoke-test) -->"
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": part}}))

try:
    band_bytes = open(band_path, "rb").read()
    text = band_bytes.decode("utf-8")
except Exception:
    sys.exit(0)

MARK = "<!-- BAND-O-CHUNK-BOUNDARY -->"
# ⛔ UNBOUNDED SPLIT (2026-08-18). Was `split(MARK, 1)`, which capped the band
# at TWO chunks by construction: a second boundary marker in the band file was swallowed into
# chunk 2's text as a literal comment and its content still had to fit chunk 2's budget. So the
# maxsplit was the actual capacity ceiling, not the marker count.
parts = text.split(MARK)
NPARTS = len(parts)

def full_part(idx):
    # `idx` is an INDEX, not a boolean. The pre-2026-08-12 form was `... else (parts[1] if ...)`,
    # so EVERY non-"1" argument returned chunk 2 -- `band-o-inject.sh 3` emitted chunk 2 verbatim
    # (measured: chunk 2 and chunk 3 byte-identical), valid JSON, rc=0, no marker. Wiring a 3rd
    # settings.json entry without this guard would inject chunk 2 twice and drop the real chunk 3
    # with nothing to notice. An unrecognised or out-of-range index yields "" => emit() no-ops
    # silently, the correct no-op.
    # ⛔ THE REMAINING SILENT-LOSS PATH IS UNDER-WIRING, NOT MIS-INDEXING: if the band grows a
    # boundary marker and settings.json is NOT given a matching entry, the tail chunk is simply
    # never requested — every guard here passes, rc=0, valid JSON, and the rules vanish. That is
    # why FULL_SPLIT below states the REAL part count (NPARTS) rather than a hardcoded "2": a
    # reader who receives "part 2 of 3" and no part 3 can SEE the loss. Making the count visible
    # is the only defence available from inside a hook that cannot know how it was wired.
    try:
        i = int(idx)
    except (TypeError, ValueError):
        return ""
    return parts[i - 1] if 1 <= i <= NPARTS else ""

h8 = hashlib.md5(band_bytes).hexdigest()[:8]
# PREPENDED to every FULL chunk-1 emission so a later DIGEST can point at the newest full copy
# upthread.
# ⛔ PREPENDED, NOT APPENDED, AND THAT IS THE WHOLE POINT.
#    emit() clamps an over-budget chunk to a PREFIX (part[:9400] + a marker). The first version
#    of this appended the tag AFTER the band text, so the moment chunk-1 SOURCE passed 9,468
#    chars the clamp ate the anchor off EVERY full copy while digests kept emitting a pointer to
#    it — a dangling pointer reached with no race at all, purely by the band growing, and the
#    exact outcome this design names unacceptable. Reproduced at source 9,480.
#    A head-clamp always keeps a PREFIX, so a prepended anchor cannot be truncated: the failure
#    now lands on the band's own tail (the pre-existing, gated, loud clamp behaviour) instead of
#    on the anchor. Headroom at the clamp was 50 chars when this was found; the smoke bound
#    (9,460) gates earlier, but it gates at PUSH and this fleet runs ~200 unpushed commits.
# ⛔ AND THE LITERAL IS DELIBERATELY DISTINCT FROM ANYTHING THE DIGEST RENDERS. The digest
#    must never contain this exact token, or a consumer's search for it self-satisfies and the
#    VOID CHECK becomes structurally incapable of returning zero — which is what happened, and
#    it voided the first reading taken of it. See the VOID-CHECK footer in build_digest().
FULL_TAG = "<!-- BAND-O-FULL-COPY %s -->" % h8

# ⛔ THE MIRROR OF DIGEST_SPLIT / DIGEST_CONT ON THE **FULL** PATH (2026-08-16). An earlier change fixed a
#    one-sided split announcement on the DIGEST path and left the identical defect standing here:
#    FULL chunk 1 carried FULL_TAG, FULL chunk 2 carried NOTHING — no tag, no continuation marker,
#    nothing — so a reader who received only chunk 2 got ~9,400 chars opening mid-table with no
#    signal that half the band was missing. That fix's own rationale, now sitting in this file at
#    :193-195 — "asymmetric protection is worse than none here, because the covered direction makes
#    the mechanism look handled" — was written INTO the digest fix and applied to one of two paths.
#    The digest notice was verified BY OBSERVATION (a reader received one), which is the strongest
#    evidence available and structurally could only ever cover the half that was fixed.
# ⛔ BOTH ARE PREPENDED, for the FULL_TAG reason above: emit() clamps to a PREFIX, so a LEADING
#    notice survives a clamp and a trailing one is the first thing an over-budget chunk loses.
# ⛔ EACH ONE LOWERS ITS CHUNK'S SMOKE BOUND BY ITS OWN LENGTH, IN THE SAME CHANGE. That coupling
#    is not new — each chunk's bound sits BELOW the cap "because the clamp compares source+prefix,
#    not source alone" (smoke-test-hooks.sh). A prefix added WITHOUT moving the bound leaves a gate
#    that passes at a source size the hook then clamps: the gate stops gating and says nothing.
# ⛔ DO NOT RESTATE THE BOUNDS HERE — THEY ARE DERIVED FROM THE CAP AND THIS COMMENT ROTTED ONCE.
#    The smoke test now computes them (grep `the bound TRACKS the cap` in smoke-test-hooks.sh);
#    read them THERE. This block carried `9460`/`9500` from 2026-08-16, and the 2026-08-14 raise to
#    EMIT_CLAMP_ABOVE = 9800 moved the real pair to 9534/9737 without touching the prose — so a
#    reader re-deriving "spare" off these numbers was ~270 chars out, in the permissive direction.
#    It was minor rather than serious precisely because a test of the emission caught the drift the
#    prose did not: the GATE tracked the cap, only the sentence describing it did not.
# ⛔ WHY FULL_CONT IS ONE SHORT LINE AND NOT A MIRROR OF DIGEST_CONT'S FOUR — MEASURED 2026-08-16
#    UNDER THE THEN-CAP OF 9500 (historical; the ratio is the point, not the digits):
#    chunk 1 source 9,008 vs its 9460 bound = 452 spare (room for a real notice); chunk 2 source
#    9,410 vs 9500 = **90 spare**. The chunk that most needs the announcement is the one with
#    almost no room. FULL_CONT spends ~69 of those 90 deliberately; the residual is small, the
#    gate fires early and loud, and the REMEDY it names is free — move the CHUNK-BOUNDARY marker
#    LATER in the band file, which shifts text from chunk 2 into chunk 1's 226 remaining chars.
#    That rebalance costs ZERO dose: same total band, different split point.
# ⛔ THE COUNT IS DERIVED (NPARTS), NEVER HARDCODED — see full_part()'s under-wiring note. A
# hardcoded "2 of 2" would keep announcing two parts after the band grew a third boundary, so the
# one signal a reader has that a chunk went missing would itself be the thing that lied.
FULL_SPLIT = ("<!-- ⛔ THIS FULL BAND IS SPLIT INTO %d PARTS: parts 2..%d follow as SEPARATE\n"
              "     injections on this same turn. If you did NOT receive all %d, this band is\n"
              "     PARTIAL — Read .claude/orchestrator/active-recall-orchestrator.md NOW. -->"
              % (NPARTS, NPARTS, NPARTS))
def full_cont(i):
    return "<!-- BAND-O FULL %d/%d %s — alone ⇒ PARTIAL band. -->" % (i, NPARTS, h8)
FULL_CONT = full_cont(2)

try:
    with open(payload_path, encoding="utf-8", errors="replace") as f:
        raw = f.read()
except Exception:
    raw = ""
try:
    d = json.loads(raw) if raw.strip() else {}
except Exception:
    d = {}
prompt = d.get("prompt")
# Per-prompt identity, used to bind chunk 2's follow-decision to THIS turn (see the chunk-2
# branch). Read defensively: the hook must not depend on the harness supplying it — when it
# is absent the follow path falls through to re-derivation, which is the fail-toward-more
# direction this hook takes everywhere.
prompt_id = d.get("prompt_id")
sid = str(d.get("session_id") or "")
sid8 = sid.lower()[:8]
payload_md5 = hashlib.md5(raw.encode("utf-8", "replace")).hexdigest()
now = time.time()

state_path = os.path.join(root, ".claude", "state", "band-o-state-%s.json" % sid8) if sid8 else ""
marker_path = os.path.join(root, ".claude", "state", "post-compact-pending-%s" % sid) if sid else ""

def load_state():
    # None on absent / unparseable / foreign-session / torn — every one of which decides FULL.
    if not state_path:
        return None
    try:
        with open(state_path, encoding="utf-8") as f:
            s = json.load(f)
        if not isinstance(s, dict) or s.get("sid8") != sid8:
            return None
        if not isinstance(s.get("since_full"), int) or s["since_full"] < 0:
            return None
        return s
    except Exception:
        return None

DIGEST_BUDGET = {"v": None}   # rung selected by the ladder in build_digest(); logged


def build_digest():
    # Single-chunk digest: every TRIGGER cell verbatim + bounded action HEADS + L# cites,
    # READ-on-match header, [BAND-O-FULL <h8>] anchor, VOID footer. Returns None on ANY parse
    # doubt => the caller emits FULL (visible as fallback_full_digest in the log; a persistent
    # parser break shows up as the pre-registered digest_rate<50% alarm, never as silence).
    # Cells split on " | " (space-padded delimiters): verified 27/27 rows at ship time,
    # including the two rows carrying unescaped `|` inside code spans, which a bare
    # (?<!\\)\| split mis-parses into 4 cells. A future row that breaks this splitter
    # degrades its sessions to full-every-turn — the designed fail direction.
    lines = text.split("\n")
    def cells(ln):
        body = ln[1:] if ln.startswith("|") else ln
        if body.endswith("|"):
            body = body[:-1]
        return [c.strip() for c in body.split(" | ")]
    items = []
    data = 0
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            items.append(("h", ln))
        elif ln.startswith("|---"):
            continue
        elif ln.startswith("|"):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            cs = cells(ln)
            if nxt.startswith("|---"):
                if len(cs) != 3:
                    return None
                items.append(("th", cs))
                continue
            # Sanity per row: 3 cells, non-empty trigger, short evidence (a long "evidence"
            # cell means the splitter mis-joined — refuse rather than ship a garbled digest).
            if len(cs) != 3 or not cs[0] or len(cs[2]) > 120:
                return None
            items.append(("r", cs))
            data += 1
    # Independent structural cross-check (panel spec): every |-line must be accounted for as
    # data row, table header, or separator. A dropped/mangled row breaks the identity.
    th = sum(1 for t, _ in items if t == "th")
    pipe_lines = sum(1 for ln in lines if ln.startswith("|"))
    if data < 10 or pipe_lines != data + 2 * th:
        return None
    # ⛔ THE IDENTITY ABOVE IS BLIND TO A WRAPPED ROW: it counts only
    # `|`-prefixed lines, so a row continued onto a non-`|` line — a wrap, a bullet, a prose
    # note — is dropped from the digest while the identity still balances and nothing refuses.
    # Guard the table REGION instead: between the first and last table line, the only things
    # allowed are table lines, blanks, headings and HTML comments. Anything else means the file
    # gained a shape this generator cannot faithfully render => refuse => FULL.
    tbl = [i for i, ln in enumerate(lines) if ln.startswith("|")]
    for ln in lines[tbl[0]:tbl[-1] + 1]:
        if ln.startswith("|") or not ln.strip() or ln.startswith("#") or ln.startswith("<!--"):
            continue
        return None
    # ⛔ NOTHING IN THIS DIGEST MAY RENDER THE FULL-COPY MARKER LITERAL. The first version
    # printed it three times — once inside the sentence telling the reader to search for it — so
    # a search could not return zero on a digest turn and the VOID CHECK was structurally
    # self-satisfying. It voided the first reading taken of it. The digest therefore
    # identifies ITSELF with a different token and DESCRIBES the full-copy marker in words.
    # ⛔ BOTH NOTICES LEAD, NOTHING TRAILS — the prepended-anchor lesson applied to the digest's OWN guidance.
    # emit() clamps to a PREFIX, so anything at the END is what a clamp eats; a VOID CHECK in a
    # footer is the first thing lost exactly when the digest is over budget. One leading block.
    HDR = ("# Active Recall — Orchestrator Band (Band-O) — DIGEST [BAND-O-DIGEST %s]\n"
           "<!-- DIGEST of band %s. TRIGGER cells are VERBATIM and CURRENT; ACTION cells are\n"
           "     TRUNCATED HEADS. ⛔ ON ANY TRIGGER MATCH: do NOT act from a head — read the FULL\n"
           "     row first (the full copy upthread, or .claude/orchestrator/active-recall-\n"
           "     orchestrator.md). Scan triggers BEFORE any non-trivial output, as with the band.\n"
           "     VOID CHECK: valid ONLY while a FULL copy of this band is upthread. Every full\n"
           "     copy OPENS with an HTML comment whose marker is the words BAND, O, FULL, COPY\n"
           "     hyphen-joined, then that hash. That joined literal is ABSENT from this digest by\n"
           "     design, so a search returning ZERO is a TRUE zero: no full copy upthread, this\n"
           "     digest is VOID, Read .claude/orchestrator/active-recall-orchestrator.md NOW. -->") % (h8, h8)
    TR = "…⟶READ-FULL-ROW"

    def is_exempt(trig):
        return any(trig.startswith(p) for p in EXEMPT_TRIGGER_PREFIXES)

    # ⛔ EXEMPTION LIVENESS, CHECKED BEFORE ANYTHING RENDERS. Each prefix must match exactly one
    # row. A key that stops matching (row reworded, row removed, a second row gaining the same
    # prefix) would silently drop or double an exemption, which is the wired-but-inert shape:
    # the digest keeps shipping and the protection is gone with no signal. Refuse instead.
    for _p in EXEMPT_TRIGGER_PREFIXES:
        if sum(1 for t, v in items if t == "r" and v[0].startswith(_p)) != 1:
            return None

    def build_lines(budget, apply_exempt):
        """Digest lines paired with the table header in effect at each line, so a split can
        re-emit the right header for part 2."""
        out, cur = [(HDR, [])], []
        for t, v in items:
            if t == "h":
                for x in ("", v, ""):
                    out.append((x, cur))
            elif t == "th":
                cur = ["| %s | %s (HEAD — read full row before acting) | %s |" % (v[0], v[1], v[2]),
                       "|---|---|---|"]
                for x in cur:
                    out.append((x, cur))
            else:
                trig, act, ev = v
                if apply_exempt and is_exempt(trig):
                    head = act
                else:
                    head = act if len(act) <= budget else act[:budget].rstrip() + TR
                out.append(("| %s | %s | %s |" % (trig, head, ev), cur))
        return out

    def pack(lines):
        """Pack into AT MOST 2 parts, each within DIGEST_CAP, splitting only at a line boundary
        so no table row is ever cut in half. Returns None when it cannot — the caller then emits
        FULL, which is the fail-toward-more direction this hook takes everywhere."""
        one = "\n".join(l for l, _ in lines)
        if len(one) <= DIGEST_CAP:
            return [one]
        # Reserve room for the split notice UP FRONT, so it is never the thing that pushes
        # part 1 over the cap (and so it can sit in the LEADING block rather than the tail).
        cap1 = DIGEST_CAP - len(DIGEST_SPLIT) - 1
        p1, i = [], 0
        while i < len(lines):
            if len("\n".join(p1 + [lines[i][0]])) > cap1:
                break
            p1.append(lines[i][0])
            i += 1
        if i <= 1 or i >= len(lines):
            return None
        p1.insert(1, DIGEST_SPLIT)   # directly after HDR — clamp-safe
        thdr = lines[i][1]
        p2 = DIGEST_CONT + (("\n" + "\n".join(thdr)) if thdr else "") + "\n" + \
             "\n".join(l for l, _ in lines[i:])
        if len(p2) > DIGEST_CAP:
            return None
        return ["\n".join(p1), p2]
    # The ladder descends until the digest fits one chunk. Which rung is SELECTED decides how
    # much action text actually ships, so it is LOGGED: without it, a
    # digest-vs-holdout compliance contrast is uninterpretable across band edits, because the
    # same "digest" label can mean 240 chars of action head or 60. Measured at ship: the ladder
    # lands on the FLOOR rung (60): 27 data rows, 27/27 truncated, median action cell 305
    # chars, 1,620 of 11,823 action chars shipped = 13.7% pooled (19.7% median per-row; an
    # earlier comment said "27 of 29 … ~20%", which counted the table header+separator as
    # rows and quoted the per-row median as if it were the pooled share). RE-DERIVE these,
    # never restate them — `scripts/band-o-digest-metrics.py` prints them from this code.
    # ⚠️ THE LADDER IS RUN AGAINST THE **UN-EXEMPTED** RENDER ON PURPOSE, and that is the whole
    # dose guarantee. A specific configuration was approved: today's rung for
    # every ordinary row, three rows shipped whole, ~44% saving. If the ladder were run against
    # the two-chunk budget instead it would climb to rung 240 and ship a ~29% saving — a dose
    # nobody approved, arrived at silently because the extra room existed. So rung selection is
    # byte-for-byte what it was before this change, and the second chunk buys the exemptions and
    # nothing else.
    LADDER = (240, 200, 170, 140, 120, 100, 80, 60)
    for budget in LADDER:
        if len("\n".join(l for l, _ in build_lines(budget, False))) <= DIGEST_CAP:
            DIGEST_BUDGET["v"] = budget
            return pack(build_lines(budget, True))
    # ⛔ LADDER EXHAUSTED — and until 2026-09-01 this returned None, which killed the digest
    # FLEET-WIDE the moment the band outgrew the FLOOR rung in ONE chunk. Measured at the
    # repair: floor rung 60 rendered 10,087 against DIGEST_CAP 9,800 — over by 287 chars — so
    # every seat fell back to FULL on every turn and the whole saving was gone. Fail-safe, and
    # therefore SILENT. `band-o-digest-metrics.py` printed "DIGEST IS DEAD" the whole time;
    # nobody was running it.
    # ⛔ THE OUTAGE WAS ~35.6 HOURS, NOT "days" AND NOT "standing since 08-18" — measured
    # from this hook's own log, and the step function is the proof the diagnosis is complete:
    #     08-28 digest 158 / fallback   0     08-31 digest  2 / fallback 321   (0.6%)
    #     08-30 digest 333 / fallback   0     09-01 digest 12 / fallback 136   (8.1%)
    # 457 degraded turns, zero fallbacks on every prior day, one killing commit:
    # a ONE-LINE band edit of +700 chars against 413 chars of remaining headroom.
    #
    # ⛔ THE FIX PINS THE FLOOR AND DOES NOT CLIMB, which is the entire safety property. The
    # comment above explains the ladder is measured against the UN-EXEMPTED ONE-CHUNK render
    # ON PURPOSE, because measuring against the two-chunk budget would let it climb to rung 240
    # and ship a dose nobody approved. That hazard is CLIMBING. This is its opposite: the ladder
    # is already exhausted, so the rung is the FLOOR — the dose can only be what was approved,
    # never more. Derived from LADDER[-1] rather than retyped, per this file's own rule.
    #
    # And the SECOND SLOT is this file's own design, not an invention to get green: two slots, with
    # those three rows kept whole, reversing the earlier
    # single-chunk decision. Refusing to use the approved slot — while sitting 287 chars over
    # a one-chunk budget — is what turned an approved two-slot design into no digest at all.
    #
    # pack() still returns None when even two parts cannot hold it, so the fail-toward-FULL
    # direction this hook takes everywhere is unchanged. Measured after the fix: parts of 9,200
    # and 2,814, both inside the 9,800 cap. Verified against the approval-time state: same
    # rung, same two slots, same three exempted rows, zero stranded rows, and 42.0% saved
    # against 40.6% at approval time — LESS dose than approved, not more.
    #
    # ⛔ THE BINDING CONSTRAINT MOVED, AND THE TRIMMING ADVICE MUST MOVE WITH IT.
    # While the LADDER binds, trimming action prose is worthless — halving EVERY non-exempt
    # action cell removes 28.7% of the band and moves the binding number by 30 chars. But since
    # this fix the ladder is at its floor and PART 2 binds, and there the lever is the opposite:
    # the three EXEMPT rows ship their action WHOLE into part 2, so halving those three drops
    # part 2 by 1,272 chars (18% of headroom) while leaving the ladder untouched. Read WHICH
    # part binds before trimming anything; the two failures have opposite remedies.
    #
    # ⭐ AND THE ARCHITECTURAL POSITION, written down now while the reasoning is fresh rather
    # than rediscovered at the next cliff:
    #     the ladder's ENTIRE remaining range   1,493 chars (rung 60 -> budget 0)
    #     part-2 headroom                       6,986 chars
    # The second slot absorbs 4.7x more growth than every remaining rung combined, and a ladder
    # at its floor cannot respond to band growth AT ALL — every future character lands on part 2.
    # So this recurs by construction. Irreducible content renders at 9,879 against ~18,958 usable:
    # we are at ~52% of the architectural ceiling WITH THE DOSE LEVER SPENT. Survival margin
    # measured at +17 rows / +11,448 chars (~55% band growth, ~46 more band commits) before
    # pack() fails. The next lever is a THIRD slot — chunk 3 is already wired, but pack() is
    # hardcoded to two parts and the dispatch guards `if _i == 2`, so both must change together
    # — or fewer rows, or shorter triggers.
    DIGEST_BUDGET["v"] = LADDER[-1]
    return pack(build_lines(LADDER[-1], True))

def decide(state):
    # Deterministic in (payload bytes, state-as-read, band bytes). That determinism is
    # load-bearing: chunk 2 re-derives the SAME decision when the chunks run in parallel and
    # chunk 1's state write has not landed yet (both read the same pre-turn state + identical
    # stdin). The holdout draw therefore hashes payload_md5 — shared byte-identically by both
    # chunks — never a clock or RNG. It deliberately EXCLUDES band_md5 so a routine band edit
    # cannot flip the pinned smoke fixtures.
    # ⛔ THE CLOSING BRACKET IS LOAD-BEARING. Without it this
    # prefix also matched an owner who PASTES a notification, a prefix-collision tag, and
    # any longer `<task-notification…` spelling — all of which then read as NOT-typed and
    # got a digest, against this header's promise that owner turns always get the full band.
    # Measured in a live transcript: 852 real notifications, every one `<task-notification>`
    # with the bracket immediately, so requiring it loses nothing and closes the collision.
    typed = not (isinstance(prompt, str) and prompt.lstrip().startswith("<task-notification>"))
    if typed:
        return ("full_typed", "", None)
    if state is None:
        return ("full_state", "", None)
    if state.get("band_md5") != h8:
        return ("full_band_changed", "", None)
    try:
        last_full = float(state.get("last_full_at") or 0)
    except Exception:
        return ("full_state", "", None)
    try:
        if marker_path and os.path.exists(marker_path):
            # ⛔ READ THE EVENT TIME FROM THE CONTENT — mtime on this marker is LIVENESS, NOT the
            # compaction time. post-compact-pending-check.sh:51
            # `touch`es this marker on EVERY UserPromptSubmit so a peer's GC cannot reap a live
            # session's marker, and its own comment states the contract: "The compaction TIME
            # stays in the marker CONTENT (compacted=<ts>) — mtime is liveness." Reading mtime
            # here made `mtime > last_full` true on every single turn, so the digest path was
            # 100% DEAD for any session carrying an uncleared marker — measured 0/8 digests with
            # the touch against 6/8 without it. Fail-safe (always FULL), so nothing broke; the
            # feature simply did nothing for a whole class of sessions, silently, and polluted
            # the digest_rate denominator being watched.
            with open(marker_path, encoding="utf-8", errors="replace") as _mf:
                _head = _mf.read(200)
            _m = re.search(r"compacted=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*UTC", _head)
            if not _m:
                return ("full_post_compact", "", None)  # unparseable marker => more, never less
            _ct = datetime.datetime.strptime(_m.group(1), "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=datetime.timezone.utc).timestamp()
            if _ct > last_full:
                return ("full_post_compact", "", None)
    except Exception:
        return ("full_post_compact", "", None)  # doubt about the epoch => more, never less
    since = state["since_full"]
    if since >= 10:
        return ("full_heartbeat", "", None)
    if int(hashlib.md5(("%s:%d:%s" % (sid8, since, payload_md5)).encode()).hexdigest(), 16) % 10 == 0:
        return ("full_holdout", "holdout", None)
    # ⛔ ZERO-INJECTION ARM (an approved experiment arm). The holdout arm above varies the
    # payload SIZE; nothing varied its FREQUENCY, so per-epoch delivery sat outside the tested
    # range. Measured at matched depth, FULL and DIGEST are indistinguishable (ratios
    # 0.83/1.02/1.03/0.88 on O1, 1.19/0.73 on O2) AND the FULL arm's own miss rate climbs with
    # depth exactly like the digest's (62.0 -> 80.8) — re-sending does not arrest the decay. This
    # arm tests the only remaining dose: NOTHING on this turn. It is a SECOND independent draw,
    # salted differently so it cannot correlate with the holdout arm.
    # ⛔ ITS POPULATION RATE IS 8.9%, NOT 10% — WRITE THAT NUMBER IN ANY PRE-REGISTRATION.
    # The draw itself is a clean 1-in-10, but the HOLDOUT draw above RETURNS first, so this one
    # only ever sees the 90% the holdout did not take: P(zero) = 9/10 x 1/10 = 9/100. Independent
    # salting makes the two uncorrelated; it does not make them non-competing when one returns.
    # Measured over 100,000 simulated draws: holdout 10.03%, zero 8.92%, and zero is 9.92% of the
    # non-holdout population — i.e. the draw is right and the denominator is the thing to state.
    # Found from control flow alone; simulated here before folding.
    # ⚠️ IT DELIBERATELY BREAKS THIS FILE'S "fail toward MORE" default, IN TWO DIRECTIONS.
    # UPWARD, the ladder bounds it: a zero turn is unreachable for a typed/owner prompt, for
    # absent/foreign state, for a band change, for the first turn after a compaction, and for
    # since_full >= 10.
    # ⛔ DOWNWARD — AND THIS IS THE ONE THE LIST ABOVE CANNOT EXPRESS — THE ARM PRE-EMPTS
    # `fallback_full_digest`. That fallback sits BELOW this return, so on a turn where
    # build_digest() WOULD have failed, the arm wins and the fail-toward-full path never runs:
    # the band is silently absent on precisely the turns where the digest was already broken.
    # MEASURED in a rig with an exempt prefix mangled so build_digest() returns None — digest
    # fixture: mode=fallback_full_digest, 6,917 B emitted; zero fixture: mode=none_zeroarm,
    # 0 B emitted; positive control (band restored) back to 10,034 B. Sized against the only
    # real outage: ~41 of the 458 fallbacks on 2026-08-31/09-01 would have emitted nothing.
    # NOT FIXED BY REORDERING — drawing after the digest attempt would make the arm fire only
    # when the digest SUCCEEDS, which biases the arm it exists to run. Named instead, so the
    # next reader knows the exemption list answers "what stops a zero turn?" and not "what does
    # a zero turn stop?" (Reproduced here before folding.)
    # ⛔ AND THE HEARTBEAT IS NOT THE PRACTICAL BOUND — THE RATE IS. At 8.92%, per 3,842 turns:
    # a run of 2 is expected ~31 times, a run of 3 about 2.7 times, and a run of 10 essentially
    # never — 3.2e-11 per turn, an expected 1.2e-07 occurrences across those same 3,842 turns.
    # So `since_full >= 10` will never fire as a zero-run cap, by eleven orders of magnitude.
    # ⚠️ EVERY FIGURE ABOVE IS PER 3,842 TURNS **EXCEPT THE ONE LABELLED "per turn"** (3.2e-11),
    # which is per turn exactly as it says — and that exception is the whole point, because the
    # blanket form of this sentence was FALSE about the one figure this comment exists to protect
    # (I fixed a silently-changing unit by ADDING an explicitly
    # per-turn rate, then wrote a summary that erased the distinction I had just drawn).
    # Stated at all because the earlier wording read
    # "a run of 10 once in ~10^7" and the parallel structure carried "in 3,842 turns" forward,
    # so the natural parse was once per 10^7 TURNS. That is wrong by ~3,100x (the true figure is
    # ~3e10 turns); the number was right and the UNIT changed silently mid-sentence, in the one
    # clause where it changed — and it slipped into the comment written to stop exactly
    # this kind of misreading. KEEP IT, but as a backstop against a future RATE CHANGE, not against a run at
    # this rate; a prior comment here called it the cap and that would mislead an editor in
    # either direction. DO NOT REMOVE IT while this arm is live (a 2026-09-04 draft proposed
    # exactly that, before this arm existed).
    # ⚠️ PRE-REGISTRATION SCOPE, forced by the same arithmetic: this rate yields ~343 zero turns
    # of which ~31 are adjacent pairs, so the arm is well-powered for "does ONE missing
    # injection hurt?" and has essentially no samples for "does SUSTAINED absence degrade
    # compliance?". The second question needs a per-SESSION sticky arm, not a per-turn draw.
    if int(hashlib.md5(("zero:%s:%d:%s" % (sid8, since, payload_md5)).encode()).hexdigest(), 16) % 10 == 0:
        return ("none_zeroarm", "zero", None)
    dg = build_digest()
    if dg is None:
        return ("fallback_full_digest", "", None)
    return ("digest", "", dg)

state = load_state()
since_before = state["since_full"] if state else 0
try:
    mode, arm, dg = decide(state)
except Exception:
    mode, arm, dg = "fallback_full_error", "", None

if chunk == "1":
    if mode == "none_zeroarm":
        pass          # zero-injection arm: emit nothing, but still log and write state below
    elif mode == "digest" and dg:
        emit(dg[0])
    else:
        p = full_part("1").strip("\n")
        # FULL_SPLIT rides ONLY when a part 2 actually exists. Announcing a part 2 that never
        # comes is a different lie, and a band file whose CHUNK-BOUNDARY marker is missing or
        # renamed yields len(parts)==1 — chunk 1 is then the whole band and nothing follows.
        _hdr = FULL_TAG + ("\n" + FULL_SPLIT if len(parts) > 1 else "")
        emit(_hdr + "\n" + p if p.strip() else p)
    # ---- state (atomic write; a failure here never affects the emit above) ----
    if state_path:
        try:
            ns = {
                "sid8": sid8,
                "band_md5": h8,
                # ⛔ `none_zeroarm` COUNTS AS A NON-FULL TURN ON BOTH LINES. It delivered no
                # band, so it must neither refresh last_full_at nor reset since_full — otherwise
                # the heartbeat that bounds this arm could never fire and the depth axis the
                # holdout analysis reads would be silently wrong.
                "last_full_at": ((state or {}).get("last_full_at", 0)
                                 if mode in ("digest", "none_zeroarm") else now),
                "since_full": (since_before + 1 if mode in ("digest", "none_zeroarm") else 0),
                "turn": {"decision": ("digest" if mode == "digest"
                                      else "none" if mode == "none_zeroarm" else "full"),
                         "ts": now, "payload_md5": payload_md5, "mode": mode,
                         "prompt_id": prompt_id},
            }
            os.makedirs(os.path.dirname(state_path), exist_ok=True)
            tmp = state_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(ns, f)
            os.replace(tmp, state_path)
        except Exception:
            pass
    # ---- instrumentation (chunk 1 only; log-only, never blocks) ----
    # ⛔ THESE CAPS ARE WHAT MAKES THE APPEND ATOMIC — they are not cosmetic. O_APPEND makes
    # the offset update atomic PER write() call, so a record that
    # fits in one syscall cannot interleave with a concurrent seat's. Every field is bounded
    # (mode/arm from fixed vocabularies, since_full <= 10, prompt_head 60, keys 12x32).
    # Keep it that way, or re-earn the guarantee.
    # Field vocabulary (the panel's instruments read these): mode ∈ digest | full_typed |
    # full_state | full_band_changed | full_post_compact | full_heartbeat | full_holdout |
    # fallback_full_digest | fallback_full_error | none_zeroarm; arm ∈ "" | holdout | zero;
    # a `none_zeroarm` record means NOTHING was injected that turn — it is the only mode that
    # emits no payload, and it is the arm the per-epoch-delivery question is measured on.
    # since_full = consecutive
    # digests BEFORE this turn (so a holdout turn pairs with digest turns at the same depth).
    # ⛔ EXERCISING THIS HOOK BY HAND WRITES A TELEMETRY RECORD, AND THAT RECORD CAN MOVE A
    # PUSH-GATING NUMBER. Set `BAND_O_NO_LOG=1` when you pipe a payload through by hand.
    # THE MECHANISM, stated correctly on the second attempt — the first version of this comment
    # gave a reason that CANNOT HAPPEN, and the true reason is stronger:
    #   · WHAT GATES: `scripts/smoke-test-hooks.sh:6048` runs `band-o-digest-metrics.py --log`
    #     against this LIVE corpus, and `.githooks/pre-push:371-373` runs that suite whenever a
    #     band, hook or script changes. `DIGEST_RATE_FLOOR = 50.0` (metrics :133). So this log
    #     is not a passive record — it can REFUSE a push.
    #   · WHICH RECORDS MOVE IT: a probe carrying a task-notification-shaped payload yields
    #     `mode=digest`, which IS in `DIGEST_ATTEMPTED` and DOES move `digest_rate`. The smoke
    #     fixtures do exactly that at :5503. THAT is the record to keep out.
    #   · WHICH DO NOT, and this is what the first version got wrong: a TYPED-prompt probe is
    #     `mode=full_typed`, which sits in `FORCED_FULL` (metrics :117-120) and in NONE of
    #     `attempted` / `holdouts` / `zeros` / `draw_reaching` / `eligible` (:238-247). It moves
    #     `era_records` and nothing a verdict branch reads. The consumer had already immunised
    #     itself — its own :29-32 exclusion comment records that fix.
    # ⛔ AND THE 8.92% IS NOT DERIVED FROM THIS LOG AT ALL. The first version of this comment
    # called this "the corpus the 8.92% zero-injection rate is derived from"; it is a
    # 100,000-draw Monte Carlo of the md5 draw at :739, and the log is not an input.
    # The log's OWN zero rate is 1.154% — a different object, which is itself the confirmation.
    # A maintainer who believed the false provenance would sit directly above a comment that is
    # load-bearing on 8.92% and either distrust a sound constant or "correct" it against a
    # number measuring something else.
    # ⚠️ NO READ-TIME FILTER CAN REMOVE A SYNTHETIC RECORD: the newest carries a REAL session id,
    # so nothing distinguishes it from a live turn after the fact. It has to not be
    # written. `BAND_O_NO_LOG=1` is the same escape `bash-safety-warn.sh` ships for the identical
    # reason. ⛔ THE ESCAPE IS DECLARED AND UNWIRED, WHICH IS WHERE THE PRECEDENT'S VALUE WAS:
    # `BASH_SAFETY_NO_LOG` appears 41 times in the smoke suite; `BAND_O_NO_LOG` appears 3 times
    # and all 3 are in this file. The header now names it at the top, which is the cheap half;
    # isolating the suite's own invocations is not done.
    # ⚠️ AND THE HEADLINE COUNT WAS UNDERSTATED IN THE FLATTERING DIRECTION, inside the comment
    # written to surface flattering-direction errors. It read "4 synthetic records in 9,532
    # (0.04%)"; the predicate was `prompt_head == "probe"` and it missed six `<session-id>` records
    # whose heads are 'hello typed prompt', 'hi' x5 and 'p'. Re-derived 2026-09-05 over the WHOLE
    # log: 11 of 29,819. A second count read 12 of 9,534 scoping to one era; the two disagree by one
    # and neither has been reconciled — cite the population with the number. That `<session-id>` is
    # synthetic by burst shape, not by proof: five of its records share one second and a
    # UserPromptSubmit hook fires once per prompt. Found by asking whether
    # exercising the hook mutates state BEFORE exercising it — one command from making another
    # record while reporting the count.
    # ⛔ GUARD SHAPE IS A CONDITIONAL, NOT AN EARLY RETURN — this block is MODULE-LEVEL (it sits
    # in the top-level `if chunk == "1": … elif chunk.isdigit()` chain, not inside `decide()`),
    # so `return` here is `SyntaxError: 'return' outside function` and kills a WIRED hook outright.
    # I wrote exactly that and caught it by EXERCISING the hook rather than by reading the edit.
    # The escape rides the EXISTING `except Exception: pass` rather than re-indenting the record
    # block — a deliberate minimal edit in a wired hook. Raising a REAL, defined exception type:
    # a bare `raise _SkipLog` would ALSO have "worked", by NameError being swallowed by the same
    # handler, which is a thing that works by accident and reads as intent.
    try:
        if os.environ.get("BAND_O_NO_LOG") == "1":
            raise RuntimeError("BAND_O_NO_LOG set — hand-exercise, not a live turn")
        log = os.path.join(root, ".claude", "logs", "band-o-inject.jsonl")
        os.makedirs(os.path.dirname(log), exist_ok=True)
        rec = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "session": sid8,
            "has_prompt": prompt is not None,
            "prompt_len": len(prompt) if isinstance(prompt, str) else 0,
            "prompt_head": (prompt[:60] if isinstance(prompt, str) else ""),
            "keys": [str(k)[:32] for k in sorted(d.keys())[:12]],
            "mode": mode[:24],
            "arm": arm[:12],
            # WIRING EVIDENCE (2026-08-18). `chunk`+`nparts`+`prompt_id` make "did every chunk the
            # band defines actually get REQUESTED this turn?" answerable from the log. Before this,
            # only chunk 1 logged, so N invocations were indistinguishable from one — and the
            # settings.json parity arm can only check the STATIC wiring, never that the harness
            # dispatched it. See the tail-chunk record below; both are needed to pair them up.
            "chunk": 1,
            "nparts": NPARTS,
            "prompt_id": (str(prompt_id)[:64] if prompt_id else None),
            "since_full": since_before,
            # Bounded (one of 8 fixed rungs, or null) — the atomic-append guarantee above holds.
            "budget": (DIGEST_BUDGET["v"] if mode == "digest" else None),
        }
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    # ⛔ THE `BAND_O_NO_LOG` GUARD ABOVE DEPENDS ON THIS HANDLER STAYING BROAD. It works by
    # RAISING RuntimeError and letting this bare `except Exception` swallow it, so narrowing
    # this to what the block can genuinely raise (OSError, TypeError, ValueError are all
    # plausible here) lets the guard escape and costs a stderr traceback plus a lost record —
    # NOT a dead hook: emit() already ran at :754-763, the state write at :777-791 is its own
    # try, the heredoc opener at :172 carries a trailing `|| true`, and the script exits 0.
    # ⛔ THAT OPENER IS SPELLED OUT HERE ON PURPOSE AND MUST NOT BE QUOTED LITERALLY: writing it
    # verbatim in a comment makes `band-o-digest-metrics.py:85` count TWO heredocs and abort
    # `--log` with rc=2 — which is a smoke-suite FAIL and therefore a blocked push, fleet-wide.
    # I did exactly that folding this commit and caught it by running the suite. Naming a type
    # fixed the undefined-name half of the original `raise _SkipLog` and left this coupling;
    # the coupling is the part to remember. (A residual nobody
    # named at review time.)
    except Exception:
        pass
elif chunk.isdigit() and int(chunk) >= 2:
    # ⛔ ONE BRANCH FOR EVERY TAIL CHUNK, DELIBERATELY (2026-08-18). The
    # obvious wiring for a third chunk is a second `elif chunk == "3":` that repeats the follow
    # computation below. That duplicate is exactly how the 2026-08-17 stale-follow defect gets
    # re-introduced on the new chunk while chunk 2 stays fixed: the binding is subtle
    # (prompt_id on BOTH sides, payload_md5, 120s), and a copy drifts the moment either is
    # touched. Generalising the branch means chunk 3+ inherits the fix by construction rather
    # than by a maintainer remembering to mirror it.
    _i = int(chunk)
    # Chunk 2 follows chunk 1's recorded same-turn decision (matched by payload_md5 so a rapid
    # successive wake cannot inherit the PREVIOUS turn's decision), and re-derives it when no
    # fresh record exists (parallel execution). Any doubt => full chunk 2 (fail toward more).
    # Worst case under a mid-flight state race is a single turn carrying digest + full-chunk-2,
    # or a single turn missing chunk 2 — transient, self-healing on the next turn, and strictly
    # narrower than the pre-existing failure mode (a hook crash dropping the chunk entirely).
    #
    # ⛔ SINCE 2026-08-15 A DIGEST TURN MAY EMIT A PART 2. It used to emit nothing here, because
    # the digest was single-chunk by design; three rows now ship their ACTION cell in full and
    # that overflows one chunk. Part 2 is REBUILT here rather than read off this chunk's own
    # decide() result: build_digest() is deterministic in the band bytes, so a rebuild agrees
    # with chunk 1 by construction, whereas trusting `dg` would drop part 2 whenever chunk 2's
    # decide() took a different branch under a state race — and a reader holding part 1 alone
    # loses precisely the exempted exceptions this change exists to deliver.
    follow = None
    if state:
        t = state.get("turn") or {}
        try:
            # ⛔ PAYLOAD IDENTITY ALONE DOES NOT BIND A RECORD TO **THIS** TURN.
            # The comment above claims payload_md5 stops a rapid successive wake
            # inheriting the previous decision. It only held because the live harness payload
            # happens to carry a per-prompt field — which this hook never required and never
            # checked, so the guarantee rested on the harness, not on the code. Reproduced at
            # HEAD: chunk 1 decides full, chunk 2 follows a stale digest record, 29 band rows
            # in and 21 delivered — the 8 lost are the whole cross-session cluster, and NEITHER
            # completeness header can see it (part 1 promised a part 2 and one arrived; part 2
            # checked for part 1 and it was there). Both self-checks pass, the rules are gone.
            # Require the per-prompt id on BOTH sides; absent on either => fall through to
            # re-derivation, which build_digest() makes agree with chunk 1 by construction.
            _rec_pid = t.get("prompt_id")
            if (_rec_pid and prompt_id and _rec_pid == prompt_id
                    and t.get("payload_md5") == payload_md5
                    and (now - float(t.get("ts") or 0)) < 120):
                follow = t.get("decision")
        except Exception:
            follow = None
    if follow is None:
        follow = ("digest" if mode == "digest"
                  else "none" if mode == "none_zeroarm" else "full")
    if follow == "none":
        pass          # zero-injection arm: every chunk stays silent this turn
    elif follow != "digest":
        # Same empty-guard shape as chunk 1: an absent part 2 must stay SILENT, never emit a bare
        # continuation header on its own (the "DARK notice is chunk-1 only" arm pins that).
        _p2 = full_part(chunk).strip("\n")
        emit(full_cont(_i) + "\n" + _p2 if _p2.strip() else _p2)
    else:
        # ⛔ THE DIGEST PACKS TO **AT MOST 2** PARTS (see pack()'s docstring and its `return None`
        # when part 2 overflows), so index 3+ can never carry digest content. Guarding on `_i == 2`
        # rather than letting `_parts[_i - 1]` IndexError is the difference between a silent no-op
        # and a hook crash — and a crash here drops the chunk entirely, which is the failure mode
        # this whole file is arranged to avoid. If pack() ever grows a third part, this guard is
        # the line that must change with it.
        if _i == 2:
            try:
                _parts = build_digest()
            except Exception:
                _parts = None
            if _parts and len(_parts) > 1:
                emit(_parts[1])
    # ⛔ TAIL-CHUNK WIRING RECORD — DELIBERATELY MODE-LESS (2026-08-18). Every existing consumer
    # of this log filters on a `mode` VALUE (band-o-digest-metrics.py: `r.get("mode") in
    # DIGEST_ATTEMPTED`, `== "digest"`, `== "full_holdout"`), so a record with no `mode` key is
    # invisible to all of them and the digest arithmetic is untouched. That is the whole reason
    # this is a separate minimal record rather than a field on the existing one.
    # WHY IT EXISTS: a session that changes the settings.json wiring cannot self-certify it —
    # its own turn's injection was built from the PRE-change settings, and reading the emitted
    # chunks by hand proves the HOOK, never the WIRING. Pairing chunk 1's record with these by
    # prompt_id turns "all N chunks were requested" into something any later turn can just read.
    # ⛔ THE SAME `BAND_O_NO_LOG` GUARD, AND ITS ABSENCE HERE WAS A REAL HOLE — the first version
    # shipped the escape on the chunk-1 write ONLY, so a hand-exercise of chunks 2..N still wrote. There
    # are TWO write sites in this file (:865 and here) and the commit guarded one. MEASURED
    # 2026-09-05 by exercising all three chunks with BAND_O_NO_LOG=1: the log grew by exactly 2,
    # and the two new records were `chunk:2` and `chunk:3` with `prompt_id: null` — a live turn
    # always carries a prompt_id, so the attribution is not a guess. Neither the author's own
    # review nor a dedicated review lens found it; EXERCISING the hook did, which is the
    # lesson the comment at :812 already records and the author had not applied to their own fix.
    try:
        if os.environ.get("BAND_O_NO_LOG") == "1":
            raise RuntimeError("BAND_O_NO_LOG set — hand-exercise, not a live turn")
        _wlog = os.path.join(root, ".claude", "logs", "band-o-inject.jsonl")
        os.makedirs(os.path.dirname(_wlog), exist_ok=True)
        with open(_wlog, "a", encoding="utf-8") as _wf:
            _wf.write(json.dumps({
                "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "session": sid8,
                "chunk": _i,
                "nparts": NPARTS,
                "prompt_id": (str(prompt_id)[:64] if prompt_id else None),
            }, ensure_ascii=False) + "\n")
    except Exception:
        pass
# a non-numeric chunk index: silent no-op (see the full_part() index lesson above)
PY
[ -n "$PF" ] && rm -f "$PF" 2>/dev/null || true
exit 0
