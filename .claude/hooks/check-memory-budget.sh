#!/usr/bin/env bash
# PreToolUse hook — guard the PROJECT auto-memory index byte/line budget.
# MEMORY.md budget fix — 4-external-expert panel 2026-06-01.
#
# Background:
#   `.claude/project-memory/MEMORY.md` is ALWAYS-LOADED by the harness and HARD-
#   capped: the HARNESS cliff is in CHARACTERS and is BOUNDED, not pinned (no banner
#   at 24,964 chars, banner at 25,300; 24,985 is 24.4 KiB off a ROUNDED display).
#   THIS gate counts BYTES at CAP_BYTES, which errs strict because bytes >= chars.
#   (The old '200 lines / 25 KB' reading was wrong on both the unit and the number.)
#   Past the cap the tail is truncated
#   — it was dropping the vendor-state reference_* pointers (email and billing vendor DNS)
#   every session. ⛔ NOT "silently", and this header said so for months while citing a BANNER as
#   its own evidence two blocks down: the harness ANNOUNCES the truncation. What is silent is
#   WHICH tail it dropped, which is the half that matters — nothing names the enforcement rules
#   you lost. The distinction is not pedantic: "N bytes from silent rule loss" is drop-everything,
#   "N bytes from a loud unescapable refusal" is a chore, and the wrong one was being repeated
#   into tracker rows downstream.
#   Binding constraint is BYTES, not lines (176 lines < 200 but
#   26040 > 25600 = breach). check-memory-size.sh is line-only → structurally
#   blind to this. This hook adds the byte gate at the write boundary.
#
# Scope — THREE arms, three thresholds, three rationales:
#   ARM 1 (2026-06-01) */project-memory/MEMORY.md (+ symlinked */memory/MEMORY.md)
#         — the ALWAYS-LOADED project index. Absolute cap: the harness truncates.
#   ARM 2 (2026-08-01) .claude/skills/*/MEMORY.md — the per-skill expert memories.
#         A no-growth RATCHET, not an absolute cap.
#   ARM 3 (2026-08-13) CLAUDE.md, AGENTS.md, .claude/rules/*.md — the ALWAYS-LOADED
#         band. A PER-FILE, GROW-ONLY, WARN-ONLY pin. Never denies.
#
#   ⛔ "Skill MEMORY.md is NOT gated here (yet)" — the claim this header carried
#   until 2026-08-01 — is now FALSE BY CONSTRUCTION (ARM 2 below). Left visible
#   rather than deleted because the *reason* it was true for so long is the
#   lesson: the sentence below it ("not byte-capped") was measured-false, and a
#   wrong premise in an always-read header is what stopped anyone building the
#   gate. Same class as the correction it introduces.
#
#   ⛔ CORRECTED 2026-07-31 — this comment previously read "NOT skill MEMORY.md
#   (those are NOT auto-loaded, not byte-capped)". The "not byte-capped" clause
#   is MEASURED-FALSE and was the reason no gate was ever built for the skill
#   tier. Skill MEMORY.md is not AUTO-loaded, but every expert agent is
#   instructed to Read it at consultation start, and the Read tool enforces its
#   own limits: ~262144 B unbounded, and a 25000-TOKEN cap per call that binds
#   ~4.3x lower (~61.5 KB). Measured: saas-architect 270285 B -> hard refusal;
#   frontend-developer 261840 B (UNDER the byte ceiling) -> returned lines
#   1-214 of 1069 as well-formed content, truncation disclosed only in a
#   trailing reminder. 23 of 56 skill MEMORY.md are past the token cap.
#   "Not auto-loaded" was true; "not byte-capped" never was.
#
# Predicate (PROSPECTIVE post-edit size — computed BEFORE the write lands):
#   Write     → bytes/lines of the new content.
#   Edit      → current ∓ old_string ± new_string.
#   MultiEdit → current + Σ(per-edit delta).
#
# Decision:
#   WARN  ≥18 KB *AND the edit GROWS the file* (exit 0 + stderr) — early warning;
#         move topical pointers to the cold MEMORY-INDEX.md or prune. The growth
#         clause is there because the band originally fired on
#         ABSOLUTE size, so once the index crossed 18 KB it warned on EVERY write —
#         including the prunes it was asking for — and was duly ignored across
#         4.75 KB of growth (18 → 22.75 KB), which is the empirical definition of a
#         dead guard. A budget warning is information only when the edit moves you
#         TOWARD the cap.
#   BLOCK >24985 bytes OR >200 lines (deny) — prevents the silent-truncation
#         breach. Compensating-prune invariant: you cannot grow past the cap
#         without first making room. ⛔ WAS 25600 until 2026-08-13, which is 615
#         ABOVE the cliff: the harness caps ~24.4 KiB of CHARACTERS (bounded 24,964-25,300),
#         not bytes, so this gate read GREEN on a file the harness was already
#         truncating. See the CAP_BYTES block below for the measurement.
#
# ARM 2 decision (skill MEMORY.md — a RATCHET, deliberately not a cap):
#   WARN  projected >=46,000 B *AND growing*.
#   BLOCK projected >57,500 B *AND projected > current*.
#   The growth clause is what makes this shippable day one: 24 of 56 skill
#   MEMORY.md files are ALREADY past 57,500 B, so an ABSOLUTE gate would deny
#   every write to 24 skills from the first minute, including the distillation
#   edits that fix them. Under the ratchet the baseline passes trivially and the
#   only forbidden move is making a too-big file bigger — you may always shrink,
#   even from far above the line.
#
#   Why 57,500 and not the harness's 262,144: the binding constraint on a skill
#   MEMORY is the 25,000-TOKEN per-Read cap, which at the measured 2.350-2.572
#   B/tok density lands at ~58,750-64,300 B — about 4.3x below the byte ceiling.
#   A gate placed at 262,144 would certify all 18 token-band files as healthy,
#   which is the single highest-probability test-theater outcome for this change.
#   The read-side twin (warn-large-tracker-read.sh ARM B) uses the same number.
#
#   The deny reason MUST carry a same-turn remedy (bytes to free + the split
#   command). Without it this guard does not prevent a truncation, it converts
#   one into a DROPPED LESSON — the agent's Memory-Update block has nowhere to go
#   and is discarded silently (the same failure, relocated one layer down).
#
#   Escape: SKIP_MEMORY_RATCHET=1. Fires logged to .claude/logs/memory-ratchet-block.log.
#
# ARM 3 decision (the ALWAYS-LOADED band — a PER-FILE PIN, WARN-ONLY, GROW-ONLY):
#   Scope: CLAUDE.md, AGENTS.md, .claude/rules/*.md — every byte of which is paid
#   TWICE: once in the orchestrator's context and again on EVERY sub-agent dispatch
#   (~54 agent types), so this band is the most expensive text in the repo per byte.
#   WARN  projected > that file's pin in .claude/band-pins.json *AND growing*.
#   BLOCK never. This arm CANNOT deny — there is no harness truncation to prevent
#         here (unlike ARM 1) and no read ceiling being breached (unlike ARM 2); the
#         harm is slow, cumulative and judgement-laden, which is exactly the shape
#         the warn-before-block discipline says ships warn-first. A denied rules edit would also block the
#         CORRECTION of a wrong always-loaded sentence, which is the worst artifact
#         in the corpus — a warn that is read beats a block that gets escaped.
#
#   Why a PER-FILE PIN and not one global threshold: the band spans 1.7 KB
#   (actions.md) to 133 KB (bash-environment.md), so any single number either
#   permanently warns on the big files (dead guard, the exact failure ARM 1's
#   growth clause was added to fix) or never fires on the small ones. The pin is
#   each file's own size at its last refresh, so the predicate is "this edit makes
#   an always-loaded file bigger than it has ever been since the last displacement"
#   — a question every band file can answer about itself.
#
#   THE PINS FILE RATCHETS DOWN ONLY, and the hook NEVER writes it. `--refresh-pins`
#   (below) recomputes min(existing_pin, current_size); raising a pin is a hand edit
#   of the tracked JSON, visible in a diff. A file that grew keeps its OLD smaller
#   pin, so the growth stays visible on every later write until it is displaced.
#
#   Consequence, stated rather than discovered: with the pins seeded at today's
#   sizes, EVERY growing band write warns from minute one. That is the intent, not
#   an oversight — this is a no-growth ratchet at warn level, and it still carries
#   information because a shrink and a same-size edit are SILENT. ARM 1's dead-guard
#   history is the opposite shape: it fired on every write INCLUDING the prunes it
#   was asking for, so the warn could not distinguish compliance from breach.
#
#   UNPINNED band file → the pin DEFAULTS to the file's current on-disk size, i.e.
#   identical semantics to a freshly-refreshed pin. Deliberate (no bare
#   suppressions): a new .claude/rules/*.md would otherwise be born invisible to the
#   guard and stay that way until somebody remembered to enroll it, and "somebody
#   remembers" is the failure mode this whole file exists to replace. It costs no
#   extra noise, because a pinned file behaves the same way. CREATION is exempt
#   (file not on disk → silent): making a new rules file is not growing the band's
#   existing text, and a warn on the create is aimed at the wrong act.
#
# ARM 3b decision (2026-08-24 — PER-EDIT size, WARN-ONLY, the band write-path bound):
#   WARN  (proj_bytes - cur_bytes) > 400 on a band file. Fires BEFORE the pin arm and exits, so
#         one write produces one warn.
#   BLOCK never, same reasoning as ARM 3.
#
#   WHAT IT MEASURES THAT NOTHING ELSE DOES: every other band governor is a LEVEL — the ceiling
#   (check-band-budget.mjs), the floor, the per-file pin above. A level tells you the corpus is too
#   big; it cannot tell the author of a single 3 KB entry that THEIR entry is the thing. The
#   2026-08-24 write-path review measured the gap: 92% of growth bytes arrived in
#   edits exceeding the corpus's own 400 B per-entry budget, with nothing measuring per-edit size at
#   all. For scale on the level tier: 280 pin-arm fires were recorded across 21
#   files between 2026-08-13 and 2026-08-23 and the growth trend did not bend. ⚠️ THAT SERIES HAS A
#   BREAK FROM 2026-08-24: 3b exits before the pin arm, so any band edit growing >400 B now logs to
#   band-entry-fires.jsonl with "over_pin":1 and writes NO growth-ledger line. Per the census below
#   that is EVERY such edit, not an edge case. UNION THE TWO FILES ON `over_pin` before reading any
#   trend across the cutover — a reader taking the growth ledger alone sees a drop and scores it as
#   the pin arm working. "One write, one warn" governs the REPORT; it leaked onto the RECORD.
#
#   ⛔ WHAT THIS ARM IS *NOT*, CORRECTED 2026-08-24 (census re-run by a reviewer):
#   the first draft justified 3b as covering the case where "the author has PIN HEADROOM and every
#   existing governor is silent." THAT STATE DOES NOT EXIST ON THIS CORPUS. Measured: ABOVE pin 21 ·
#   AT pin 0 · BELOW pin 0, all 21 band files (actions.md 3082 vs pin 1753 · active-recall.md 78163
#   vs 69584 · bash-environment.md 85957 vs 55098). Since 3b requires NET GROWTH and every file is
#   already over its pin, `grow > 400` implies `proj > cur >= pin` implies over_pin — ALWAYS. So 3b
#   is never the sole voice here. It is also SELF-SUSTAINING in that direction: `--refresh-pins` sets
#   `pin = min(pin, cur)`, so an author who follows this warn's own remediation restores zero
#   headroom. ⇒ HONEST CLAIM: strictly better, more actionable TEXT on a write the pin arm already
#   catches; it becomes independent coverage only where headroom exists. Keep it for the text, not
#   for a coverage gap it does not currently fill.
#
#   ⚠️ NET GROWTH IS THE RIGHT PREDICATE AND THE MEASURED SPLIT SAYS WHY (77 band
#   commits): 48% of net growth was pure-add hunks over 400 B, but a further 49% was
#   REPLACE-SHAPED hunks that still grew. A per-hunk or pure-add-only predicate would see roughly
#   half of it. Measuring the file's NET delta catches both and exempts genuine replacements.
#
#   WHY A REDIRECT AND NOT A TIGHTER LEVEL: a level warn's only compliant response is a
#   displacement pass the author did not come here to do, so it gets escaped or ignored. This one
#   names the destination (band_archive resolves it against the filesystem — see its header for the
#   3 band files whose archive is NOT `<stem>-cases.md`), so the compliant path costs less than
#   shipping the oversized entry. That asymmetry is the entire bet.
#
#   ⛔ THE ONE THING IT MUST NOT BECOME: "do not correct wrong rules." The threshold is on NET
#   GROWTH, so a replacement edit of any size passes silently, and the warn text says so in its own
#   words. A guard that suppressed corrections to always-loaded text would cost more than every byte
#   it saved.
#
#   Escape: SKIP_BAND_ENTRY_WARN=1 (this arm alone) or SKIP_BAND_GROWTH_WARN=1 (all of ARM 3).
#   Fires logged one JSON line each to .claude/logs/band-entry-fires.jsonl
#   (ts, file, grow, limit, prospective, over_pin, channel) — a SEPARATE log from the pin arm's, so
#   the acceptance gate can read per-entry fires without the pin arm's volume drowning them.
#
#   Escape: SKIP_BAND_GROWTH_WARN=1 (per-command scoped — never `export` it; an
#   exported SKIP_* outlives the command that needed it and silently disables the
#   arm inside any suite that asserts it FIRES).
#   Fires logged one JSON line each to .claude/logs/band-growth-fires.jsonl
#   (ts, file, pin, prospective, channel). `prospective` is a STRING because the
#   Bash-append channel can only bound it: "12345" when exact, ">12345" when the
#   channel proves growth without measuring it. Synthetic smoke fixtures route to
#   band-growth-fires.smoke.jsonl, same rationale as ARM 1/2's log split — a log
#   that is 99% self-test answers "is this guard earning its keep" with the wrong
#   number.
#
# Warn-first: ships WARN + hard-cap BLOCK. The SC-2 graduated tightening
# (lower the block threshold to the WARN band after the 2nd ignored warn) is a
# follow-up — needs an ignored-warn counter; the hard cap-block already prevents
# the actual data-loss harm, so warn-band stays non-blocking until observed.
#
# Companion: check-memory-size.sh (PostToolUse, now with a byte branch too).

set -u
# ⚠️ TO RUN THIS BY HAND: `echo '{}' | bash .claude/hooks/check-memory-budget.sh`
#   It reads the hook payload from STDIN, so a bare invocation BLOCKS FOREVER with no
#   output — measured 2026-07-31 (killed at a 2-minute timeout) and independently
#   flagged the same night as "a budget guard you can't run manually is one you only
#   hear from when it's too late to ask it anything." It is NOT broken as a hook; the
#   harness supplies stdin. Feeding it `{}` exercises the no-op path and exits clean;
#   feed a real PreToolUse payload to exercise the WARN/BLOCK branches.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

# MODEL CHANNEL (2026-08-25) — ARM 3 / ARM 3b emitted on bare stderr, measured DEAD to the
# model on PreToolUse (lib/warn-emit.sh carries the A/B). Consequence, measured: 228 band
# warnings fired after the 2026-08-16 pin refresh across 21/21 files, against 0 pin refreshes
# and +99,975 B of growth. Not a defied guard — an undelivered one; a defied guard leaves
# suppressions and `SKIP_BAND_*` appears in no tracked config.
# WHY THIS FILE WAS MISSED by the 2026-08-24 conversion of 9 siblings: the census
# predicate was FILE-level, and this file scores "structured" on 2 `hookSpecificOutput` hits
# that sit on ARM 1/2's DENY arms — a different subsystem — while its 29 stderr writes went
# unclassified — implementation kinship, not obligation kinship. A file with mixed
# per-arm channels cannot be classified by a file-level grep.
# Fallback FIRST, then source, so a missing lib degrades to exactly the pre-conversion
# behaviour rather than aborting a live fleet gate.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null

# ⛔ THE HARNESS CAP IS 24.4 KiB OF *CHARACTERS*, NOT BYTES — measured 2026-08-13, and this
# constant sat 615 ABOVE it, i.e. the gate was calibrated above the cliff it exists to prevent
# and read GREEN while the harness truncated the tail. Evidence — and note it is a BANNER, i.e.
# the truncation announces itself; see the "NOT silently" correction in the Background block:
# `MEMORY.md is 24.7KB (limit: 24.4KB) ... Only part of it was loaded` fired on a file measuring
# 25,527 BYTES / 25,300 CHARACTERS — and 25,300/1024 = 24.7 KiB exactly, while bytes give 24.9.
# So the harness counts CHARACTERS; 24.4 * 1024 = 24,985 is off a ROUNDED display, so the cliff
# itself is only BOUNDED (24,964-25,300 chars) and 24,985 is the safe GATE number, not an observed cliff.
#
# WHY A *BYTE* GATE AT THE CHARACTER NUMBER IS THE RIGHT FIX AND NOT A UNIT CONFUSION: bytes >=
# chars always (UTF-8), so `bytes <= 24985` GUARANTEES `chars <= 24985`. It errs strict on a
# multibyte-heavy file — the fail-safe direction — and never permits an overrun. Do NOT "correct"
# it upward to a byte-denominated 24.4 KiB; that reintroduces exactly the window this closes.
# ⛔ AND THE PROPOSAL WILL NOT ARRIVE AS "raise the cap" — THAT SHAPE IS EASY TO REFUSE. It arrives
# as "FIX THE UNIT: the harness counts characters, we gate bytes, so we are leaving headroom on the
# table" — the same overrun wearing a CORRECTION's costume, and it comes with a TRUE measurement
# attached. The gap is real and it is NOT free headroom: bytes >= chars always, so the divergence IS
# the safety margin, and it is the only margin there is — the cliff's exact boundary rests on ONE
# banner observation, the truncation drops always-loaded enforcement rows, and nothing but that
# banner reports it. A seat that has READ this block can still carry the question forward as merely
# UNECONOMIC and offer it up as available-on-request — and pricing a
# forbidden change is not refusing it. The answer to "which unit" is settled: BYTES, at this number.
# ⚠️ NO OPERANDS HERE ON PURPOSE. This block shipped with "24,870 bytes against 24,603 characters,
# so the unit switch reads as +263" — and that pair was falsified 56 SECONDS LATER by its own
# sibling commit (the index went to 19,651 B), while the difference was wrong by 4 (267, not 263).
# A hardcoded measurement in a guard rots at the speed of the thing it measures; derive it with
# `wc -c` vs `LC_ALL=en_US.UTF-8 wc -m` if you need it. The INVARIANT cannot rot.
# ⛔ THIS TEXT IS IN THE PLANE NOBODY READS — the refusal is ALSO in the deny REASON below, which is
# the only channel measured to reach a model. If you edit one, edit both.
#
# WHAT IT COSTS WHEN WRONG: this file is the always-loaded Trigger Index, so a silently dropped
# tail is silently dropped ENFORCEMENT RULES, reported by nothing — the wired-but-inert shape (the guard cannot
# see the thing it was written for). ORDER MATTERS if you ever raise/lower this: trim the file
# under the new number FIRST — lowering the cap onto an already-over file blocks every write to
# it fleet-wide on the next attempt (a pre-backstop blast radius).
# The pointer-length convention this guard states in its deny text AND warns on. ONE constant,
# because the two used to disagree by 120 chars (see the BLOAT block below).
POINTER_CONVENTION_CHARS=200
CAP_BYTES=24985
CAP_LINES=200
WARN_BYTES=18432   # 18 KB

# ARM 2 — skill MEMORY.md ratchet. Both are GROWTH-gated.
RATCHET_BLOCK_BYTES=57500   # 25k-token per-Read cap, NOT the 262,144 B byte cap
RATCHET_WARN_BYTES=46000

# ARM 3 — always-loaded band pins. No threshold constant on purpose: the bound is
# PER FILE and lives in the tracked JSON (see the ARM 3 header block for why one
# global number cannot work across a 1.7 KB..133 KB band). BAND_PINS_FILE is
# overridable so the smoke suite can point at a fixture map without touching the
# real one; production never sets it.
BAND_PINS_FILE="${BAND_PINS_FILE:-$ROOT/.claude/band-pins.json}"

# ARM 3b (2026-08-24) — PER-EDIT size, and the ONE global number that IS defensible here.
# ARM 3's header explains why no single SIZE threshold works across a 1.7 KB..86 KB band. A
# per-EDIT threshold is the opposite case: the corpus already agreed one, out loud, in its own file
# headers — "in one to three sentences, 150-400 bytes". So this arm enforces nothing new; it reads
# back the rule the file being edited already states about itself, at the moment of the write.
# Measured 2026-08-24, 21 band files: 17 carry that literal, 19 carry an "Appending here" header,
# and CLAUDE.md carries neither — it states a TIGHTER 100-250 B for a command line. So
# band_entry_contract below quotes whichever figure the edited file ACTUALLY carries and falls back
# to naming 150-400 as the shared contract otherwise; the warn can never misquote a file's own rule.
# (An earlier draft of this comment read "19 of its own 21" for the byte literal. 19 is the
# Appending-here count; the byte-literal count is 17.)
#
# WHY 400 AND NOT A DERIVED NUMBER: it is the corpus's own upper bound, unchanged since the
# headers were written. A threshold derived from observed edit sizes would ratchet UP toward
# whatever the fleet is already doing, which is the line-cap failure check-band-budget.mjs's
# header describes — a governor raised whenever it binds is not a governor.
BAND_ENTRY_WARN_BYTES=400

# ---------------------------------------------------------------------------
# --refresh-pins — the ONLY writer of .claude/band-pins.json.
#
# WHO RUNS IT, AND WHEN: the seat that just DISPLACED narrative out of a band
# file, in the SAME commit as the displacement. Not the hook, ever: a PreToolUse
# hook that writes to the tree mid-edit dirties the working copy underneath
# whatever else is in flight, and on many-writer files (which every band file is)
# that is a lost-update vector dressed as a convenience.
#
# It RATCHETS DOWN ONLY — new_pin = min(existing_pin, current_size):
#   * a file that SHRANK  -> pin follows it down, locking in the displacement;
#   * a file that GREW    -> keeps its old, smaller pin, so the growth stays
#                            visible on every later write until it is displaced;
#   * a file with NO pin  -> enrolled at its current size;
#   * a pin whose file left the band -> dropped.
# Raising a pin is therefore impossible here; it is a hand edit of the tracked
# JSON, which shows up in a diff and can be argued with. That asymmetry is the
# whole control — an automated raise would make the pin track the growth it exists
# to surface.
#
# Runs BEFORE the stdin read below on purpose: this mode must not block waiting
# for a hook payload that is never coming.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--refresh-pins" ]; then
  cd "$ROOT" || exit 1
  command -v jq >/dev/null 2>&1 || { echo "--refresh-pins needs jq" >&2; exit 1; }
  CUR_JSON=$(
    for f in CLAUDE.md AGENTS.md .claude/rules/*.md; do
      [ -f "$f" ] || continue
      printf '%s\t%s\n' "$f" "$(wc -c < "$f" | tr -d ' ')"
    done | jq -R -s 'split("\n") | map(select(length>0) | split("\t") | {(.[0]): (.[1]|tonumber)}) | add // {}'
  )
  # ⛔ ABSENT and CORRUPT are different states: a present-but-unparseable
  # map used to fall through to the first-seed branch, replacing EVERY ratcheted-down floor with
  # the file's CURRENT size under the same "band pins refreshed" success message. Refuse instead —
  # reseeding is only legitimate when there is genuinely nothing to preserve.
  if [ -f "$BAND_PINS_FILE" ]; then
    if ! OLD_JSON=$(jq -c '.pins // {}' "$BAND_PINS_FILE" 2>/dev/null); then
      echo "--refresh-pins: $BAND_PINS_FILE is PRESENT but unparseable — refusing to reseed every floor from current sizes (that erases ratchet memory silently). Fix or restore the file first." >&2
      exit 1
    fi
    [ -n "$OLD_JSON" ] || OLD_JSON='{}'
  else
    OLD_JSON='{}'   # genuinely absent → legitimate first seed
  fi
  jq -n --argjson old "$OLD_JSON" --argjson cur "$CUR_JSON" --arg ts "$(date -u +%Y-%m-%d)" '
    {
      "_": "Per-file byte pins for the ALWAYS-LOADED band (CLAUDE.md, AGENTS.md, .claude/rules/*.md). Read by .claude/hooks/check-memory-budget.sh ARM 3, which WARNS (never denies) when a write would take a file past its pin and the edit GROWS it. Regenerate after a displacement commit with: bash .claude/hooks/check-memory-budget.sh --refresh-pins  — that mode ratchets DOWN only, so raising a pin is a deliberate hand edit of this file.",
      "refreshed": $ts,
      "pins": (reduce ($cur|keys[]) as $k ({};
        .[$k] = (if ($old[$k] // null) == null then $cur[$k] else ([$old[$k], $cur[$k]] | min) end)))
    }' > "$BAND_PINS_FILE.tmp" && mv "$BAND_PINS_FILE.tmp" "$BAND_PINS_FILE"
  echo "band pins refreshed -> $BAND_PINS_FILE"
  exit 0
fi

# band_rel <path> -> repo-relative band KEY on stdout, or non-zero if out of band.
# Classifies on the path RELATIVE TO $ROOT rather than on a trailing glob: a bare
# `*/CLAUDE.md` would also claim a nested CLAUDE.md in some vendored subtree or a
# sibling repo, which is not this band and not our budget.
band_rel() {
  local rel="$1"
  case "$rel" in "$ROOT"/*) rel="${rel#"$ROOT"/}" ;; esac
  case "$rel" in ./*) rel="${rel#./}" ;; esac
  case "$rel" in
    CLAUDE.md|AGENTS.md|.claude/rules/*.md) printf '%s' "$rel" ;;
    *) return 1 ;;
  esac
}

# band_pin <key> <fallback-bytes> -> pin bytes. An UNPINNED band file falls back to
# the size passed in (its current on-disk size at the call site), which is exactly
# what --refresh-pins would have recorded — see the header for why that beats a
# silent pass.
band_pin() {
  local key="$1" fallback="$2" v=""
  if [ -f "$BAND_PINS_FILE" ] && command -v jq >/dev/null 2>&1; then
    v=$(jq -r --arg k "$key" '(.pins[$k] // empty)' "$BAND_PINS_FILE" 2>/dev/null)
  fi
  case "${v:-x}" in ''|*[!0-9]*) v="$fallback" ;; esac
  printf '%s' "$v"
}

# band_archive <band-key> -> a DESTINATION PHRASE on stdout (never a bare path).
#
# ⛔ THE NAIVE `${stem}-cases.md` FORMULA IS WRONG FOR 3 OF THE 21 BAND FILES, and band_warn
# printed those wrong paths from 2026-08-13 until 2026-08-24 (measured, all 21 enumerated):
#   CLAUDE.md        -> "CLAUDE-cases.md"        does NOT exist; the real archive is CLAUDE-md-cases.md
#   active-recall.md -> "active-recall-cases.md" does NOT exist; THREE differently-named archives do
#   actions.md       -> "actions-cases.md"       does not exist and never has — no archive twin
# A remediation string is the one kind of stale pointer that gets FOLLOWED (check-band-budget.mjs
# records exactly that failure at its per-file arm), so a warn naming a nonexistent file invites the
# reader to create a SECOND archive home beside the real one. This resolves against the filesystem
# and says CREATE only when there is genuinely nothing to append to.
band_archive() {
  local key="$1" base stem dashed dir n first f
  base="${key##*/}"; stem="${base%.md}"; dashed="${base//./-}"
  dir="$ROOT/.claude/docs/rules-ARCHIVE"
  [ -f "$dir/${stem}-cases.md" ] && { printf 'append it to .claude/docs/rules-ARCHIVE/%s-cases.md' "$stem"; return 0; }
  # CLAUDE.md -> CLAUDE-md-cases.md (the dotted stem is spelled with a dash in the archive)
  [ -f "$dir/${dashed}-cases.md" ] && { printf 'append it to .claude/docs/rules-ARCHIVE/%s-cases.md' "$dashed"; return 0; }
  n=0; first=""
  for f in "$dir/${stem}-"*.md; do
    [ -f "$f" ] || continue          # bash leaves an unmatched glob literal — this is the guard
    n=$((n + 1)); [ -n "$first" ] || first="${f##*/}"
  done
  if [ "$n" -gt 0 ]; then
    printf 'append it to the matching .claude/docs/rules-ARCHIVE/%s-*.md archive (%s of them, e.g. %s)' "$stem" "$n" "$first"
    return 0
  fi
  printf 'this file has NO archive twin yet — create .claude/docs/rules-ARCHIVE/%s-cases.md and start it there' "$stem"
}

# band_entry_contract <file-path> -> the byte contract THAT FILE states about itself.
# Fixed-string probes only: a bounded-quantifier-before-alternation regex is the shape
# grep-blowup-warn.sh blocks (it refused exactly that pattern while this arm was being built), and
# a per-write hook has no business running a backtracking scan anyway.
band_entry_contract() {
  local f="$1"
  if grep -q -F '150-400 bytes' "$f" 2>/dev/null; then
    printf '150-400 bytes, stated in this file'"'"'s own "Appending here" header'
  elif grep -q -F '100-250 B' "$f" 2>/dev/null; then
    printf '100-250 B, stated in this file'"'"'s own header — TIGHTER than the %s B line below' "$BAND_ENTRY_WARN_BYTES"
  else
    printf '150-400 bytes — the band'"'"'s shared append contract; this file states no byte figure of its own'
  fi
}

# band_warn <key> <pin> <prospective-display> <channel> [current-bytes]
#
# ⛔ THE 5TH ARG EXISTS BECAUSE THIS BANNER PRINTS A PROJECTION AND READS LIKE A MEASUREMENT.
# `$proj` is the size the file WOULD BE after the pending write. It is NOT a baseline, and a reader
# has no way to tell from the text. Worse, the always-loaded write guard BLOCKS the first Edit on a
# `.claude/rules/*.md` by design and tells you to re-issue, so a deliberate rule edit fires this
# banner at least TWICE — and differencing two projections measures your own redrafting between
# attempts. Measured 2026-09-20: two fires read 40,514 and 40,498, reported as "net -16 bytes" in a
# commit body and a review report, against a true +337. It fails in the FLATTERING direction by
# construction (a second draft is usually tighter), on the one plane where bytes are the cost.
# Passing current makes the pair usable at the only moment anyone wants it. OPTIONAL: the two
# Bash-channel call sites do not pass it and degrade to the old text rather than printing a wrong
# number. Remedy located by reading `cur_bytes` into scope here before proposing it.
band_warn() {
  local key="$1" pin="$2" proj="$3" chan="$4" cur="${5:-}" arch ts dir log
  arch=$(band_archive "$key")
  dir="$ROOT/.claude/logs"; mkdir -p "$dir" 2>/dev/null || true
  log="band-growth-fires.jsonl"
  [ -n "${CLAUDE_HOOK_SMOKE:-}" ] && log="band-growth-fires.smoke.jsonl"
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s","file":"%s","pin":%s,"prospective":"%s","channel":"%s"}\n' \
    "$ts" "$key" "$pin" "$proj" "$chan" >> "$dir/$log" 2>/dev/null || true
  # MODEL CHANNEL — capture the advisory, then call warn_emit IN THIS SHELL. ⛔ NOT the pipe
  # form: `{...} | warn_emit` runs warn_emit in a pipe-RHS SUBSHELL, so its _WARN_EMITTED guard
  # dies with the subshell and a multi-fire (the call sites sit in a while loop) emits N
  # concatenated JSON documents — at which point stdout stops parsing and NO advisory reaches
  # the model, INCLUDING the first. Shipped in the pipe form; caught the same day
  # with a 3-file reproduction (3 docs, unparseable) against a 1-file control (clean). The
  # comment here previously claimed the opposite residual ("a second fire still reaches the
  # terminal") — stderr does, stdout does not. First-call-wins only works from the parent.
  local _advisory
  _advisory=$({ echo ""
    echo "ℹ️  band growth: $key would be $proj B${cur:+ (now $cur B)}, over its pin of $pin B ($chan). Every byte here is paid twice — orchestrator context AND every sub-agent dispatch."
    echo "    Displace the incident NARRATIVE — $arch (or the meta L# ledger) — and keep in the band file: the DIRECTIVE + the TELL + the one discriminating number + a pointer."
    echo "    Then, in the SAME commit: bash .claude/hooks/check-memory-budget.sh --refresh-pins   (ratchets the pin DOWN to the new size)."
    echo "    WARN-only, never blocks. Escape: set SKIP_BAND_GROWTH_WARN=1 in .claude/settings.json's env block, then restart."
    echo "    (NOT an inline prefix: this is a PreToolUse hook on Edit|Write|MultiEdit — the harness spawns it, there is no command to prefix.)"
    echo ""
  })
  warn_emit "$_advisory" || true
}

# band_entry_warn <key> <grow-bytes> <projected> <pin> <over-pin 0|1> <channel>
#
# A REDIRECT, NOT A REFUSAL — and that distinction is the whole reason this arm is expected to
# survive where the pin arm has been outrun. The pin arm says "this file is bigger than it has ever
# been", which the author usually already knows and cannot act on without a displacement pass; this
# one says "your entry is N bytes, your file's own rule says 400, here is the file it goes in
# instead" — a compliant path that costs LESS than shipping the oversized entry did.
#
# ⛔ IT MUST NOT READ AS "DO NOT CORRECT WRONG RULES." A correction that REPLACES text is net-small
# or net-negative and never reaches this arm (ARM 3's growth precondition gates it, and the
# threshold is on the DELTA, not on the entry). Correcting a wrong always-loaded sentence is the
# highest-value write in this corpus and suppressing one would be the worst artifact this hook could
# produce — the message says so in its own words, because a guard's text is the only thing a hurried
# reader gets.
band_entry_warn() {
  local key="$1" grow="$2" proj="$3" pin="$4" overpin="$5" chan="$6" dest contract ts dir log
  dir="$ROOT/.claude/logs"; mkdir -p "$dir" 2>/dev/null || true
  log="band-entry-fires.jsonl"
  [ -n "${CLAUDE_HOOK_SMOKE:-}" ] && log="band-entry-fires.smoke.jsonl"
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s","file":"%s","grow":%s,"limit":%s,"prospective":%s,"over_pin":%s,"channel":"%s"}\n' \
    "$ts" "$key" "$grow" "$BAND_ENTRY_WARN_BYTES" "$proj" "$overpin" "$chan" >> "$dir/$log" 2>/dev/null || true
  dest=$(band_archive "$key")
  contract=$(band_entry_contract "$ROOT/$key")
  # MODEL CHANNEL — parent-shell capture, same reason as band_warn (the pipe form runs
  # warn_emit in a subshell and defeats the process-wide once-only guard). Even though THIS
  # arm's call site exits right after, the growth arm can fire earlier in the same process —
  # the guard is only process-wide if every caller stays in the parent shell.
  local _advisory
  _advisory=$({ echo ""
    echo "ℹ️  band ENTRY size: this edit adds $grow B to $key — past the ${BAND_ENTRY_WARN_BYTES} B per-entry contract ($contract)."
    echo "    Keep in the band file: DIRECTIVE + TELL + the one discriminating number + an anchor. That is what 150-400 B buys."
    echo "    The narrative — dates, shas, who measured what, the retraction chain — is the part that does not fit: $dest."
    if [ "$overpin" = "1" ]; then
      echo "    (This also takes the file past its pin of $pin B, so it is new high-water text, not a swap. Same remedy.)"
    fi
    echo "    A CORRECTION THAT REPLACES PASSES SILENTLY — only NET growth is measured, so fixing a wrong always-loaded"
    echo "    sentence never trips this, however long the new sentence is. WARN-only, never blocks."
    echo "    Escape: set SKIP_BAND_ENTRY_WARN=1 in .claude/settings.json's env block, then restart."
    echo "    (NOT an inline prefix: this is a PreToolUse hook on Edit|Write|MultiEdit — the harness spawns it, there is no command to prefix.)"
    echo ""
  })
  warn_emit "$_advisory" || true
}

# band_bash_scan <command> — ARM 3's Bash channel. Warns and RETURNS; it never
# exits, so ARM 1/2's cacheinfo parse below still runs on the same payload.
#
# ⚠️ ARM 3b (per-entry size) DOES NOT REACH THIS CHANNEL, and that is a scope statement rather than
# a decision to revisit: a `>>` append's payload bytes are not recoverable from the command string,
# so there is no delta to compare to 400. The pin arm bounds that channel (monotonic append past an
# at-or-above-pin file) and is the honest ceiling of what this channel can assert.
#
# WHY THE APPEND CHANNEL AND NOT ONLY cacheinfo: the fixture's EVENT has to come
# from the channel the band's writes actually travel, not from the channel a
# sibling arm happens to be wired to. ARM 2's deny text and block-subagent-
# memory-write.sh's deny text BOTH prescribe a Bash `>>` append as the sanctioned
# way to land durable text, and this hook's own ARM 3 warn prescribes appending
# displaced narrative to a rules-ARCHIVE file. So `>>` is the live path by
# construction, and an arm that covered only `--cacheinfo` would certify the guard
# against an event the band's writers rarely generate.
band_bash_scan() {
  local cmd="$1" t key pin cur sha bp b rr
  [ -n "${SKIP_BAND_GROWTH_WARN:-}" ] && return 0
  case "$cmd" in *.claude/rules/*|*CLAUDE.md*|*AGENTS.md*) ;; *) return 0 ;; esac

  # (a) APPEND REDIRECT. Not exactly projectable — the heredoc/echo bytes are not
  # recoverable from the command string — but `>>` is MONOTONIC: it can only add.
  # So when the file already sits AT OR ABOVE its pin, the post-write size is
  # strictly over the pin without measuring a single byte of the payload. That is
  # a bound, not a guess, and the warn text says ">N" rather than a fabricated
  # exact figure.
  #   BELOW the pin (real headroom, e.g. immediately after a displacement) the
  # crossing is genuinely undecidable here and this arm FAILS OPEN — the same
  # honest scope the cacheinfo arm states for heredocs, and the reason a single
  # truncating `>` is NOT matched either (a whole-file rewrite can shrink).
  while IFS= read -r t || [ -n "$t" ]; do
    [ -n "$t" ] || continue
    t="${t#>>}"; t="${t##*[[:space:]]}"
    case "$t" in /*) ;; *) t="$ROOT/$t" ;; esac
    key=$(band_rel "$t") || continue
    [ -f "$ROOT/$key" ] || continue
    cur=$(wc -c < "$ROOT/$key" 2>/dev/null | tr -d ' ')
    case "${cur:-x}" in ''|*[!0-9]*) continue ;; esac
    pin=$(band_pin "$key" "$cur")
    [ "$cur" -ge "$pin" ] || continue
    band_warn "$key" "$pin" ">$cur" "Bash>>"
  done <<EOF
$(printf '%s' "$cmd" | grep -oE ">>[[:space:]]*[^[:space:];|&)\"'<]+")
EOF

  # (b) BLOB-ISOLATION STAGE — EXACTLY projectable (`git cat-file -s` reads a blob
  # that already exists). This is a SEPARATE pass from ARM 1/2's loop below, and
  # that separation is load-bearing: that loop keeps the single LARGEST *MEMORY*.md
  # triple, so folding band paths into it would let a 133 KB rules blob shadow an
  # oversize MEMORY blob and silently re-open the multi-triple bypass that the
  # cacheinfo loop below closes. Two passes, no shared state, neither can mask the other.
  case "$cmd" in *update-index*--cacheinfo*) ;; *) return 0 ;; esac
  rr=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-.}")
  while IFS= read -r t || [ -n "$t" ]; do
    [ -n "$t" ] || continue
    sha=${t#*,}; sha=${sha%%,*}
    bp=${t##*,}
    case "$bp" in /*) ;; *) bp="$rr/$bp" ;; esac
    key=$(band_rel "$bp") || continue
    b=$(git -C "$rr" cat-file -s "$sha" 2>/dev/null)
    case "${b:-x}" in ''|*[!0-9]*) continue ;; esac   # unreadable blob -> fail open
    cur=0
    [ -f "$ROOT/$key" ] && cur=$(wc -c < "$ROOT/$key" 2>/dev/null | tr -d ' ')
    case "${cur:-x}" in ''|*[!0-9]*) cur=0 ;; esac
    pin=$(band_pin "$key" "$cur")
    [ "$b" -gt "$pin" ] || continue
    [ "$b" -gt "$cur" ] || continue        # growth is a precondition of both bands
    band_warn "$key" "$pin" "$b" "Bash-cacheinfo"
  done <<EOF
$(printf '%s' "$cmd" | grep -oE '[0-7]{6},[0-9a-fA-F]{40,64},[^[:space:]"'"'"']+')
EOF
}

# Candidate-emitter (2026-07-01, from a five-seat memory-tiering review panel). When the
# budget fires, print NAMED relocate/dedup candidates to stderr instead of generic "move
# pointers" advice (a review found the old warn non-actionable: it was ignored across
# 4.75 KB of growth, 18→22.75 KB). All
# generators are deterministic + PROPOSE-only — the agent confirms + RELOCATES to the
# cold MEMORY-INDEX.md; it NEVER auto-deletes (auto-evict was a panel REJECT: fire-rate
# is blind to cost-of-miss, so a zero-fire row can be rare-but-catastrophic).
emit_candidates() {
  # $ROOT-anchored: $mem arrives ABSOLUTE (often the symlinked project-memory path)
  # while this was RELATIVE, so run from any other cwd the DUP arm silently emitted
  # nothing while its "relocate candidates" header still printed. Silent-and-open
  # under a header is exactly the shape that reads as "checked, nothing found".
  local mem="$1" ar="$ROOT/.claude/rules/active-recall.md"
  [ -f "$mem" ] || return 0
  # ⛔ THE HEADER PRESCRIBES NOTHING: the remedy line was fixed to "compress
  # in place" while this header still framed every arm below it as "move to the cold MEMORY-INDEX.md",
  # so a skimming seat met the cold-move as the framing and the correction as a sub-item under it.
  # That framing is the exact move that once took a budget directive out of its always-loaded row.
  # Disposition is PER ARM: DUP relocates only after its stated verification; LONG ROWS compresses
  # in place, never moves; CARRIER retires only a row whose trigger AND action a delivered carrier states.
  echo "  -- MEMORY.md candidates (PROPOSE-only; disposition is PER ARM below — a move is sanctioned only where an arm says so, NEVER by this header; never auto-delete) --" >&2
  # (1) cross-file dup — a quoted recognition-token in a MEMORY.md row that also lives
  #     in an always-loaded sibling (active-recall.md) → the hot copy is redundant.
  # ⛔ PARKED SIBLING (2026-09-07): active-recall.md is PATH-SCOPED — its
  # rows are delivered on NO turn while the exhortation-cut experiment stands. This arm's premise is
  # DELIVERY ("also lives in an always-loaded sibling") but its hedge is CONTENT, so parking falsifies
  # the premise while leaving the hedge satisfiable — and following the arm would delete the LAST
  # delivered carrier. Detect parking by the frontmatter, never by a membership list.
  ar_parked=0; head -20 "$ar" 2>/dev/null | grep -q '^paths:' && ar_parked=1
  if [ -f "$ar" ]; then
    grep -E '^\|' "$mem" | while IFS= read -r line; do
      tok=$(printf '%s' "$line" | grep -oE '"[^"]{5,}"' | head -1 | tr -d '"')
      [ -n "$tok" ] || continue
      # ⛔ MULTI-WORD ONLY. A single-word token is an unanchored whole-file substring
      # test, so it matches ordinary English and flags rows whose obligation has nothing
      # to do with the sibling it "matched". Calibrated OUT OF THREAD (the author of a
      # finding is disqualified — their own writing is the FP corpus) against all 165
      # revisions that ever touched MEMORY.md: of the SEVEN distinct tokens this arm has
      # flagged in its life, the four TRUE duplications are all multi-word ("monitor
      # post-launch", "shall I proceed?", "N hours", "use server") and all three FALSE
      # ones are single words — "workaround" matched the ordinary phrase "no viable
      # workaround" in a governance bullet; "blocked" matched defer-rationale rows that
      # treat it as an empirical claim while the MEMORY row is about AUTHORITY, nearly
      # the opposite; "applied" matched rows about composing your OWN claim rather than
      # consuming someone else's label. Measured: 310/310 true emissions kept, 166/166
      # false dropped, 0 flags today.
      # HONEST BOUND: word count is a proxy for SPECIFICITY, not a test of OBLIGATION.
      # Fitted to seven observations. It would still pass a generic multi-word phrase and
      # still miss a genuinely duplicated one-word trigger. A real obligation comparator
      # was measured and REFUSED — but NOT on the rate reading this comment first carried
      # ("four duplications in four months"), which reads as ~1/month and invited exactly
      # the right attack: a growing corpus GENERATES new true positives, so decay follows
      # only if arrival is slower than false accumulation. That is EMPIRICAL, not
      # structural, and "by construction" was the wrong claim. THE MEASUREMENT that
      # settles it: all four true duplications were minted in a FOUR-DAY WINDOW in April
      # (2026-04-18 x3 in one commit, 2026-04-21 x1) and NONE has appeared since, while
      # the index grew 68% (68 rows on 05-01 -> 114 today, peaking at 123). So arrival is
      # measured at ZERO against real growth: the duplication-generating process was a
      # one-time BUILD-OUT artifact, not an ongoing hazard.
      # ⛔ THE DISTINCTION IS LOAD-BEARING FOR ANYONE REUSING THIS REASONING: in a corpus
      # that still generates its target, "true positives are consumed and false ones are
      # permanent" stays TRUE while the conclusion goes FALSE, because the numerator
      # refills. Cite the arrival measurement, never the mechanism.
      # The asymmetry decides it — a missed dup leaves a row hot (cheap); a
      # false one tells a blocked seat to delete live coverage (not cheap).
      case "$tok" in *" "*) ;; *) continue ;; esac
      if grep -qF "$tok" "$ar" 2>/dev/null; then
        ptr=$(printf '%s' "$line" | grep -oE '[A-Za-z0-9_-]+\.md' | tail -1)
        # The old text ended "may relocate (firing preserved by the sibling)" — a
        # COVERAGE GUARANTEE this predicate cannot support. It names no sibling row, so
        # a seat cannot check it, and it was false in 3 of 7 lifetime findings. A seat
        # 484 bytes from a hard stop read that as sanction to move a row whose coverage
        # nothing else carried. It asks a question now instead of issuing a verdict.
        if [ "$ar_parked" = "1" ]; then
          echo "  * DUP \"$tok\" also appears in active-recall.md -> row [${ptr:-?}] is NOT redundant: that sibling is PATH-SCOPED (parked 2026-09-07, delivered on no turn), so this hot row may be the ONLY delivered carrier. Do not relocate on this arm while the parking stands." >&2
          # ⛔ >&2 LIKE ITS SIBLING BELOW (2026-10-13): this echo went to STDOUT, so the GROWTH-ONLY warn path,
          # which calls emit_candidates uncaptured, printed a non-JSON line on a PreToolUse hook's stdout. It
          # was latent until the first multi-word quoted MEMORY.md token that also appears in the parked
          # sibling ("this session") and turned the smoke SAFE byte-cap arm red.
          continue
        fi
        echo "  * DUP \"$tok\" also appears in active-recall.md -> row [${ptr:-?}] MAY be redundant. NOT verified: this matched a STRING, not an obligation. Find the sibling row, confirm it fires at the SAME moment on the SAME trigger, and only then relocate to the cold MEMORY-INDEX.md." >&2
      fi
    done
  fi
  # (2) action-cell bloat — rows carrying rationale that belongs in the feedback_* body.
  # ⛔ THE THRESHOLD IS THE ONE THIS GUARD ITSELF STATES. It warned at >320 while its own deny
  # text says "Pointers <=200 chars" — one guard, two numbers, 120 apart, so a sweep run against
  # the warn did not move the convention and 56 rows sat over the stated limit unreported
  # (measured 2026-08-27: 57 of 114 over 200, exactly 1 over 320 — the guard was near-silent on
  # its own rule). Aligned to 200, which is presumably why it was raised: at 200 a naive per-row
  # print is ~57 lines on every memory write. So it reports a COUNT plus the three worst rows —
  # honest about the real state, bounded to five lines. Keep POINTER_CONVENTION_CHARS as the one
  # place the number lives; the deny text below reads the same constant.
  # ⛔ THE 200 IS ASPIRATIONAL, not a cap. CAP_BYTES is the
  # real gate. This arm reports long rows so they can be COMPRESSED, and must not read as a breach.
  # ⛔ AND THE OLD REMEDY WAS THE DEFECT: it said "move the WHY into the feedback_* body", a COLD
  # destination. That is exactly how a spend directive left the always-loaded row and stopped
  # firing (since restored). Only RATIONALE is movable, and only to an ALWAYS-LOADED destination.
  # Compress wording in place.
  awk -v CONV="$POINTER_CONVENTION_CHARS" '
    index($0,"|")==1 {
      n++; L = length($0)
      if (L > CONV) { over++; excess += L - CONV
        if (L > worstL[1]) { worstL[3]=worstL[2]; worstS[3]=worstS[2]; worstL[2]=worstL[1]; worstS[2]=worstS[1]; worstL[1]=L; worstS[1]=substr($0,1,48) }
        else if (L > worstL[2]) { worstL[3]=worstL[2]; worstS[3]=worstS[2]; worstL[2]=L; worstS[2]=substr($0,1,48) }
        else if (L > worstL[3]) { worstL[3]=L; worstS[3]=substr($0,1,48) }
      }
    }
    END {
      if (over > 0) {
        printf "  * LONG ROWS: %d of %d over %d chars (%d above). ASPIRATIONAL, not a cap — the byte gate above is the real one.\n", over, n, CONV, excess
        for (i=1;i<=3;i++) if (worstL[i] > 0) printf "      %4d ch: %s...\n", worstL[i], worstS[i]
        printf "      Fix: COMPRESS the wording in place. Do NOT move a clause to a feedback_* body — that is COLD, and an imperative there stops firing.\n"
      }
    }' "$mem" >&2
  # (3) CARRIER — a manual check (no tool computes it; rules-trigger-firerate.mjs reads rules files, not MEMORY.md).
  echo "  * CARRIER (higher-yield): a row whose trigger AND action a hook or resident file already delivers at the same moment may retire to MEMORY-INDEX.md § Retired hot rows. rules-trigger-firerate.mjs does NOT read MEMORY.md — never cite it as evidence a row is dead." >&2
}

INPUT=$(cat 2>/dev/null || echo "{}")

# ⚡ ZERO-SUBPROCESS PREFILTER — this hook sits on the Bash matcher (2026-08-12), so its
# cost is paid on EVERY Bash call by every seat. Without this, an ordinary `ls` paid three
# jq invocations before the first early exit: MEASURED 33 ms/call against the ~12 ms
# process-startup floor documented on the sibling (check-memory-size.sh). A payload with
# neither a file_path nor a `cacheinfo` triple is out of scope by construction, and a shell
# case-match on a string we already hold costs no fork. Do NOT "simplify" this away — the
# per-hook saving is real and measured.
#
# ⛔ BUT THE FLEET-WIDE CLAIM IS STRUCK, AND IT WAS MINE. This comment used to end "it is the
# difference between a ~12 ms floor and a 33 ms fleet-wide tax." That is refuted by a
# measurement taken EIGHT MINUTES after this prefilter shipped: a later commit put an
# UNPREFILTERED sibling (check-memory-budget-post.sh, 3 forks) on this same Bash matcher, and
# the combined per-call cost measured ~34 ms — the same order as the 33 ms
# this prefilter was written to eliminate. Neither commit message noticed. So the prefilter is
# a saving on THIS hook and NOT a net fleet-wide win, and the honest scope is the first claim
# without the second.
# Nor can the prefilter reach the dominant term: ~10.6 of this hook's ~15.2 ms is bash LEXING
# a majority-comment file before the prefilter's first statement runs. If the cost is worth
# paying down, the lever is a dispatcher split (exec the heavy body only on a candidate
# payload) — a performance change to a fleet-wide DENY hook, which wants its own review.
# Struck as a TRUTH correction, not a calibration: I authored both hooks and am
# disqualified from judging this guard's cost/benefit, but a sentence refuted by measurement
# is not a judgement call.
#
# ARM 3 (2026-08-13) adds a THIRD admitted shape and deliberately makes it the
# narrowest of the three: a Bash payload that both names a band path AND carries an
# append redirect. Either half alone is common (`grep .claude/rules/...` has no `>>`;
# `echo x >> /tmp/f` names no band file), and admitting either alone would put the
# full parse on the hot path for ordinary calls. Both together is rare and is exactly
# the write channel ARM 3 exists to see. Still zero forks — a nested case-match on a
# string already in memory.
case "$INPUT" in
  *cacheinfo*)   ;;   # candidate Bash blob-stage — needs the full parse below
  *file_path*)   ;;   # Edit / Write / MultiEdit — the pre-existing path
  *.claude/rules/*|*CLAUDE.md*|*AGENTS.md*)
    case "$INPUT" in *'>>'*) ;; *) exit 0 ;; esac ;;
  *) exit 0 ;;
esac

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# ==================== BASH CHANNEL (2026-08-12) ====================
# A Bash payload carries `command`, never `file_path` — so before this block the
# `[ -z "$FILE_PATH" ] && exit 0` below returned at the first branch on EVERY Bash
# write, and this hook (the only one that DENIES an oversize write to the
# always-loaded index) was blind to the whole channel.
#
# ⛔ WHY THIS SHAPE AND NOT THE SIBLINGS' — the measured gap is NOT the redirect.
# check-memory-size.sh and dup-durable-append-warn.sh both key on `>>`/`>` targets.
# The channel measured breaching this cap on 2026-08-12 was
# `git hash-object -w --stdin` + `git update-index --cacheinfo <mode>,<sha>,<path>`
# — git plumbing that never names the file as a redirect target, so a port of the
# sibling regex would have looked complete and still missed it. That channel is the
# blob-isolation recipe active-recall.md PRESCRIBES for a many-writer file under peer
# collision, i.e. following the rule correctly is what evaded the guard.
#
# It is also the one Bash shape that is EXACTLY projectable pre-write: the blob is
# already in the object store, so `git cat-file -s <sha>` is the resulting byte count
# — the SIZE is measured, never guessed.
#
# ⛔ BUT THE MATCH IS NOT FALSE-POSITIVE-FREE, AND THIS COMMENT USED TO CLAIM IT WAS.
# "no false block" / "no false positives" are STRUCK:
# refuted 5/5 by MENTION-class denies — an `echo`, a `grep`, a trailing shell COMMENT
# (the command executed was `ls -la`), a mail heredoc, and a reviewer running `git show`
# on the commit that shipped this. Measuring the SIZE honestly says nothing about whether
# the text was going to RUN, which is the use-vs-mention question and the answer
# here is plainly "people write this without running it".
# CALIBRATED REACHABILITY, so the scope is not overstated in the other direction: 11 .md
# files in the corpus mention `cacheinfo` and ZERO carry a concrete real-sha triple, so a
# false deny needs a seat reproducing an incident, costs one rewrite, and can never lock
# out Bash. I cannot calibrate this myself — the figure is the out-of-thread
# reviewer's, which is the right provenance for it.
#
# SCOPE, stated rather than implied: a `>`/`>>` heredoc or an in-process rewrite
# (python -c, sed -i) is NOT projectable from the command string, so this arm FAILS
# OPEN on them. Their LINE breach is caught post-hoc by check-memory-size.sh (Bash
# matcher); their BYTE breach remains uncovered. Blocking on a guess would be worse
# than not blocking.
if [ -z "$FILE_PATH" ] && [ "$TOOL" = "Bash" ]; then
  BCMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
  # ARM 3 first, and it never exits — a single command can append to a rules file
  # AND stage a MEMORY blob, and neither arm may swallow the other's payload.
  band_bash_scan "$BCMD"
  case "$BCMD" in
    *update-index*--cacheinfo*) ;;
    *) exit 0 ;;
  esac
  # ⛔ `--cacheinfo` IS REPEATABLE — git's own synopsis reads
  #     [(--cacheinfo <mode>,<object>,<file>)...]
  # so ONE invocation can stage N blobs. This used to end in `| head -1`, inspecting only
  # the FIRST triple: a call that stages a non-MEMORY path first fell out at the
  # *MEMORY*.md filter below and the MEMORY triple behind it was never read. That is a
  # bypass INSIDE the one spelling this arm claims to project — not an undisclosed
  # channel — and it is reachable by ORDINARY USE: isolating hunks in TWO shared files in
  # a single `update-index` call is the normal shape of the very recipe this hook polices.
  # Single-cause attributed (decoy-then-oversize
  # ALLOWED / oversize-only DENIED, both controls behaving). Iterate EVERY triple and
  # judge the LARGEST MEMORY blob, so a decoy cannot shadow a breach.
  #
  # Hex is [0-9a-fA-F]: git ACCEPTS an uppercase sha (`git cat-file -t <UPPER>` -> commit).
  # STILL OUT OF SCOPE, stated rather than implied: git's documented space form
  # (`--cacheinfo <mode> <object> <path>`, kept "for backward compatibility") is NOT
  # matched — this regex is comma-anchored. One spelling, honestly named, with the
  # PostToolUse companion as the channel-blind net behind it.
  #
  # RROOT stays git-FIRST here and that is deliberate — unlike the top-level ROOT
  # (CLAUDE_PROJECT_DIR first) it resolves a BLOB in whichever repo the command runs
  # against, so the worktree root is the correct answer. Do not "align" it with ROOT.
  RROOT=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-.}")
  BEST_BYTES=-1
  # `|| [ -n "$CI" ]`: `read` returns non-zero on an unterminated final record.
  while IFS= read -r CI || [ -n "$CI" ]; do
    [ -n "$CI" ] || continue
    BSHA=${CI#*,}; BSHA=${BSHA%%,*}
    BPATH=${CI##*,}
    # Resolve relative targets against the repo root (the sibling's hard-won lesson:
    # the prescribed recipe is repo-RELATIVE, so a cwd-relative check is unreachable).
    case "$BPATH" in /*) ;; *) BPATH="$RROOT/$BPATH" ;; esac
    case "$BPATH" in *MEMORY*.md) ;; *) continue ;; esac
    B=$(git -C "$RROOT" cat-file -s "$BSHA" 2>/dev/null)
    case "${B:-x}" in ''|*[!0-9]*) continue ;; esac                # unreadable blob -> fail open
    L=$(git -C "$RROOT" cat-file blob "$BSHA" 2>/dev/null | wc -l | tr -d ' ')
    case "${L:-x}" in ''|*[!0-9]*) continue ;; esac
    if [ "$B" -gt "$BEST_BYTES" ]; then
      BEST_BYTES="$B"; BASH_PROJ_BYTES="$B"; BASH_PROJ_LINES="$L"; FILE_PATH="$BPATH"
    fi
  done <<EOF
$(printf '%s' "$BCMD" | grep -oE '[0-7]{6},[0-9a-fA-F]{40,64},[^[:space:]"'"'"']+')
EOF
  [ "$BEST_BYTES" -ge 0 ] || exit 0
fi

[ -z "$FILE_PATH" ] && exit 0

# Classify into an ARM. Skill MEMORY.md is matched in both its relative and
# absolute spellings; it cannot collide with ARM 1's */memory/MEMORY.md pattern
# (case globs are case-sensitive — "MEMORY.md" is a FILE, not a /memory/ dir).
KIND=""
BAND_KEY=""
case "$FILE_PATH" in
  */project-memory/MEMORY.md|*/memory/MEMORY.md)           KIND=index    ;;
  .claude/skills/*/MEMORY.md|*/.claude/skills/*/MEMORY.md) KIND=skillmem ;;
  # ARM 3 — resolved by FUNCTION, not by a trailing glob (see band_rel).
  *) if BAND_KEY=$(band_rel "$FILE_PATH"); then KIND=band; else exit 0; fi ;;
esac
# MEMORY-ARCHIVE.md is UNCOVERED BY DESIGN — deliberately absent from the case above.
# It is the cold half of the tier split (scripts/memory-tier-split.mjs moves entry
# BODIES there): a grep-retrieved store, never read whole at invocation, so the
# read-ceiling this hook defends does not apply to it. Same class as the meta
# exemption below, for the same reason. Do NOT "fix" this by adding an archive
# pattern — that would ratchet the very destination the deny reason prescribes,
# leaving a distilling agent with nowhere to put the bodies.

# Current on-disk size (0 if absent — e.g. a first Write).
cur_bytes=0; cur_lines=0
if [ -f "$FILE_PATH" ]; then
  cur_bytes=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
  cur_lines=$(wc -l < "$FILE_PATH" 2>/dev/null | tr -d ' ')
fi

proj_bytes=$cur_bytes
proj_lines=$cur_lines

case "$TOOL" in
  Write)
    proj_bytes=$(printf '%s' "$INPUT" | jq -r '(.tool_input.content // "") | utf8bytelength' 2>/dev/null)
    proj_lines=$(printf '%s' "$INPUT" | jq -r '(.tool_input.content // "") | (split("\n") | length)' 2>/dev/null)
    ;;
  Edit)
    old_b=$(printf '%s' "$INPUT" | jq -r '(.tool_input.old_string // "") | utf8bytelength' 2>/dev/null)
    new_b=$(printf '%s' "$INPUT" | jq -r '(.tool_input.new_string // "") | utf8bytelength' 2>/dev/null)
    old_nl=$(printf '%s' "$INPUT" | jq -r '((.tool_input.old_string // "") | (split("\n")|length-1))' 2>/dev/null)
    new_nl=$(printf '%s' "$INPUT" | jq -r '((.tool_input.new_string // "") | (split("\n")|length-1))' 2>/dev/null)
    proj_bytes=$(( cur_bytes - old_b + new_b ))
    proj_lines=$(( cur_lines - old_nl + new_nl ))
    ;;
  MultiEdit)
    delta_b=$(printf '%s' "$INPUT" | jq -r '[.tool_input.edits[]? | ((.new_string|utf8bytelength) - (.old_string|utf8bytelength))] | add // 0' 2>/dev/null)
    delta_nl=$(printf '%s' "$INPUT" | jq -r '[.tool_input.edits[]? | ((.new_string|split("\n")|length-1) - (.old_string|split("\n")|length-1))] | add // 0' 2>/dev/null)
    proj_bytes=$(( cur_bytes + delta_b ))
    proj_lines=$(( cur_lines + delta_nl ))
    ;;
  Bash)
    # Set above, and EXACT rather than projected: the staged blob already exists, so
    # these are the post-write byte/line counts, not an estimate.
    proj_bytes=${BASH_PROJ_BYTES:-$cur_bytes}
    proj_lines=${BASH_PROJ_LINES:-$cur_lines}
    ;;
  *) exit 0 ;;
esac

# Non-numeric guard (jq failure) — fail open (never block on parse error).
case "$proj_bytes$proj_lines" in *[!0-9-]*) exit 0 ;; esac

# ============ ARM 3 — always-loaded band per-file pin (WARN-ONLY) ============
# Ordered BEFORE ARM 2 only because it is the cheapest exit; the KINDs are disjoint
# by construction (a band path can never end in /MEMORY.md), so order is not a
# correctness property here and must not be relied on as one.
if [ "$KIND" = "band" ]; then
  [ -n "${SKIP_BAND_GROWTH_WARN:-}" ] && exit 0
  # CREATION is exempt: no file on disk means this is not growth of the band's
  # existing text, and a warn aimed at "you made a new rules file" is aimed at the
  # wrong act. Growth of that file is governed from its second write onward.
  [ -f "$FILE_PATH" ] || exit 0
  # GROWTH is a precondition — a shrink or a same-size rewrite is SILENT however far
  # above the pin it starts. This is what keeps the displacement edits the warn asks
  # for from being warned at, and it is the clause whose absence made ARM 1's band a
  # dead guard for 4.75 KB of growth.
  [ "$proj_bytes" -gt "$cur_bytes" ] || exit 0
  band_pin_v=$(band_pin "$BAND_KEY" "$cur_bytes")
  band_over_pin=0
  if [ "$proj_bytes" -gt "$band_pin_v" ]; then band_over_pin=1; fi

  # ── ARM 3b — PER-EDIT size against the band's own 150-400 B contract (2026-08-24) ──
  # ORDER IS DELIBERATE and it is the only ordering property in this block that matters: 3b runs
  # BEFORE the pin arm and EXITS, so a single write emits ONE warn, not two. When both would fire
  # the 3b message is strictly the more actionable of the pair (it names the entry size, the file's
  # own stated contract, and a destination), and it carries the pin fact inline rather than dropping
  # it. Two stderr blocks per write is how a guard gets filtered out.
  #
  # The quantity is the PER-EDIT delta, which this hook has always computed and only ever spent on
  # projecting the FILE against its pin. `proj_bytes - cur_bytes` is exact for Write/Edit/MultiEdit
  # (jq-derived above) and is why this arm costs ~5 lines rather than a new measurement path.
  band_grow_b=$(( proj_bytes - cur_bytes ))
  if [ -z "${SKIP_BAND_ENTRY_WARN:-}" ] && [ "$band_grow_b" -gt "$BAND_ENTRY_WARN_BYTES" ]; then
    band_entry_warn "$BAND_KEY" "$band_grow_b" "$proj_bytes" "$band_pin_v" "$band_over_pin" "$TOOL"
    exit 0
  fi

  [ "$band_over_pin" = "1" ] || exit 0
  band_warn "$BAND_KEY" "$band_pin_v" "$proj_bytes" "$TOOL" "$cur_bytes"
  exit 0
fi

# ==================== ARM 2 — skill MEMORY.md no-growth ratchet ====================
if [ "$KIND" = "skillmem" ]; then
  [ -n "${SKIP_MEMORY_RATCHET:-}" ] && exit 0

  # ⚖️ EXEMPTION — meta/MEMORY.md is out of scope for this ratchet (ruled in review).
  # This is NOT a bare suppression. The architectural reason: meta/MEMORY.md is
  # a COLD BODY STORE whose access pattern is KEYED RETRIEVAL (grep an L#), not
  # read-whole-at-invocation — so the read-ceiling this ratchet defends is not the
  # constraint that binds it. Its HOT tier already exists and is separately governed:
  # .claude/rules/active-recall.md (Band-U, ROW-capped).
  # Ratcheting the body store would block the fleet's L# lesson-persistence path
  # (measured 2026-08-01: 790 of 1,098 real skill-MEMORY writes land here) while
  # prescribing a tier-split its access pattern does not want.
  #   Governor lane for this file: /meta distill — NOT this hook.
  #   ⚠️ SCOPE OF THE CARVE-OUT: WRITE side only. The READ side is NOT exempt —
  #   warn-large-tracker-read.sh ARM B still denies an unbounded Read of this file,
  #   because a directed page strictly beats the hard error it returns today.
  # PINNED by a smoke SAFE arm ("meta EXEMPTION"): a refactor that drops this case
  # turns that assertion RED rather than silently re-arming the fleet-wide block.
  case "$FILE_PATH" in
    .claude/skills/meta/MEMORY.md|*/.claude/skills/meta/MEMORY.md) exit 0 ;;
  esac
  # GROWTH is a precondition of BOTH bands. A shrink is always allowed, however
  # far above the line it starts — that is the whole point of a ratchet, and it
  # is what keeps the distillation edits themselves from being blocked.
  [ "$proj_bytes" -gt "$cur_bytes" ] || exit 0

  skill="${FILE_PATH%/MEMORY.md}"; skill="${skill##*/}"
  RLOG_DIR="$ROOT/.claude/logs"; mkdir -p "$RLOG_DIR" 2>/dev/null || true
  RTS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  # Synthetic smoke fixtures route to a SEPARATE log, same rationale as ARM 1's
  # split: a log that is 99.9% self-test answers "is this guard earning its keep"
  # with the wrong number.
  RATCHET_LOG="memory-ratchet-block.log"
  if [ -n "${CLAUDE_HOOK_SMOKE:-}" ]; then RATCHET_LOG="memory-ratchet-block.smoke.log"; fi

  if [ "$proj_bytes" -gt "$RATCHET_BLOCK_BYTES" ]; then
    printf '%s BLOCKED %s %s cur=%s proj=%s\n' "$RTS" "$TOOL" "$FILE_PATH" "$cur_bytes" "$proj_bytes" >> "$RLOG_DIR/$RATCHET_LOG" 2>/dev/null || true
    command -v jq >/dev/null 2>&1 || exit 0   # cannot emit a deny envelope — fail open
    need=$(( proj_bytes - RATCHET_BLOCK_BYTES ))
    REASON="Skill-MEMORY ratchet BLOCK: this ${TOOL} would take ${FILE_PATH} from ${cur_bytes} B to ${proj_bytes} B, past the ${RATCHET_BLOCK_BYTES} B read-ceiling, and it GROWS the file.

Why this number: a skill MEMORY is read by its expert at consultation start, and the Read tool caps at 25,000 TOKENS per call (~58 KB at measured density) — about 4.3x below the 262,144 B byte ceiling. Past ${RATCHET_BLOCK_BYTES} B the read returns a well-formed PREFIX and discloses the truncation only in a trailing reminder, so the expert silently consults a fraction of its own memory. Measured: 87.3% of capped reads never paged.

DO NOT DISCARD THE MEMORY-UPDATE BLOCK. Make room in the SAME turn, then append:
  1. node scripts/memory-tier-split.mjs ${skill}
       (moves older entry BODIES to .claude/skills/${skill}/MEMORY-ARCHIVE.md,
        leaving dated digests + pointers in MEMORY.md — grep-retrievable, nothing lost)
  2. free at least ${need} B, then re-run this exact append.
Alternative if the entry is genuinely cold: append it to MEMORY-ARCHIVE.md directly.

A ratchet only forbids GROWTH — a shrink is allowed from any size, so the
distillation edit itself is never blocked. Escape: SKIP_MEMORY_RATCHET=1"
    jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
  fi

  if [ "$proj_bytes" -ge "$RATCHET_WARN_BYTES" ]; then
    printf '%s WARNED %s %s cur=%s proj=%s\n' "$RTS" "$TOOL" "$FILE_PATH" "$cur_bytes" "$proj_bytes" >> "$RLOG_DIR/$RATCHET_LOG" 2>/dev/null || true
    echo "" >&2
    echo "ℹ️  skill-MEMORY ratchet: $FILE_PATH would be ~$proj_bytes bytes (warn $RATCHET_WARN_BYTES; BLOCK past $RATCHET_BLOCK_BYTES — the 25k-token read cap, not the 256KB byte cap). Headroom shrinking: past the ceiling this expert reads only a PREFIX of its own memory and is not told. Distil now — node scripts/memory-tier-split.mjs ${skill}" >&2
    echo "" >&2
  fi
  exit 0
fi

# ========================= ARM 1 — project auto-loaded index =========================
if [ "$proj_bytes" -gt "$CAP_BYTES" ] || [ "$proj_lines" -gt "$CAP_LINES" ]; then
  LOG_DIR="$ROOT/.claude/logs"; mkdir -p "$LOG_DIR" 2>/dev/null || true
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  # Synthetic smoke-suite fixtures route to a SEPARATE log.
  # Before the split, the suite's two FIRE fixtures ("x"*30000 and "\n"*210) were 1565 of
  # 1567 entries — 780:1 noise burying the ONE genuine catch (2026-06-01, a 209-line Edit).
  # A 137 KB log that reads as a busy guard but is 99.9% self-test is worse than no log:
  # it answers "is this hook earning its keep" with the wrong number, which is exactly how
  # it was misread the day this split was written.
  BLOCK_LOG="memory-budget-block.log"
  if [ -n "${CLAUDE_HOOK_SMOKE:-}" ]; then BLOCK_LOG="memory-budget-block.smoke.log"; fi
  printf '%s BLOCKED %s %s bytes=%s lines=%s\n' "$TS" "$TOOL" "$FILE_PATH" "$proj_bytes" "$proj_lines" >> "$LOG_DIR/$BLOCK_LOG" 2>/dev/null || true
  # The candidates must reach the MODEL: on a JSON deny, permissionDecisionReason is the
  # ONLY model-visible channel — exit-0 stderr reaches the user transcript, never the model
  # (the wired-but-inert class). Capture and embed;
  # jq -Rs-style --arg handles JSON escaping of the multi-line candidate list.
  CANDS=$(emit_candidates "$FILE_PATH" 2>&1)
  REASON="MEMORY.md budget BLOCK: this edit would make the always-loaded project index ${proj_bytes} bytes / ${proj_lines} lines, past this gate's cap (24985 bytes / 200 lines — the harness itself cuts at ~24.4 KiB of CHARACTERS, bounded 24,964-25,300 and never pinned; we gate bytes at 24985 because bytes >= chars, which errs strict). Past its cliff the harness truncates the tail and ANNOUNCES that it did — a banner reading 'Only part of it was loaded'; what is SILENT is WHICH rows you lost (it was dropping the vendor reference_* pointers). \u26d4 DO NOT 'FIX THE UNIT': gating BYTES at the character number is DELIBERATE — bytes >= chars, so the gap between them IS the safety margin, never free headroom, and the answer to 'which unit' is settled: BYTES, at this number. Raising the cap re-arms a measured 2026-08-13 bug in which the gate read GREEN while the harness truncated. Make room FIRST: move topical project_*/feedback_* pointers to the cold MEMORY-INDEX.md (not auto-loaded), or prune. Keep only the Trigger Index + vendor reference_* pointers hot. Row length: ${POINTER_CONVENTION_CHARS} is ASPIRATIONAL — the byte cap above is the gate; COMPRESS wording in place, never move a clause out of a hot trigger row. NO per-event changelog (detail -> the topic file). Named candidates (disposition is PER ARM below — a move is sanctioned only where an arm says so; never auto-delete):
${CANDS}"
  jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
fi

# GROWTH-ONLY: warn only when this edit moves the file TOWARD the cap. An edit that
# prunes or holds steady must stay silent even above the band — otherwise the warning is
# permanently on and stops carrying information (see the header note).
if [ "$proj_bytes" -ge "$WARN_BYTES" ] && [ "$proj_bytes" -gt "$cur_bytes" ]; then
  echo "" >&2
  echo "ℹ️  MEMORY budget: $FILE_PATH would be ~$proj_bytes bytes (warn 18KB; gate 24985 B; harness cliff ~24.4 KiB of chars). Headroom shrinking — keep topical pointers in MEMORY-INDEX.md (cold), not here." >&2
  emit_candidates "$FILE_PATH"
  echo "" >&2
fi

exit 0
