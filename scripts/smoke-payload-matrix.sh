#!/usr/bin/env bash
# smoke-payload-matrix.sh — LAYER 2 of the smoke-suite mutation audit: FIXTURE INPUT-SPACE coverage.
#
# THE AXIS LAYER 1 CANNOT SEE. The mutation matrix (Layer 1) proves an assertion CAN fail (kill the
# hook → the suite reddens). It is BLIND to whether the FIXTURES exercise the input shapes where the
# hook actually DIES: a hook can be Layer-1-provably-live and STILL be bypassed by an input shape no
# fixture exercises — when every fixture shares one shape, a whole parsing layer is never reached, so
# mutation testing can say "alive" while the gate is open. This harness drives the 3 block-mode
# security hooks with an ADVERSARIAL, hand-labeled
# corpus + two soundness properties that need no oracle:
#
#   • DIFFERENTIAL parser-mode (INV-3): every `both`-mode cell is run jq-PRESENT and jq-ABSENT; the two
#     supported extraction paths MUST reach the SAME decision, so a divergence between them IS a
#     bypass on one of them. Needs no oracle — the two paths must agree.
#     (Cells marked `jq` run the jq path only — used where the jq-absent COARSE tripwire is intentionally
#     over-broad and would DENY an ALLOW-labelled friction case; every DENY-labelled BYPASS shape is `both`.)
#   • DECISION vs a HAND-LABELED oracle: for "should this be blocked?" the only sound oracle is a human
#     label (deriving it from the hook is self-grading — Layer 0's exact prohibition). The corpus below
#     is hand-labeled BLOCK/ALLOW.
#
# WHY NOT per-shape fixtures alone: that is whack-a-mole — a fixture set can simply lack the one
# shape that gets past a hook. The parser-mode differential catches an ENTIRE class
# (any extraction divergence), not one enumerated shape.
#
# THREAT MODEL (do not over-read the ✗s): these hooks are a deliberate SPEED-BUMP against the
# orchestrator's own reflex, with a sanctioned ALLOW_PUSH escape — NOT a sandbox against a hostile
# agent. A regex over command text cannot win an obfuscation arms race, and this harness does NOT
# demand it. It tests reflex-composition shapes + the two
# supported parser paths. FALSE-NEGATIVES (a silent push/rm) rank ABOVE false-positives (overridable
# friction) — a ✗ on a DENY-labeled cell is money/safety; a ✗ on an ALLOW-labeled cell is friction.
#
# Read-only w.r.t. the hooks (feeds stdin, never mutates) → NO worktree isolation needed (unlike
# Layer 1). ~40 hook spawns, ~2-3s. Runs at pre-push warn-mode; block-mode after an observation
# window. `--self-test` proves the harness DISCRIMINATES (the corpse fixture must FAIL; HEAD passes).
#
# Usage:  ./scripts/smoke-payload-matrix.sh [--verbose]      run the corpus, exit non-zero on any FAIL
#         ./scripts/smoke-payload-matrix.sh --self-test      prove the harness can fail (corpse vs HEAD)

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Hook paths — env-overridable so a fix can be developed + verified in a SCRATCH copy BEFORE it
# touches the live fleet-shared hook (FF_PUSH_HOOK=/tmp/fixed.sh ./scripts/smoke-payload-matrix.sh).
PUSH="${FF_PUSH_HOOK:-.claude/hooks/block-push-without-approval.sh}"
DANG="${FF_DANG_HOOK:-.claude/hooks/block-dangerous.sh}"
MEM="${FF_MEM_HOOK:-.claude/hooks/block-subagent-memory-write.sh}"
CORPSE=scripts/fixtures/hooks/corpse-block-push.sh

# ⛔ WRONG-ROOT REFUSAL — exit 3 (INSTRUMENT FAILURE), never 1 (which is this harness's PAYLOAD VERDICT).
# Sibling of the identical guard in `smoke-mutation-matrix.sh`; the two diverged when that one gained it
# and this one did not.
# The `cd` two lines above derives the repo root from this file's OWN location, so moved or copied out it
# lands somewhere with no hooks: every cell fails to spawn, FAIL climbs or CENSUS_FLOOR trips, and both of
# those paths exit non-zero, which `.githooks/pre-push` would otherwise render as a BYPASS claim about
# three block-mode hooks, out of an instrument that never ran.
#
# ⛔ **WHAT THIS GUARD IS ACTUALLY FOR — CORRECTED 2026-09-13, BECAUSE THE
# JUSTIFICATION SHIPPED HERE WAS FALSE ON THE PATH IT NAMED.** It said the wrong-root case reaches
# pre-push's rc branches. It does not: pre-push runs `--self-test` FIRST (`:525`), a copy out of
# `scripts/` makes that exit non-zero, and its own branch catches it and prints
# *"Layer 2 instrument SELF-TEST failed — the harness is broken; NOT trusting its verdict"*. And
# since this guard now sits ABOVE the `--self-test` block, `--self-test`
# returns 3 here too. **So on the pre-push path this refusal is DEFENSE IN DEPTH, not the thing that
# catches it.** ⚠️ Its live value is DIRECT invocation — a seat running this harness by hand from the
# wrong place — which is real but is not what the commit message claimed. The claim was load-bearing:
# a serious regression was taken on to buy a benefit that does not exist on the path described.
# **Keep the exit-3 contract; the reasoning is what was wrong.**
#
# ⛔ RESOLVE THE VARIABLES, NOT THE REPO LITERALS — **3 OF THE 4, AND THE FOURTH IS DELIBERATE.**
# `FF_PUSH_HOOK`/`FF_DANG_HOOK`/`FF_MEM_HOOK` exist so a hook fix can be verified in a SCRATCH copy before
# it touches the live fleet-shared file, and a guard keyed on their hardcoded paths would refuse that
# entirely healthy run. `CORPSE` is NOT overridable and should not be: it is the fixture this
# harness asserts against, not a hook under test — a push-hook variant that allows the regression payload,
# which this copy does not ship: put yours at that path (only `--self-test` reads it). *(The banner read "NEVER the repo literals" until
# 2026-09-13 and was 3 of 4.)*
#
# ⚠️ **TWO BOUNDS, NAMED RATHER THAN IMPLIED.** (a) This tests that the three hook paths (the corpse fixture is checked by `--self-test` alone) EXIST AND ARE
# READABLE at the resolved root — **not that the root is the repo you are pushing from**, so a stale FULL
# copy passes it entirely and this guard will not save you there. (b) `-f` alone was existence only: a
# **mode-000** hook passed it, then every cell failed to spawn → rc=1 → the BYPASS claim this guard exists
# to prevent, arriving through the guard. `-r` is now checked with it.
for _ff_req in "$PUSH" "$DANG" "$MEM"; do
  if [ ! -f "$_ff_req" ] || [ ! -r "$_ff_req" ]; then
    echo "smoke-payload-matrix: resolved root $(pwd -P) cannot use $_ff_req (missing or unreadable) — refusing." >&2
    # ⛔ DIAGNOSE THE RIGHT CAUSE. An FF_*_HOOK override that does not resolve is NOT a wrong root, and
    # saying "it must live in scripts/" there sends the operator to fix a path that was already correct
    # (a RELATIVE override was once refused with exactly that misdiagnosis).
    case "$_ff_req" in
      "${FF_PUSH_HOOK:-$$no-override$$}"|"${FF_DANG_HOOK:-$$no-override$$}"|"${FF_MEM_HOOK:-$$no-override$$}")
        echo "  That path came from an FF_*_HOOK override, so the repo root is NOT the problem." >&2
        echo "  A RELATIVE override resolves against this script's repo root, not your shell's cwd — pass it absolute." >&2
        echo "L2-CAUSE=BAD-OVERRIDE" >&2
        ;;
      *)
        echo "  This script derives the repo root from its OWN location, so it must live in scripts/." >&2
        echo "  Every payload cell would have failed to spawn, which pre-push renders as a hook BYPASS." >&2
        echo "L2-CAUSE=WRONG-ROOT" >&2
        ;;
    esac
    exit 3
  fi
done
unset _ff_req

VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

# ── jq-less bin for the parser-mode axis: symlink every tool the hooks need EXCEPT jq, so
#    `command -v jq` fails while grep/sed/tr/git all work (jq is /usr/bin/jq here — a system binary —
#    so a minimal PATH can't exclude it by directory; symlink-allowlist is the reliable way). ──
NOJQ_BIN="$(mktemp -d)"; mkdir -p "$NOJQ_BIN/bin"
for t in bash sh cat grep head sed tr env printf awk cut git realpath dirname basename mkdir date; do
  s="$(command -v "$t" 2>/dev/null)"; [ -n "$s" ] && ln -s "$s" "$NOJQ_BIN/bin/$t"
done
NOJQ="$NOJQ_BIN/bin"
cleanup() { rm -rf "$NOJQ_BIN"; }
trap cleanup EXIT INT TERM

PASS=0; FAIL=0
FAILS=()

hookfile() { case "$1" in push) printf '%s' "$PUSH";; dangerous) printf '%s' "$DANG";; memory) printf '%s' "$MEM";; corpse) printf '%s' "$CORPSE";; esac; }

# decide <hookfile> <PATH>  ; payload on stdin → prints DENY|ALLOW (DUAL channel: exit 2 OR the JSON
# permissionDecision:deny that block-subagent-memory-write emits with exit 0 — a single-channel read
# misjudges that hook).
decide() {
  local hook="$1" path="$2" out ec
  out="$(PATH="$path" bash "$hook" 2>&1)"; ec=$?
  if printf '%s' "$out" | grep -q '"permissionDecision": "deny"' || [ "$ec" = 2 ]; then printf 'DENY'; else printf 'ALLOW'; fi
}

# run_case <label> <hookkey> <expected DENY|ALLOW> <modes: jq|both>  ; payload on stdin
run_case() {
  local label="$1" key="$2" exp="$3" modes="$4" payload hook
  payload="$(cat)"; hook="$(hookfile "$key")"
  local dj; dj="$(printf '%s' "$payload" | decide "$hook" "$PATH")"
  local ok=1 extra=""
  [ "$dj" = "$exp" ] || ok=0
  if [ "$modes" = "both" ]; then
    local da; da="$(printf '%s' "$payload" | decide "$hook" "$NOJQ")"
    [ "$da" = "$exp" ] || ok=0
    extra=" jq-absent=$da"
    [ "$da" != "$dj" ] && extra="$extra ⚠PARSER-DIVERGENCE"
  fi
  if [ "$ok" = 1 ]; then
    PASS=$((PASS+1)); [ "$VERBOSE" = 1 ] && printf '  ✓ %-50s [%s exp=%s got=%s%s]\n' "$label" "$key" "$exp" "$dj" "$extra"
  else
    FAIL=$((FAIL+1)); FAILS+=("$label")
    printf '  ✗ %-50s [%s exp=%s got=%s%s]\n' "$label" "$key" "$exp" "$dj" "$extra"
  fi
}

# ══════════════════════ --self-test (the harness must be able to FAIL) ══════════════════════
# Two-fixture discrimination: the corpse fixture (a push-hook variant you supply) MUST fail the
# escaped-quote cell (it ALLOWs → the harness flags it); the block-push under test MUST pass it (it denies).
# A harness that always-passed would pass the corpse → this self-test reddens. Corpus-independent: it
# hard-codes one escaped-quote payload so it can't be silently weakened by a corpus edit.
if [ "${1:-}" = "--self-test" ]; then
  # The corpse is a fixture you supply (see the header); only this mode reads it, so only this mode
  # refuses without it, and it names the fixture rather than a wrong root.
  if [ ! -f "$CORPSE" ] || [ ! -r "$CORPSE" ]; then
    echo "smoke-payload-matrix: --self-test needs the fixture $CORPSE (missing or unreadable) — refusing." >&2
    echo "L2-CAUSE=MISSING-FIXTURE" >&2
    exit 3
  fi
  ok=1
  payload='{"tool_name":"Bash","tool_input":{"command":"git commit -m \"msg\" && git push origin main"}}'
  d_corpse="$(printf '%s' "$payload" | decide "$CORPSE" "$PATH")"
  d_head="$(printf '%s' "$payload" | decide "$PUSH" "$PATH")"
  if [ "$d_corpse" = "ALLOW" ]; then echo "PASS  corpse ALLOWs the payload → harness would flag it (discriminates)"; else echo "FAIL  corpse gave $d_corpse (expected ALLOW — the fixture's bypass is gone?)"; ok=0; fi
  if [ "$d_head" = "DENY" ];  then echo "PASS  HEAD block-push DENYs the payload (jq path)"; else echo "FAIL  HEAD block-push gave $d_head (expected DENY)"; ok=0; fi
  # And the harness must actually DERIVE a fail from that: a corpus of one DENY-labelled cell run
  # against the corpse must increment FAIL.
  PASS=0; FAIL=0
  run_case "self-test: regression cell vs corpse" corpse DENY jq <<'P' >/dev/null
{"tool_name":"Bash","tool_input":{"command":"git commit -m \"msg\" && git push origin main"}}
P
  if [ "$FAIL" -ge 1 ]; then echo "PASS  the corpus run FAILS on the corpse (harness is not a corpse itself)"; else echo "FAIL  corpus run did NOT fail on the corpse — harness is inert"; ok=0; fi
  [ "$ok" = 1 ] && { echo "payload-matrix self-test: ALL PASS"; exit 0; } || { echo "payload-matrix self-test: FAILURES"; exit 1; }
fi

echo "── LAYER 2: adversarial payload input-space (3 block-mode hooks) ──"
echo "   DENY-labelled ✗ = a bypass (silent push/rm/mem-write); ALLOW-labelled ✗ = friction (overridable)."
echo ""
echo "── block-push ──"
# PARSER-MODE differential — the extraction-divergence class: a parser path that stopped reading at
# an escaped quote would ALLOW where the other DENYs. 'both' asserts the two paths AGREE.
run_case "escaped-quote-before-verb (both parsers)" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"git commit -m \"msg\" && git push origin main"}}
P
run_case "canonical push (control, both parsers)" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}
P
# MORPHOLOGY — an interposed git flag defeats `git\s+push`.
run_case "git -C <path> push (morphology)" push DENY jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"git -C /tmp/repo push origin main"}}
P
run_case "git -c k=v push (morphology)" push DENY jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"git -c user.name=x push origin main"}}
P
# ESCAPE semantics.
run_case "ALLOW_PUSH=1 at command position → ALLOW" push ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"ALLOW_PUSH=1 git push origin main"}}
P
run_case "quoted ALLOW_PUSH mention must NOT approve" push DENY jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"echo \"ALLOW_PUSH=1 noted\" && git push origin main"}}
P
# FALSE-POSITIVE (bug B) — a verb inside a quoted string is a MENTION, not a command.
run_case "prose mention in echo → ALLOW (bug B)" push ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"echo \"remember to git push after review\""}}
P
run_case "verb inside -m message → ALLOW (bug B)" push ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"git commit -m \"ready, then git push to deploy\""}}
P
run_case "clean command → ALLOW (no false block)" push ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"git status && git log --oneline -5"}}
P
# Regression shapes for the block-push terminator/indent/wrapper handling (each must stay DENY).
# All `both` so the differential exercises the jq-absent path too (an earlier corpus ran several DENY
# cases jq-only).
run_case "trailing-separator push (verb;)" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"git push;"}}
P
run_case "subshell push ((verb))" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"(git push)"}}
P
run_case "quote-terminated eval wrapper" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"eval \"git push\""}}
P
run_case "bash -c quoted wrapper" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"bash -c \"git push\""}}
P
run_case "indented push (leading whitespace)" push DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"  git push"}}
P
run_case "verb not a subword (pushed → ALLOW)" push ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"echo pushed the code"}}
P

echo ""
echo "── block-dangerous ──"
run_case "escaped-quote-before-verb (both parsers)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"echo \"go\" && rm -rf /"}}
P
run_case "canonical rm -rf / (control, both parsers)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}
P
run_case "eval \"rm -rf /\" (trailing-quote anchor)" dangerous DENY jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"eval \"rm -rf /\""}}
P
# block-dangerous stays CONSERVATIVE (unlike block-push): it guards CATASTROPHIC ops, so a rare prose
# over-block is ACCEPTED rather than narrowing what it matches (a narrower match is a far worse trade for
# a catastrophe guard). So a prose mention is EXPECTED to DENY here (friction, overridable via re-word) —
# a deliberate posture, not a bug. (block-push can afford to be narrower because its target is the
# reflex form of the command.)
run_case "prose mention rm -rf / → DENY (conservative posture, not bug B)" dangerous DENY jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"echo \"never run rm -rf / on prod\""}}
P
run_case "legit cleanup rm -rf node_modules → ALLOW" dangerous ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf node_modules && npm ci"}}
P
# Catastrophic-coverage cells: the root-wipe in other flag spellings and quotings, device writes, and
# other wipe targets. `both` exercises the jq-absent tripwire too.
run_case "separated-flag root-wipe (rm -r -f /)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -r -f /"}}
P
run_case "long-flag root-wipe (--recursive --force)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm --recursive --force /"}}
P
run_case "quoted root (rm -rf \"/\")" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf \"/\""}}
P
run_case "device-adjacent mkfs" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"mkfs.ext4 /dev/sda"}}
P
run_case "dd to a disk device" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"dd if=/dev/zero of=/dev/sda"}}
P
run_case "home-dir wipe (rm -rf ~)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"}}
P
run_case "git-history destroy (rm -rf .git)" dangerous DENY both <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf .git"}}
P
run_case "real absolute subpath → ALLOW (no over-block)" dangerous ALLOW jq <<'P'
{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/build-cache"}}
P

echo ""
echo "── block-subagent-memory-write ──"
run_case "canonical MEMORY.md write → DENY (control)" memory DENY jq <<'P'
{"tool_name":"Edit","tool_input":{"file_path":".claude/skills/meta/MEMORY.md","old_string":"a","new_string":"b"}}
P
run_case "path traversal ../ → DENY" memory DENY jq <<'P'
{"tool_name":"Edit","tool_input":{"file_path":".claude/skills/x/../meta/MEMORY.md"}}
P
run_case "case-variant memory.md (case-insensitive FS) → DENY" memory DENY jq <<'P'
{"tool_name":"Edit","tool_input":{"file_path":".claude/skills/meta/memory.md"}}
P
run_case "non-MEMORY write → ALLOW (no false block)" memory ALLOW jq <<'P'
{"tool_name":"Edit","tool_input":{"file_path":"src/foo.ts","old_string":"a","new_string":"b"}}
P

echo ""
echo "════ RESULTS ════"
echo "  PASS: $PASS   FAIL: $FAIL"
# CENSUS: --self-test reads nothing from the corpus BODY, so gutting the corpus (deleting
# cells) would leave --self-test green. Assert a floor on the total cells RUN so a gutted corpus fails here.
# Bump the floor when adding cells; NEVER lower it without justification (lowering = accepting less coverage).
CENSUS_FLOOR=30
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" -lt "$CENSUS_FLOOR" ]; then
  echo "  ⚠ CORPUS CENSUS: only $TOTAL cells ran (< $CENSUS_FLOOR floor) — the corpus was gutted or a section failed to load."
  # ⛔ EXIT 3, NOT 1 — THIS IS AN INSTRUMENT EVENT AND THE LINE ABOVE SAYS SO IN ITS OWN WORDS.
  # "the corpus was gutted or a section failed to load" is a statement about the HARNESS, never about
  # the hooks; `1` is this harness's PAYLOAD VERDICT and pre-push renders it as
  # "a DENY-labelled ✗ is a BYPASS (silent push/rm/mem-write)" — a security claim about three
  # block-mode hooks, from a run that never assembled its corpus. An earlier
  # diagnosis had named both `exit 1` paths ("FAIL climbs OR CENSUS_FLOOR trips") and then fixed the
  # wrong-root precondition for both while leaving THIS one emitting the verdict code.
  echo "L2-CAUSE=CORPUS-GUTTED" >&2
  exit 3
fi
if [ "$FAIL" -gt 0 ]; then
  echo "  (DENY-labelled failures are BYPASSES; ALLOW-labelled are friction. See threat-model note in the header.)"
  exit 1
fi
