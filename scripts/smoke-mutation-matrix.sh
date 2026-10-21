#!/usr/bin/env bash
# smoke-mutation-matrix.sh — LAYER 1 of the smoke-suite mutation audit.
#
# THE QUESTION: 388 assertions, all green. WHICH OF THEM CAN ACTUALLY FAIL?
#
# The hook-liveness pre-pass answered this at HOOK granularity (32 live / 5 dead) by reading only
# the FAIL *count*. That threw away the interesting half. Running the suite with --verbose emits a
# label for EVERY assertion, so the SAME 37 mutations yield PER-ASSERTION liveness for free — no
# 388-run explosion was ever necessary.
#
# ── ATTRIBUTION IS DERIVED, NEVER GUESSED (the v1 bug — read this before "improving" it) ──
# v1 mapped an assertion to a hook by SECTION NAME (`=== <hook>.sh ===` → that hook). That is an
# ASSUMPTION, and it is FALSE. A section header is a THEME, not an owner. Measured: the
# `=== bash-safety-warn.sh (lesson-derived patterns) ===` section contains five assertions that drive
# **block-dangerous.sh** (the zsh word-split guard was PROMOTED warn→block on 2026-06-29 and moved
# hooks; the tests stayed in the old section). v1 killed bash-safety-warn, those five stayed green,
# and it reported them INERT. They are not inert — they are guarding a different hook.
# It took a hand-check to catch, because the wrong answer LOOKED like a finding.
#
# So: an assertion BELONGS to whichever hook's death actually turns it RED. We record every failing
# label under every mutation and derive ownership from the data. No name-matching anywhere.
#
# TWO AXES, because a hook can be DEAD or merely WRONG, and those are different failures:
#   KILL    : hook becomes `exit 0`, silent.       Catches assertions that need it to FIRE.
#   GARBAGE : hook echoes a wrong token, exit 0.   Catches assertions that need it to be CORRECT
#             (or to stay SILENT — a SAFE assertion that reddens here is genuinely guarding against
#             spurious output, which is a real guard).
#
# VERDICTS:
#   red under KILL and GARBAGE  → STRONG          (detects both absence and wrongness)
#   red under KILL only         → absence-only    (notices a dead hook; would NOT notice a wrong one)
#   red under GARBAGE only      → wrongness-only  (notices bad output; would NOT notice a dead one)
#   red under NEITHER, any hook → *** INERT ***   (no hook's death or corruption can fail it)
#
# ⚠️ READ THE INERT LIST HONESTLY — it has TWO populations, and only one is a bug:
#   (a) HOOK-GUARDING and inert → a real finding. The suite claims to guard a hook and does not.
#   (b) NOT guarding a hook at all → settings.json wiring, active-recall row counts, .githooks
#       markers, the coverage gate, file-existence checks. These CANNOT redden under a hook
#       mutation because they do not test a hook. They are out of scope for THIS axis — mutating
#       their real SUT (the config value, the count) is a separate pass. The script separates them
#       by asking whether the assertion's block actually invokes a hook; do not report (b) as a bug.
#
# ⚠️ SAFETY — see the ISOLATION block below (it is the load-bearing one).
#   A trap CANNOT be the restore guarantee. Bash defers a trapped signal until the current foreground
#   command finishes; this script sits inside a command-substitution running the whole suite, so a
#   SIGTERM gets queued, the grace period expires, and SIGKILL lands — the trap never runs, so a
#   killed run cannot rely on it to restore a hook. **Isolation is what makes that harmless**: a
#   crash orphans a temp worktree, never a live safety hook.
#   REMAINING RUN RULE: run it in the BACKGROUND — a foreground tool call has a 10-min cap, and that
#   cap is a SIGTERM. (With isolation the blast radius is a stale worktree, not a disabled guard, but
#   a killed run still wastes the audit.)
#   `.claude/hooks/hooks-integrity-check.sh` (SessionStart) remains the out-of-process net underneath.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# ⛔ ASSERT THE RESOLVED ROOT BEFORE ANY ARM RUNS — A COPY OF THIS SCRIPT RESOLVES ITS ROOT ONE LEVEL
# FROM WHEREVER IT SITS, AND A WRONG ROOT CANNOT BE TOLD FROM A KILL. The line above derives the repo
# from this file's own location, which is correct in `scripts/` and wrong everywhere else; moved or
# copied out, it lands somewhere with no suite, every arm dies at rc=127, and rc=127 is
# byte-indistinguishable from the RED a mutation matrix exists to hunt — the EIGHTH vacuous-control
# way (`bash-environment.md`), where a control whose expected reading is FAILURE is impersonated by
# every other cause of failure. Measured 2026-09-13 on a hand-extracted block of the hook suite: all
# three arms read RED before a single mutant had been applied, and the tell was rc=127 rather than a
# wrong value. Care did not catch it — the seat was building a matrix specifically to avoid vacuous
# arms — the LOCATION did.
if [ ! -f scripts/smoke-test-hooks.sh ]; then
  echo "smoke-mutation-matrix: resolved root $(pwd -P) has no scripts/smoke-test-hooks.sh — refusing." >&2
  echo "  This script derives the repo root from its OWN location, so it must live in scripts/." >&2
  echo "  Every arm would have died at rc=127, which reads exactly like the RED this matrix hunts." >&2
  # ⛔ EXIT 3, NOT 2 — this file reserves 3 for INFRA and every other INFRA site obeys it, each emitting
  # an `L3-CAUSE=` token (grep it; the line list that stood here had drifted 9 lines by 2026-10-05), and
  # the comment above `kk_is_integer` states the contract.
  # This refusal shipped as `exit 2` with no token, and
  # `scripts/lib/prepush-l3-verdict.sh` branches on 0 at :17, 3 at :19 and **else** at :54 — so a 2
  # fell through to else and the operator was told "a changed hook is UNGUARDED (killing it fails
  # NOTHING)" when the instrument had never run. That is a hook VERDICT manufactured out of an
  # instrument failure: the exact class this guard was added to remove, reintroduced by its exit code.
  # (2 is also already taken in this file, for `unknown flag`.)
  echo "L3-CAUSE=WRONG-ROOT" >&2
  exit 3
fi

# ══════════════════════ SHARED LIVENESS PRIMITIVE (used by --gate AND --self-test-gate) ═══════════════
# The RECURSIVE CORPSE: --self-test-gate used to test a REIMPLEMENTATION of the
# set-difference (gate_probe), never the shipped --gate wiring — it proved the MATH, not the deployed
# code. These two functions ARE the shipped path; both the real gate and its self-test drive them, so
# the self-test now exercises the code that actually runs.
suite_labels() { bash "$1" --verbose 2>/dev/null | grep '^  ✓ ' | sed 's/^  ✓ //' | sort; }
# Names each baseline-✓ label absent from a later run, on stderr — both unstable-suite refusals call it, and
# --self-test-gate drives it (a label that embeds a run-varying value reads there exactly like a flaky test).
name_dropped() { comm -23 "$1" "$2" | sed 's/^/      dropped: /' >&2; }
count_vanished() {  # $1=base_file(sorted ✓) $2=suite_path $3=hook_dir $4=hook_name $5=K(default 1)
                    # Echoes how many baseline-✓ labels vanish when the hook is killed (exit 0), restoring
                    # it after. With K>1: kill ONCE, sample the suite K times, credit ONLY a label
                    # that vanishes in EVERY kill run (union-of-present rule) — a flake that reappears in any
                    # run is NOT credited, so a KILL-correlated flake can no longer false-certify liveness.
                    # ADAPTIVE: the credit is monotone-decreasing in K, so a run-1 credit of 0 is final (a
                    # dead hook can never GAIN a vanish) — the K-1 confirm runs are paid ONLY on a LIVE
                    # candidate. K=1 is byte-equivalent to the original single-run behaviour.
  local base="$1" suite="$2" hdir="$3" hook="$4" K="${5:-1}" bak un i first_vanish n
  bak="$(mktemp)"; cp "$hdir/$hook" "$bak"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$hdir/$hook"; chmod +x "$hdir/$hook"
  un="$(mktemp)"; suite_labels "$suite" > "$un"          # kill run 1
  first_vanish="$(comm -23 "$base" "$un")"
  if [ -n "$first_vanish" ]; then                        # ≥1 vanished → confirm it survives ALL K runs
    i=2; while [ "$i" -le "$K" ]; do suite_labels "$suite" >> "$un"; i=$((i+1)); done
    sort -u "$un" -o "$un"                               # un = union of every kill run's ✓ labels
  fi
  cp "$bak" "$hdir/$hook"; chmod +x "$hdir/$hook"        # restore BEFORE any further work
  n="$(comm -23 "$base" "$un" | grep -c . || true)"      # labels absent from the union = vanished in ALL K
  # Diagnostic: run 1 saw a vanish that did NOT survive every kill run → kill-correlated flake candidate.
  # stderr only — stdout stays the bare count that probe()/the gate consume.
  if [ "$n" = "0" ] && [ -n "$first_vanish" ]; then
    printf '  ⚠ intermittent vanish under kill of %s (kill-correlated flake candidate — NOT credited): %s\n' \
      "$hook" "$(printf '%s' "$first_vanish" | tr '\n' ';')" >&2
  fi
  printf '%s\n' "$n"
  rm -f "$bak" "$un"
}

# FF_GATE_KILL_RUNS normalization: the gate's `${FF_GATE_KILL_RUNS:-2}` default + the
# `K="${5:-1}"` guard in count_vanished catch ONLY unset/empty. A non-empty MALFORMED value (`2x`, a trailing
# space) or an explicit `0`/`1` passes straight through → count_vanished's confirm loop `[ "$i" -le "$K" ]`
# errors or is false → a SINGLE kill run = the EXACT single-run false-LIVE, with a green gate and no signal.
# Operators are TOLD to set this var (K=5 for the 5 security controls — block-dangerous /
# block-push / block-subagent-memory-write / validate-no-secrets / scan-secrets-writes — at block-mode
# promotion), so a typo must NEVER silently revert the fix. Normalize to an integer ≥2, warning LOUDLY on any
# coercion (loud > silent-clamp — the point is to make a degradation visible, not paper over it).
norm_kruns() {  # $1 = raw value → echoes a valid integer ≥2 (warns to stderr on coercion)
  local raw="$1"
  case "$raw" in
    ''|*[!0-9]*) [ -n "$raw" ] && echo "   ⚠ FF_GATE_KILL_RUNS='$raw' is not a non-negative integer — using K=2." >&2; echo 2; return ;;
  esac
  if [ "$raw" -lt 2 ]; then
    echo "   ⚠ FF_GATE_KILL_RUNS=$raw < 2 disables repetition (single kill run = the pre-fix false-LIVE) — using K=2." >&2
    echo 2
  else
    echo "$raw"
  fi
}

# count_vanished can return EMPTY/non-integer under a TRANSIENT
# measurement failure (worktree-add race / killed subproc / index-lock on the shared tree). A bare
# `[ "$kk" -ge 1 ]` on such a value ERRORS → evaluates false → a FALSE "UNGUARDED" verdict → in block-mode
# a scanner's transient race becomes a FALSE-BLOCK (the SKIP-reflex the whole design avoids). So classify a
# non-integer count as INFRA (exit 3 — pre-push WARNs on it, except BASELINE-RED on a scanner push, which
# blocks; every exit-3 site names its cause with an `L3-CAUSE=` line), never as a hook verdict. Same
# class as the norm_kruns fold — applied to the count OUTPUT, not the K INPUT.
kk_is_integer() {  # $1 = count → rc 0 (is a non-negative integer) | rc 1 (empty/non-integer → INFRA)
  case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

# ═══════════════════════ --self-test-gate (LAYER 3 gate — the guard for the guard) ═══════════════════════
# The pre-push Layer-3 gate (--gate below) trusts ONE predicate: "does killing hook H vanish ≥1 of the
# suite's baseline-✓ labels?" A predicate that always answered GUARDED would pass every push while
# proving nothing — a corpse one level up, exactly the disease this whole audit exists to cure. So the
# gate must be able to FAIL on its own fixtures, and this mode proves it does.
#
# TWO fixtures force discrimination (one alone is corpse-satisfiable):
#   · GUARDED   suite — asserts a FIRE token from the hook's output. Killing the hook (→ silent) drops
#                       the ✓. The predicate MUST say GUARDED.
#   · UNGUARDED suite — asserts only that the hook file exists. A dead (exit 0, silent) hook passes it.
#                       Killing the hook drops NOTHING. The predicate MUST say UNGUARDED.
#
# NOTE — divergence from the panel's literal recipe (documented: verify the recipe vs reality).
# The panel named an old revision of scripts/smoke-test-hooks.sh (a real historical death-blind
# section of the suite) as the UNGUARDED fixture. That old suite is NOT baseline-green against the
# CURRENT tree (18+ hooks have changed since), and the matrix REFUSES a non-green baseline (below) —
# so the literal recipe would abort. The thing that actually regresses is the set-difference PREDICATE,
# and this minimal self-contained pair tests THAT faithfully, in <1s, with no worktree and no real-suite
# baseline dependency. It also exercises the suite-side DELETION shape (the UNGUARDED fixture is a section
# stripped to existence-only — the exact corpse). The real historical corpse's regression is still
# covered: the periodic full matrix mutates the hook that old section failed to guard and records that
# killing it reddens ≥1.
if [ "${1:-}" = "--self-test-gate" ]; then
  T="$(mktemp -d)"; mkdir -p "$T/hooks"
  demo_alive() { printf '#!/usr/bin/env bash\necho "FIRE-TOKEN"\n' > "$T/hooks/demo.sh"; chmod +x "$T/hooks/demo.sh"; }
  # (the KILL is now done by count_vanished, the shipped primitive — no separate demo_dead needed)
  # GUARDED: the ✓ is earned by the hook's ACTUAL output (a dead hook fails the grep).
  cat > "$T/suite_guarded.sh" <<'GSU'
#!/usr/bin/env bash
out="$(bash "$FIXDIR/hooks/demo.sh" 2>/dev/null)"
[ "$out" = "FIRE-TOKEN" ] && echo "  ✓ FIRE: demo emits the token"
echo "  ✓ demo.sh exists"
GSU
  # UNGUARDED: existence only — the death-blind shape. A corpse passes it.
  cat > "$T/suite_unguarded.sh" <<'USU'
#!/usr/bin/env bash
[ -x "$FIXDIR/hooks/demo.sh" ] && echo "  ✓ demo.sh exists + executable"
USU
  # FLAKY: existence-only (the dead shape) PLUS one label that vanishes on the FIRST kill run
  # ONLY, via a run-counter kept OUTSIDE the hook file (the hook is what gets killed). Under the single-run
  # rule the intermittent vanish is credited → false GUARDED; under the K-run union rule the label reappears
  # on a later run → NOT credited → UNGUARDED (correct). Deterministic (counter, not timing) so the self-test
  # never flakes on itself. Its recorded mutation is K→1 (the fourth check below re-admits the flake at K=1,
  # proving this fixture actually discriminates rather than passing vacuously).
  cat > "$T/suite_flaky.sh" <<'FSU'
#!/usr/bin/env bash
n=$(cat "$FIXDIR/runcount" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$FIXDIR/runcount"
[ -x "$FIXDIR/hooks/demo.sh" ] && echo "  ✓ demo.sh exists + executable"
[ "$n" -ne 2 ] && echo "  ✓ FLAKE: intermittent (vanishes only on run 2 — the first kill run)"
FSU
  chmod +x "$T"/suite_*.sh
  export FIXDIR="$T"   # the fixture suites resolve the demo hook through $FIXDIR
  demo_alive
  probe() {  # $1 = fixture suite, $2 = K (default 1) → GUARDED|UNGUARDED, via the SHIPPED count_vanished
    demo_alive
    local base; base="$(mktemp)"; suite_labels "$1" > "$base"
    local v; v="$(count_vanished "$base" "$1" "$T/hooks" "demo.sh" "${2:-1}")"   # restores demo after
    rm -f "$base"
    [ "$v" -ge 1 ] && echo "GUARDED" || echo "UNGUARDED"
  }
  g="$(probe "$T/suite_guarded.sh")"
  u="$(probe "$T/suite_unguarded.sh")"
  rm -f "$T/runcount"; f="$(probe "$T/suite_flaky.sh" 3)"    # K=3: the intermittent vanish must NOT credit
  rm -f "$T/runcount"; f1="$(probe "$T/suite_flaky.sh" 1)"   # K=1: the degenerate rule re-admits the flake
  printf 'a\nb\n' > "$T/nd_base"; printf 'b\nc\n' > "$T/nd_run"   # a dropped, c new: only a may be named
  nd="$(name_dropped "$T/nd_base" "$T/nd_run" 2>&1 >/dev/null)"
  rm -rf "$T"
  ok=1
  if [ "$g" = "GUARDED" ];   then echo "PASS  guarded fixture → GUARDED";   else echo "FAIL  guarded fixture → $g (expected GUARDED)"; ok=0; fi
  if [ "$u" = "UNGUARDED" ]; then echo "PASS  unguarded fixture → UNGUARDED (the corpse the gate must reject)"; else echo "FAIL  unguarded fixture → $u (expected UNGUARDED)"; ok=0; fi
  if [ "$f" = "UNGUARDED" ]; then echo "PASS  flaky fixture (K=3) → UNGUARDED (an intermittent vanish must not certify liveness)"; else echo "FAIL  flaky fixture (K=3) → $f (expected UNGUARDED — the K-run union rule regressed)"; ok=0; fi
  if [ "$nd" = "      dropped: a" ]; then echo "PASS  name_dropped names exactly the base-only label, on stderr"; else echo "FAIL  name_dropped printed '$nd' (expected '      dropped: a' on stderr)"; ok=0; fi
  if [ "$f1" = "GUARDED" ];  then echo "PASS  flaky fixture (K=1) → GUARDED (the single-run rule re-admits the flake — proves the fixture discriminates)"; else echo "FAIL  flaky fixture (K=1) → $f1 (expected GUARDED — the mutation-proof is inert; the fixture pins nothing)"; ok=0; fi
  # FF_GATE_KILL_RUNS normalization: a malformed (2x/abc/space) or degenerate (0/1) value must NOT
  # pass through to a silent single kill run — it must coerce to K=2. Valid ≥2 is preserved verbatim.
  kn_ok=1
  for pair in "2x=2" "0=2" "1=2" "abc=2" " =2" "3=3" "5=5"; do
    raw="${pair%=*}"; exp="${pair#*=}"
    got="$(norm_kruns "$raw" 2>/dev/null)"
    [ "$got" = "$exp" ] || { echo "FAIL  norm_kruns('$raw') → '$got' (expected '$exp')"; kn_ok=0; ok=0; }
  done
  [ "$kn_ok" = "1" ] && echo "PASS  FF_GATE_KILL_RUNS normalization (malformed/degenerate → K=2; valid ≥2 preserved)"
  # The kk-integer guard. A transient non-integer count must classify INFRA, never
  # fall through `[ "$kk" -ge 1 ]` to a FALSE UNGUARDED (→ block-mode false-block). Mutation-valid: break
  # kk_is_integer and this reddens.
  kg_ok=1
  { kk_is_integer "3" && kk_is_integer "0"; } || { echo "FAIL  kk_is_integer rejected a valid count (3 or 0)"; kg_ok=0; ok=0; }
  for bad in "" "2x" " " "-1" "1.5"; do
    if kk_is_integer "$bad"; then echo "FAIL  kk_is_integer accepted '$bad' (would false-UNGUARD → block-mode false-block)"; kg_ok=0; ok=0; fi
  done
  [ "$kg_ok" = "1" ] && echo "PASS  kk-integer guard (non-integer count → INFRA, never a false UNGUARDED verdict)"
  if [ "$ok" = "1" ]; then echo "gate self-test: ALL PASS"; exit 0; else echo "gate self-test: FAILURES"; exit 1; fi
fi

# ═══════════════════════ ISOLATION — NON-NEGOTIABLE ═══════════════════════
# THE HARNESS MUST NEVER MUTATE THE LIVE SHARED TREE. Read this before "simplifying" it.
#
# `.claude/hooks/` is SHARED. Every session in the fleet loads hooks from that one directory. So a
# harness that mutates a hook in place is not running a private experiment — it is a FLEET-WIDE
# OUTAGE of that hook, for every concurrent session, for as long as the mutation is on disk.
# The outage is SILENT, which is what makes it expensive: a session whose guard hook is a mutant
# gets no error, only a guard that no longer guards, and nothing inside that session can tell the
# mutant from the real hook. Every hook in the directory is in reach of the mutation walk, and a
# run killed mid-mutation leaves its mutant on disk for every session that loads hooks after it.
# A safety hook could be down at the very moment a sensitive operation is being approved in
# another session — a collision no one inside either session could see. That is why the harness
# never mutates the live directory: every concurrent session shares it, so an in-place run is a
# fleet-wide outage however short, and the run belongs in a throwaway worktree instead.
#
# The out-of-process detector (`.claude/hooks/hooks-integrity-check.sh`) catches the CORPSE. It does
# nothing about the WINDOW. **Isolation is the actual fix; the detector is the net under it.**
#
# So: re-exec inside a throwaway `git worktree` at HEAD, with its OWN `.claude/hooks/`. Mutations are
# invisible to the fleet, and a SIGKILL cannot reach a live hook — the worst case is an orphaned
# temp worktree, which `git worktree prune` reaps and which harms nobody.
#
# CLAUDE_PROJECT_DIR is re-pointed at the worktree too: hooks resolve their repo through it, so
# leaving it aimed at the live tree would let a hook under test read/write live files.
if [ "${FF_MUTATION_ISOLATED:-0}" != "1" ]; then
  REPO="$(git rev-parse --show-toplevel)"

  # The worktree runs HEAD's copy of this script — so uncommitted edits to it would be SILENTLY
  # IGNORED, and you would audit a version you are not looking at. Refuse rather than mislead.
  # `diff HEAD` (not bare `diff`) so a STAGED-but-uncommitted edit is also caught — the worktree checks
  # out HEAD, so a staged edit would equally be a version you cannot see. Exit 3 (not
  # 1) so a caller distinguishes this INFRA refusal from a real UNGUARDED verdict (the exit-code split).
  if ! git -C "$REPO" diff HEAD --quiet -- scripts/smoke-mutation-matrix.sh scripts/smoke-test-hooks.sh; then
    echo "⛔ scripts/smoke-mutation-matrix.sh or smoke-test-hooks.sh has UNCOMMITTED/STAGED changes." >&2
    echo "   The isolated worktree checks out HEAD, so your edits would NOT be the code under test." >&2
    echo "   Commit them first. (This refusal exists because auditing a version you cannot see is" >&2
    echo "    the exact class of bug this harness was built to find.)" >&2
    echo "L3-CAUSE=DIRTY-TREE" >&2
    exit 3
  fi

  # CANONICAL temp root (2026-08-26): `mktemp -d` on macOS returns the SYMLINKED spelling (/var/folders/... ->
  # /private/var/...), and 20 suite arms that test path IDENTITY (the always-loaded-write denies, the band
  # arms) go dark under a symlinked worktree — so the baseline read 20-25 failures and this gate REFUSED on
  # every run, at every HEAD, for as long as that line stood (measured 2026-08-26: symlinked 20 red, the
  # identical env under `pwd -P` 0 red; the same 25 at an earlier commit and at HEAD). `pwd -P` resolves it.
  TMPD="$(cd "$(mktemp -d)" && pwd -P)"; WT="$TMPD/wt"
  # ⛔ SOLE ASSIGNMENT of TMPD and WT, by design: CLAUDE_PROJECT_DIR and the hooks dir are derived from
  # WT below, so the canonical spelling propagates BY CONSTRUCTION only while nothing re-assigns
  # either — a retry / reuse / env-override path would silently re-open the symlink trap and only
  # the arms would show it.
  cleanup_wt() {
    git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
    rm -rf "$TMPD"
    git -C "$REPO" worktree prune >/dev/null 2>&1
  }
  trap cleanup_wt EXIT INT TERM

  # The isolation proof below compares the live hooks BEFORE and AFTER this run, never against a clean
  # tree: another session's uncommitted hook edit is routine here (see the lib's header). A lib that
  # fails to load must not leave two empty fingerprints that compare equal, so it refuses instead.
  ISO_BASE="$(git -C "$REPO" rev-parse HEAD)"
  # The lib is sourced INSIDE each read, never into this process: a lib that dies while loading (a name
  # unbound under set -u, a stray exit) would otherwise end this gate with ITS status and no cause token,
  # which pre-push reads as a hook verdict (measured: rc=1 -> "UNGUARDED", exit 0 -> "LIVE").
  # shellcheck source=lib/hooks-dirt-fingerprint.sh
  ISO_PRE="$(source "$REPO/scripts/lib/hooks-dirt-fingerprint.sh" 2>/dev/null && hooks_fingerprint "$REPO" "$ISO_BASE" 2>/dev/null)"
  if [ -z "$ISO_PRE" ]; then
    echo "⛔ could not fingerprint the live .claude/hooks/ (scripts/lib/hooks-dirt-fingerprint.sh missing or failing)." >&2
    echo "L3-CAUSE=ISOLATION-PRECHECK" >&2; exit 3
  fi
  ISO_PRE_DIRT="$(git -C "$REPO" status --porcelain .claude/hooks/)"
  # Per-file sums, for DISPLAY only: on a mismatch they name the paths that changed DURING the run, which the
  # two porcelain lists cannot do when a peer's already-dirty file changed again (both lists read " M x").
  iso_sums() { (cd "$REPO" && find .claude/hooks -type f -exec cksum {} + 2>/dev/null | sort -k3); }
  ISO_PRE_SUMS="$(iso_sums)"

  echo "── ISOLATING: git worktree at HEAD (the live tree is never touched) ──"
  git -C "$REPO" worktree add --detach -q "$WT" "$ISO_BASE" || { echo "⛔ worktree add failed" >&2; echo "L3-CAUSE=WORKTREE-FAIL" >&2; exit 3; }
  # node_modules is untracked; symlink it (read-only use) so the suite behaves identically.
  [ -d "$REPO/node_modules" ] && ln -s "$REPO/node_modules" "$WT/node_modules"
  echo "   worktree: $WT"

  FF_MUTATION_ISOLATED=1 CLAUDE_PROJECT_DIR="$WT" bash "$WT/scripts/smoke-mutation-matrix.sh" "$@"
  rc=$?

  # HARD PROOF, not a promise: the live tree's hooks must be byte-identical to how this run found them.
  # A changed fingerprint is this run's write OR a peer editing a hook mid-run; it cannot tell which, so
  # it reports the failure either way (the conservative reading).
  echo ""
  ISO_POST="$(source "$REPO/scripts/lib/hooks-dirt-fingerprint.sh" 2>/dev/null && hooks_fingerprint "$REPO" "$ISO_BASE" 2>/dev/null)"
  if [ -z "$ISO_POST" ] || [ "$ISO_POST" != "$ISO_PRE" ]; then
    echo "🚨 ISOLATION FAILED — the LIVE tree's hooks changed during this run. This must NEVER happen:" >&2
    echo "   before the run: ${ISO_PRE_DIRT:-(clean)}" >&2
    echo "   after the run:" >&2
    git -C "$REPO" status --porcelain .claude/hooks/ >&2
    { echo "   changed DURING the run:"; diff <(printf '%s\n' "$ISO_PRE_SUMS") <(iso_sums) | sed -n 's/^[<>] [0-9]* [0-9]* /     /p' | sort -u; } >&2
    echo "   Diff it BEFORE any restore (git diff -- .claude/hooks/): on this shared tree the dirt is usually a" >&2
    echo "   PEER's live edit (measured 2026-08-26), and a blind 'git checkout' destroys it. Restore only lines this run wrote." >&2
    # A CLEAN inner run must not read as a clean pass: pre-push captures this whole
    # run into a log it opens only on rc==3 / rc==other, so on rc==0 this banner went to a file nobody
    # reads and the gate printed a green tick over it. A clean inner rc becomes INFRA with its own cause
    # (the 7th token); a NON-zero inner rc already carries its verdict or cause and passes through — so a
    # process still emits at most ONE token (the first-wins reading in prepush-l3-verdict.sh relies on it).
    if [ "$rc" = "0" ]; then echo "L3-CAUSE=ISOLATION-FAIL" >&2; exit 3; fi
  elif [ -n "$ISO_PRE_DIRT" ]; then
    echo "✅ ISOLATION VERIFIED — live .claude/hooks/ byte-identical before and after this run ($(printf '%s\n' "$ISO_PRE_DIRT" | grep -c .) path(s) were already uncommitted before it started; not this run's)."
  else
    echo "✅ ISOLATION VERIFIED — live .claude/hooks/ untouched (0 dirty). The fleet never saw this run."
  fi
  exit $rc
fi
# ══════════════════════ end isolation (we are INSIDE the worktree from here) ══════════════════════
# Everything below mutates .claude/hooks/ under this cwd, so the isolation is asserted HERE, at write time: the
# before/after fingerprint above sees only the END state (a write restored before the end is invisible to it),
# and an inherited FF_MUTATION_ISOLATED=1 skips that block entirely. Only a LINKED worktree may be mutated.
if [ "$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" = "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ]; then
  echo "⛔ refusing to mutate hooks in $(pwd -P): not a linked worktree (FF_MUTATION_ISOLATED=1 set outside the re-exec?)" >&2
  echo "L3-CAUSE=NOT-ISOLATED" >&2; exit 3
fi

SUITE="./scripts/smoke-test-hooks.sh"

# ── arg parse (LAYER 3) — restrict the mutation loop to named hooks ──────────────────────────
#   --only h1.sh,h2.sh : mutate ONLY these hooks (partial audit; full report; exit = suite rc)
#   --gate h1.sh,h2.sh : implies --only; KILL-only (no GARBAGE — halves cost); prints a per-hook
#                        LIVE/UNGUARDED verdict; exits NON-ZERO if any named hook loses 0 assertions
#                        under KILL (the pre-push liveness gate condition). The caller decides warn
#                        vs block by whether it honors the exit code.
#   --record <abs dir> : with --gate only. After the post-run control passes, SAVE each named hook's verdict to
#                        <dir>/<hook>.rec, keyed by fingerprints of the hook, the suite, this file and
#                        .claude/hooks/lib (scripts/lib/hook-liveness-record.sh). .githooks/pre-push's >5-hooks
#                        branch reads them. A run ending in any exit-3 refusal writes
#                        nothing. Absolute path required: the run re-executes inside a temp worktree.
#   <path>             : output TSV (default below). Positional, order-independent with the flags.
ONLY=""
GATE=0
RECORD_DIR=""
# PER-PROCESS scratch, never a fixed /tmp path — measured 2026-08-26: BASE="/tmp/_base_pass.txt" let a census
# and a hand run clobber each other's baseline (two false UNGUARDED while the file was empty mid-rewrite, then
# LIVE counts inflated by 29 labels the census's own suite could never print). NOW= had been made mktemp for
# this exact reason and its four siblings had not; the suite now guards the CLASS (no /tmp/ in this
# file's code). The report path is printed at the end, or pass <path>.
OUT="$(mktemp -t smoke-mutation-matrix)"
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --gate) ONLY="${2:-}"; GATE=1; shift 2 ;;
    --record) RECORD_DIR="${2:-}"; shift 2 ;;
    -*)     echo "unknown flag: $1" >&2; exit 2 ;;
    *)      OUT="$1"; shift ;;
  esac
done
if [ -n "$RECORD_DIR" ]; then
  [ "$GATE" = "1" ] || { echo "--record needs --gate (it saves per-hook gate verdicts)" >&2; exit 2; }
  case "$RECORD_DIR" in /*) ;; *) echo "--record needs an ABSOLUTE directory (this run re-executes in a temp worktree)" >&2; exit 2 ;; esac
fi
# --only / --gate filter: empty ONLY ⇒ mutate every hook (full audit).
should_mutate() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; esac
  return 1
}

RED="$(mktemp)"                 # hook \t axis \t <raw failing line>  — the empirical record
MAP="$(mktemp)"                 # section \t label  (section kept for DISPLAY only, never for ownership)
VERD="$(mktemp)"                # per-assertion verdicts (was a fixed /tmp path)
BACKUP="$(mktemp -d)"

restore_all() {
  for b in "$BACKUP"/*.bak; do
    [ -e "$b" ] || continue
    n="$(basename "$b" .bak)"
    cp "$b" ".claude/hooks/$n" && chmod +x ".claude/hooks/$n"
  done
  if [ -n "$(git status --porcelain .claude/hooks/ 2>/dev/null)" ]; then
    echo "" >&2
    echo "🚨 .claude/hooks/ DIRTY AFTER RESTORE — A HOOK MAY BE LEFT MUTATED:" >&2
    git status --porcelain .claude/hooks/ >&2
    echo "   Recover: git checkout -- .claude/hooks/" >&2
  fi
  rm -rf "$BACKUP"
}
trap restore_all EXIT INT TERM   # necessary, NOT sufficient — see the SAFETY block above.

# ── WE READ THE ✓ LIST, NOT THE FAILURE LIST (the v2 bug — do NOT "simplify" this back) ──
# v2 matched each failing line back to its passing label (`<label> (<detail>)`, so the label is a
# prefix). That premise is FALSE: this suite has no stable assertion identity. Many assertions are
# hand-rolled if/else and print a DIFFERENT string on failure than on success, with the measured
# value interpolated INTO the label. Measured, band-o-inject:
#     pass →  "FIRE: chunk 1 is 6628 chars (< 9500 — under the truncation ceiling)"
#     fail →  "FIRE: chunk 1 is 999999 chars — at/over the 9.5K guard..."
# Those can never match, so v2 reported all six of that hook's assertions INERT — while the
# hook-liveness pre-pass proved killing it DOES fail the suite. Same for log-user-slash-commands
# (passes "FIRE captures args + source", fails "FIRE on '/orient' (real skill) → 1 log line").
#
# So ask the question that needs no label stability: **did this assertion STOP PASSING?**
# An assertion is RED under a mutation iff its baseline ✓ label is absent from that run's ✓ list.
# Set difference. No text matching between pass and fail, ever.
passing_labels() {
  bash "$SUITE" --verbose 2>/dev/null | grep '^  ✓ ' | sed 's/^  ✓ //' | sort
}
failing_lines() {
  bash "$SUITE" --verbose 2>/dev/null | sed -n '/^Failures:/,$p' | grep '^  - ' | sed 's/^  - //'
}

echo "── baseline ──"
# Section is captured for DISPLAY only (where to find the assertion) — never for ownership.
bash "$SUITE" --verbose 2>/dev/null | awk '
  /^=== / { sec=$0; sub(/^=== /,"",sec); sub(/ .*$/,"",sec); next }
  /^  ✓ / { lbl=$0; sub(/^  ✓ /,"",lbl); print sec "\t" lbl }
' > "$MAP"
BASE="$(mktemp)"                # the baseline ✓ labels — the file the 2026-08-26 census collision hit
passing_labels > "$BASE"
BASE_N="$(grep -c . "$BASE" || true)"
BASE_FAIL="$(failing_lines | grep -c . || true)"
echo "   $BASE_N passing assertions · baseline failures: $BASE_FAIL"
# An EMPTY baseline is not a green one. BASE_N was computed, printed twice, and
# gated NOWHERE — so a suite that DIES outright yields BASE_N=0 AND BASE_FAIL=0, sails past the guard
# below, reads every hook UNGUARDED (nothing can vanish from an empty set), returns gate_rc=1, and makes
# .githooks/pre-push REFUSE the push — the false-block this script's own comments say it must never
# manufacture. The mktemp fix closed the concurrent-clobber CAUSE; it never closed this one. Positive
# control on a healthy suite: BASE_N >= 1. Its own cause token, so pre-push warns rather than blocks:
# an empty baseline is a broken HARNESS, not a red suite, and only BASELINE-RED blocks.
if [ "$BASE_N" = "0" ]; then
  echo "   ⛔ BASELINE IS EMPTY — the suite produced ZERO passing assertions, so it did not run." >&2
  echo "      Every hook would read UNGUARDED against an empty set. Refusing to manufacture a false block." >&2
  echo "L3-CAUSE=BASELINE-EMPTY" >&2
  exit 3
fi
if [ "$BASE_FAIL" != "0" ]; then
  echo "   ⛔ BASELINE IS NOT GREEN. Every delta below would be measured against a broken suite." >&2
  echo "      Fix the suite first. Refusing to produce a matrix nobody can trust." >&2
  # The ONE rc=3 cause pre-push BLOCKS on when a secret scanner changed: a red baseline is a DURABLE,
  # silent state — it can persist unnoticed for a long time while being dismissed as routine dirt.
  echo "L3-CAUSE=BASELINE-RED" >&2
  exit 3   # INFRA/baseline error, not a hook UNGUARDED verdict (the exit-code split — pre-push branches on rc==3)
fi

# ── GATE mode (LAYER 3): the deployed per-hook liveness verdict, via the SHARED count_vanished primitive
#    (the SAME code --self-test-gate drives). Skips the full-report loop entirely. ──
if [ "$GATE" = "1" ]; then
  echo ""
  echo "════ LAYER 3 GATE — killing each named hook must redden ≥1 assertion ════"
  # CONTROL PASS: an UN-mutated re-run must reproduce the baseline. If a baseline-✓
  # vanishes with NO mutation applied, the suite is FLAKY — and a "LIVE" verdict could then be a coincident
  # flake rather than the hook firing. So the verdict is untrustworthy; exit 3 (INFRA), not a hook verdict.
  ctrl="$(mktemp)"; suite_labels "$SUITE" > "$ctrl"
  if [ -n "$(comm -23 "$BASE" "$ctrl")" ]; then
    echo "   ⛔ SUITE FLAKY — an un-mutated re-run dropped baseline-✓ labels; the gate verdict is untrustworthy." >&2
    name_dropped "$BASE" "$ctrl"
    rm -f "$ctrl"; echo "L3-CAUSE=SUITE-FLAKY" >&2; exit 3
  fi
  rm -f "$ctrl"
  gate_rc=0
  VERDICTS="$(mktemp)"   # hook <TAB> LIVE|UNGUARDED <TAB> count — written as records only after the post-control
  KRUNS="$(norm_kruns "${FF_GATE_KILL_RUNS:-2}")"   # a malformed/degenerate value must not silently single-run
  for want in $(printf '%s' "$ONLY" | tr ',' ' '); do
    [ -z "$want" ] && continue
    if [ ! -f ".claude/hooks/$want" ]; then
      # A named-but-absent hook is NOT a pass — a name you could not verify never reads green.
      printf '  ⚠ %-42s not present at HEAD (deleted in this push?) — cannot mutate\n' "$want"
      gate_rc=1
      continue
    fi
    kk="$(count_vanished "$BASE" "$SUITE" ".claude/hooks" "$want" "$KRUNS")"
    if ! kk_is_integer "$kk"; then
      # A non-integer count is a TRANSIENT measurement failure, NOT an UNGUARDED verdict. Exit 3
      # (INFRA) — the pre-push branches on rc==3 and does NOT block; never manufacture a false-block.
      echo "   ⛔ MEASUREMENT FAILURE — '$want' liveness probe returned a non-integer count ('$kk')," >&2
      echo "      a transient failure (worktree-add race / killed subproc / index-lock on the shared tree)," >&2
      echo "      NOT a hook verdict. Classifying INFRA (exit 3) rather than a false UNGUARDED → false-block." >&2
      echo "L3-CAUSE=BAD-COUNT" >&2
      exit 3
    fi
    if [ "$kk" -ge 1 ]; then
      printf '  ✅ %-42s LIVE — %s assertion(s) die when it is killed\n' "$want" "$kk"
      printf '%s\tLIVE\t%s\n' "$want" "$kk" >> "$VERDICTS"
    else
      printf '  ❌ %-42s UNGUARDED — killing it fails NOTHING; the suite cannot prove it fires\n' "$want"
      printf '%s\tUNGUARDED\t0\n' "$want" >> "$VERDICTS"
      gate_rc=1
    fi
  done
  # POST-CONTROL: after all kill runs, one more UN-mutated pass must STILL reproduce
  # the baseline. The pre-control (above) samples the un-mutated suite BEFORE the kills; this brackets the
  # BACK — catching run-order / monotonic state that only diverges after many suite runs (a deterministic
  # false-LIVE the K-run union rule alone cannot see). Fail-safe: it can only demote the whole run to
  # untrustworthy (exit 3, INFRA), never manufacture a LIVE verdict.
  post="$(mktemp)"; suite_labels "$SUITE" > "$post"
  if [ -n "$(comm -23 "$BASE" "$post")" ]; then
    echo "   ⛔ SUITE STATE-DEPENDENT — an un-mutated re-run AFTER the kill runs dropped baseline-✓ labels;" >&2
    echo "      the gate verdicts may reflect accumulated run-order state, not hook liveness. Untrustworthy." >&2
    name_dropped "$BASE" "$post"
    rm -f "$post"; echo "L3-CAUSE=SUITE-STATE-DEPENDENT" >&2; exit 3
  fi
  # PRINT ON BOTH OUTCOMES: a silent-on-pass control cannot be told from one that
  # never ran — its absence is consistent with "passed" AND with "the branch was never reached". One
  # line makes the silence a reading. The FAIL arm above already prints; this is the PASS arm.
  echo "   ✓ post-run control: an un-mutated re-run still reproduces the baseline (no run-order state)"
  rm -f "$post"
  # --record: only now, with both controls passed, is a verdict worth saving. A write failure refuses the whole
  # run (exit 3) rather than leaving a partial set that reads as "the rest were never checked".
  if [ -n "$RECORD_DIR" ]; then
    # shellcheck source=lib/hook-liveness-record.sh
    source scripts/lib/hook-liveness-record.sh
    while IFS=$'\t' read -r rh rv rn; do
      [ -z "$rh" ] && continue
      if l3_record_write "$RECORD_DIR" "$rh" "$rv" "$rn"; then
        echo "   ↪ saved: $rh $rv → $RECORD_DIR/$rh.rec"
      else
        echo "   ⛔ --record: could not save $rh's verdict to $RECORD_DIR" >&2; rm -f "$VERDICTS"; echo "L3-CAUSE=RECORD-FAIL" >&2; exit 3
      fi
    done < "$VERDICTS"
  fi
  rm -f "$VERDICTS"
  exit $gate_rc
fi
# KILL-RUN REPETITION SHIPPED (KILL-correlated-flake soundness — supersedes the "no-op" note that stood here,
# which was load-bearing-FALSE: it claimed every hook's FIRE assertion sits in a section that invokes it, but
# ~10/38 hooks are exercised cross-section + 2 via a variable path). The fix is REPETITION,
# not attribution: count_vanished (above) kills once, samples K=${FF_GATE_KILL_RUNS:-2} times, and credits
# ONLY a label that vanishes in EVERY kill run (union rule) — a flake that reappears cannot certify liveness.
# The pre-control (spontaneous flake) + post-control (run-order state) bracket the un-mutated suite on both
# sides. Attribution (credit only labels whose SECTION invokes the hook) was REJECTED by a review panel:
# it re-imports the derive-don't-guess v1 bug (section == locator, never
# owner) and false-UNGUARDs ~12/38 hooks — the direction that trains SKIP_HOOK_LIVENESS_GATE=1. The one
# residual repetition cannot see — an assertion scanning the REAL .claude/hooks/ dir (q=1 coupling, which
# reddens under ANY hook's death) — is verified EMPTY today (hooks-integrity-check pins CLAUDE_PROJECT_DIR to
# a fixture tree) and DEFERRED with a concrete trigger: the first suite assertion that scans the real hooks
# dir → add the synthetic-canary discount or the fixture-pin lint then.

# ── FULL-REPORT mode (non-gate): the label-building loop for ownership + the wrongness/absence verdict. ──
: > "$RED"
NOW="$(mktemp)"   # mktemp, not a fixed /tmp path — two concurrent runs no longer clobber each other
for h in .claude/hooks/*.sh; do
  n="$(basename "$h")"
  should_mutate "$n" || continue
  cp "$h" "$BACKUP/$n.bak"

  printf '#!/usr/bin/env bash\nexit 0\n' > "$h"; chmod +x "$h"
  passing_labels > "$NOW"
  comm -23 "$BASE" "$NOW" | while IFS= read -r l; do [ -n "$l" ] && printf '%s\tKILL\t%s\n' "$n" "$l"; done >> "$RED"

  printf '#!/usr/bin/env bash\necho "MUTANT-GARBAGE-OUTPUT"\nexit 0\n' > "$h"; chmod +x "$h"
  passing_labels > "$NOW"
  comm -23 "$BASE" "$NOW" | while IFS= read -r l; do [ -n "$l" ] && printf '%s\tGARBAGE\t%s\n' "$n" "$l"; done >> "$RED"

  cp "$BACKUP/$n.bak" "$h"; chmod +x "$h"
  k=$(awk -F'\t' -v n="$n" '$1==n && $2=="KILL"' "$RED" | grep -c . || true)
  g=$(awk -F'\t' -v n="$n" '$1==n && $2=="GARBAGE"' "$RED" | grep -c . || true)
  printf '  %-42s killed→%-3s garbage→%-3s\n' "$n" "$k" "$g"
done

# ── Verdict + ownership, BOTH derived from the record. An assertion stopped passing under hook H's
#    mutation ⇒ it guards H. Exact label equality — the ✓ label is the key on both sides.
awk -F'\t' -v RED="$RED" -v OUT="$OUT" '
  BEGIN {
    while ((getline line < RED) > 0) {
      split(line, p, "\t")
      key = p[3]
      if (p[2]=="KILL")    { killed[key]=1; ok=owners[key]; if (index(ok,p[1])==0) owners[key]= ok (ok==""?"":",") p[1] }
      if (p[2]=="GARBAGE") { garbled[key]=1; ok=owners[key]; if (index(ok,p[1])==0) owners[key]= ok (ok==""?"":",") p[1] }
    }
    print "assertion\towners\tred_when_KILLED\tred_when_GARBAGE\tverdict" > OUT
  }
  {
    sec=$1; lbl=$2
    a = (lbl in killed)  ? "RED" : "no"
    b = (lbl in garbled) ? "RED" : "no"
    own = (lbl in owners) ? owners[lbl] : "—"
    if (a=="RED" && b=="RED")      v="STRONG"
    else if (a=="RED")             v="absence-only"
    else if (b=="RED")             v="wrongness-only"
    else                           v="*** INERT ***"
    print lbl "\t" own "\t" a "\t" b "\t" v > OUT
    print sec "\t" lbl "\t" v
  }
' "$MAP" > "$VERD"

echo ""
echo "════ PER-ASSERTION VERDICT (n=$BASE_N) ════"
awk -F'\t' 'NR>1 { c[$5]++ } END { for (k in c) printf "  %-18s %s\n", k, c[k] }' "$OUT" | sort -k2 -rn

# Split the INERT set into the two populations. An assertion is HOOK-GUARDING if its section's
# block actually invokes a hook — approximated by: the section name names a hook file that exists,
# OR the suite's section body contains a `bash .claude/hooks/` invocation. We use the section only
# as a LOCATOR here (safe), never as an owner.
echo ""
echo "════ *** INERT *** — split into the two populations ════"
echo ""
echo "  (a) HOOK-GUARDING and INERT — the real findings:"
awk -F'\t' '$3 ~ /INERT/ { print $1 "\t" $2 }' "$VERD" |
  while IFS=$'\t' read -r sec lbl; do
    stem="${sec%.sh}"
    [ -f ".claude/hooks/${stem}.sh" ] && printf '      ❌ %-26s %s\n' "$stem" "$lbl"
  done
echo ""
echo "  (b) NOT a hook guard (config / count / wiring / marker) — out of scope for a HOOK mutation:"
awk -F'\t' '$3 ~ /INERT/ { print $1 }' "$VERD" |
  while IFS= read -r sec; do
    stem="${sec%.sh}"
    [ -f ".claude/hooks/${stem}.sh" ] || echo "$sec"
  done | sort | uniq -c | sort -rn | awk '{printf "      · %-3s in section %s\n", $1, $2}'
echo ""
echo "  full matrix: $OUT   (raw mutation record: $RED)"
