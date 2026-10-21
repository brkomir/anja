#!/usr/bin/env bash
# PreToolUse(Bash) hook — two grep shapes that blew up this box.
# MODE IS SPLIT PER ARM: shape -> BLOCK · absroot -> WARN. Full rationale under "MODE SPLIT".
# (On 2026-08-13 shape was demoted to warn on a use-class FP, the FP's cause was fixed during the
#  demotion window, and the block was restored the same session. Demote-fix-re-promote, not a flip.)
# (This line said "WARN-MODE" for ~3h after the split, including across two commits to this file —
#  a summary line surviving the change it summarizes, in the file deliberately chosen as the durable
#  home for this guard's knowledge. The filename still says `-warn`; renaming a wired hook means
#  editing settings.json + the smoke wiring pin, so the name stays and this line carries the truth.)
#
# WHY. On 2026-07-31/08-01 four ugrep processes reached 5.44 / 19.78 / 21.71 / 57.66 GB RSS and had
# to be killed; the machine hit 85% with swap 76% consumed, and this repo has already lost a live
# `/wrap` to an OOM. Two INDEPENDENT causes were measured, and a brief telling agents to be
# careful did not hold — three agents got the rule as the first bold section of their brief, with
# the 57 GB number attached, and at least two deviated anyway. A brief is not a control; this is.
#
# FIRE 1 — BACKTRACKING SHAPE. A variable-width quantifier placed BEFORE an
#   alternation multiplies the backtracking space at every start position. Measured: ugrep running
#   `.{0,120}(five|branch|alternation).{0,120}` over TWO named files totalling ~5 MB reached
#   19.78 GB RSS / 426.80 GB VSZ — roughly 4000x its input — and was still climbing when killed.
#   Forward-anchored equivalents (`'<literal>.{0,300}'`) cost nothing and are the fix.
#
# FIRE 2 — ABSOLUTE ROOT. `grep` in this shell is a FUNCTION from the shell-snapshot that
#   execs `ugrep -G --ignore-files …`. That flag suppresses the 34 full repo clones under
#   `.claude/worktrees/` (124,878 files) ONLY when the traversal root is spelled RELATIVELY.
#   Measured same-cwd, one command apart:
#       grep -rlF PLAN_LIMITS .                          ->   206 files
#       grep -rlF PLAN_LIMITS <abs-repo>                 -> 6,735 files  (32.7x, 88% clones)
#       same + --exclude-dir=worktrees                   ->   794 files  (NOT equivalent)
#       rg -lF, either spelling                          ->   167 / 167  (immune)
#   Neither grep output tells you which corpus you got. `rg` walks with its own gitignore
#   implementation, so it is root-spelling insensitive — that is why the remedy is "use rg".
#
# MODE: SPLIT PER ARM (adopted after the block-mode evidence turned inside one hour).
#   ⛔ BLOCK MODE WAS LATER RE-AFFIRMED for the shape arm: it stays blocking because another
#   system crash is the outcome it exists to prevent. That call was made WITH the over-blocking
#   evidence in hand and against it — a hand-read sample of 12 denials found 7 carrying no
#   hazardous shape, and the answer was still block. So DO NOT re-open this as "the FP rate
#   justifies a demotion"; that argument has been made, with numbers, and lost. The live question
#   is only ever "can the FP rate fall WITHOUT weakening the hazard predicate" — the tokenisation
#   fix is what that looks like, and it cleared >=41 recorded blocks while leaving the
#   predicate untouched. ⚠️ And note what that call does NOT cover: FIRE 2 below is WARN, so the
#   corpus-blowup half of the measured crash is not gated by anything but the "use rg" convention.
#   Escape for both arms: SKIP_GREP_BLOWUP_WARN=1.
#     FIRE 1 (shape)   -> BLOCK: deny + exit 2.
#     FIRE 2 (absroot) -> WARN:  stderr + exit 0.
#   When BOTH fire, the block wins (a command carrying the shape is denied whatever else it does).
#
# WHY THE SPLIT — the honest version, because the argument that bought block-mode is the one that
# failed. The promotion was NOT justified by a measured FP rate (the window was ~1h with zero real
# fires, a deliberate deviation). It was justified by the claim that **NEITHER SHAPE HAS A
# LEGITIMATE USE**, so a false positive costs ONE REWRITE rather than a blocked workflow:
#   - a leading `.{0,N}(a|b)` is ALWAYS rewritable to a forward-anchored `'<literal>.{0,N}'` with
#     identical results, and
#   - an absolute root is ALWAYS replaceable by `rg` (immune) or a relative path.
#
# THAT CLAIM SURVIVED FOR ONE ARM AND NOT THE OTHER. Three false positives landed inside ten
# minutes of going block-mode — ALL THREE on the absroot arm, ZERO on the shape arm:
#   1. the smoke suite's own invocation (every Bash call here opens `cd <abs-repo>`, so the path
#      is in nearly every command string) — a genuine DETECTOR BUG, fixed by the cd-strip below;
#   2. this hook's own verifier, whose fixtures were inline;
#   3. the commit message documenting (1) and (2), which quotes a cd line while also grepping.
# (2) and (3) are NOT bugs and cannot be fixed here: a command-STRING matcher cannot distinguish
# an INVOCATION from a QUOTED MENTION — the same property that made block-dangerous.sh deny the
# commit documenting its own false positive earlier the same night. So for absroot the FP cost is
# not "one rewrite"; it is a rewrite of whatever you were doing INCLUDING PROSE ABOUT THE GUARD,
# and it RECURS — which is exactly the cost the promotion argument said would not exist.
#
# ⛔ CORRECTED 2026-08-01 (confirmed against this hook's OWN fires log).
# The sentence below read "it has never false-fired" and that is FALSE. Post-split, `absroot`
# WARNS and only `shape` can DENY (:196-197) — so every block after 10:14 is a shape-arm event
# by construction, and the hook's match log records shape DENIES on ordinary work, including
# `grep -iE '^from:|^to:'` (a mail-header read, no quantifier before its alternation) at
# 13:27:44Z. That is the compositional false positive the segment-scope fix below was written
# to fix — i.e. the review finding itself was a shape-arm false fire.
#
# ⛔ AMENDED 2026-08-13 — THE ARM STILL BLOCKS, but one clause of its argument is dead. Below is the
# argument that KEPT it blocking, struck in place rather than deleted because it is the record of
# what was believed and why, and because its second clause is the one that failed:
#   ~~The shape arm keeps blocking because: it has never false-fired (REFUTED above), ITS LITERAL
#   IS NOT SOMETHING ANYONE WRITES ABOUT (nobody quotes a backtracking regex in a commit message),
#   and its failure mode is a 19.78 GB runaway. Warn is not good enough for it — the brief it
#   replaces was handed to three agents with the 57 GB number attached and 2 of 3 deviated anyway,
#   which is precisely the "the warn fired to stderr but went unseen" failure that promoted
#   block-dangerous.sh's zsh word-split rule warn->block on 2026-06-29.~~
# The capitalised clause is measurably false: on 2026-08-13 TWO seats quoted this exact shape in
# bug reports about this exact arm, and BOTH reports were denied by it. People write about a
# backtracking regex precisely when the guard against it misfires — the guard generates its own
# mention corpus, which is exactly what this header's closing paragraph already
# says in the abstract while the clause above denied it in the particular.
# The runaway rationale is UNAFFECTED and still true: 19.78 GB is why the arm still blocks. What
# changed is that the mention-cost the struck clause denied is now REAL and PAID FOR at the
# predicate instead of at the mode: command substitutions are stripped before the gap test, so the
# shape that provoked those two bug reports no longer fires at all. Block is defensible again
# because the FP it was defended against is gone, not because the argument got better.
#
# RE-PROMOTION CRITERION for the absroot arm — deliberately NOT filed as a tracker row, because a
# row nothing can fire is a decorated "never". There is exactly one observable that would
# argue for taking the mention-FP cost: a real absolute-root runaway that happens ANYWAY, i.e. the
# warn fires (recorded in .claude/logs/grep-blowup-fires.jsonl with decision:"warn") and a ugrep
# still reaches multi-GB. That is an INCIDENT, not something a scan finds — so it belongs here,
# where whoever is looking at this hook after the next OOM will read it, and nowhere else.
#
# The general lesson, worth more than this hook: **"the flagged shape has no legitimate use" is a
# claim about the WORLD; a command-string guard fires on a claim about a STRING.** The gap between
# them is every context in which the string is mentioned rather than run — documentation, fixtures,
# commit messages, briefs — i.e. exactly the contexts a guard generates more of once it exists.
# Before promoting any string-matching guard to block, ask what the flagged text looks like when
# someone WRITES ABOUT it, not only when someone RUNS it.
#
# SCOPE NOTE: the runaways arrived through the BASH tool (their parent chain was
# ugrep -> zsh -> zsh -> claude, i.e. two shells sourcing a shell-snapshot), which is why a Bash
# matcher reaches them and no `Grep` matcher is required — settings.json has no Grep matcher and
# it turned out not to need one. A Grep-TOOL call is NOT covered by this hook; that residual is
# named here rather than papered over.

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
[[ "${SKIP_GREP_BLOWUP_WARN:-0}" == "1" ]] && exit 0   # =1 only; a stray =0/=no must NOT bypass

input=$(cat 2>/dev/null || echo "{}")
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
        | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi
[ -z "$cmd" ] && exit 0

# Only inspect grep-family invocations.
printf '%s' "$cmd" | grep -qE '(^|[|;( ])(grep|egrep|ugrep|rg)([[:space:]]|$)' || exit 0
# Run ledger: ONE row per grep-family run, clean included, in grep-blowup-warn-fires.jsonl —
# the COMMAND-population denominator the MATCH log below (grep-blowup-fires.jsonl) cannot give. GREP_BLOWUP_NO_LOG=1 silences both.
_w1_fire() { local _r=$?; [ "${GREP_BLOWUP_NO_LOG:-0}" != 1 ] || return 0; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${input:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log grep-blowup-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "$([ -n "${hits:-}" ] && echo found || echo clean)" decision "${DECISION:-}" rc "$_r" ) >/dev/null 2>&1 || true; }; trap _w1_fire EXIT

hits=""

# --- FIRE 1: variable-width quantifier BEFORE an alternation -------------------------------
# Matches `<atom>{0,N}(`, `<atom>*(`, `<atom>+(` with optional intervening chars — the shapes whose
# backtracking space is multiplied by each alternation branch.
#
# ⛔ THE QUANTIFIED ATOM IS NOT ALWAYS `.` — this predicate hardcoded `\.` for its first ~4 hours
# and was BLIND to the form the agents actually write (measured 2026-08-01):
#     grep -oE '.{0,400}(a|b|c)'        -> rc=2 DENIED    ✅
#     grep -oE '[^"\\]{0,400}(a|b|c)'   -> rc=0 ALLOWED   ⛔  identical catastrophic shape
# A `/wrap` deep-pass slice agent ran exactly the second form, this guard waved it through, and the
# grep had to be killed at 120s; a sibling agent's ugrep peaked at 14.46 GB in the same wave. The
# guard was not bypassed and it is not a Grep-tool gap — sub-agent Bash calls DO fire it and are in
# the fire log. It simply could not see a negated character class.
#
# WHY IT WAS MISSED, since the discipline for this is codified: the predicate was validated
# against the two patterns I had personally MEASURED, both of which spell the atom `.`. The corpus
# that mattered was the patterns AGENTS write — and the deep-pass brief hands every one of them
# `'"role":"user"[^]]{0,400}'`, a character-class quantifier, as its worked entry point. I wrote the
# blind spot into the brief and then wrote a guard that could not see it.
# ⚠️ The bracket-expression arm must accept a LEADING LITERAL `]`: in POSIX/ERE a `]` immediately
# after `[` or `[^` is a literal, so `[^]]` ("anything but a close-bracket") is four characters and
# a naive `\[[^]]*\]` matches only its first three. The first cut of this widening had that bug and
# a corpus check caught it on exactly one member — `[^]]{0,400}`, the atom in this repo's own
# deep-pass brief. Validating against the real corpus rather than re-reading the regex is what
# found it: reasoning about the pattern agreed with the pattern, both times.
_GBW_ATOM='(\.|\[\^?\]?[^]]*\]|\\[wWsSdD])'
#
# ⛔ TWO SCOPE DEFECTS, BOTH REPRODUCED HERE
#    BEFORE FIXING. The guard used to scan the WHOLE command line for each of its three signals
#    independently, so on a COMPOUND line the three could come from three unrelated sub-commands:
#      `grep -iE '^from:|^to:' f | head -4; sed -E 's/.*([0-9]{10,})/x/' g`   -> DENIED
#    The grep satisfied the tool gate, the SED satisfied the shape test, and the SHELL PIPE
#    satisfied the "alternation" test. Nothing hazardous anywhere in it. That exact line was
#    ordinary mail-header work a peer typed BEFORE any of this was under review — a real false
#    positive on real work, not a constructed one, which REFUTES the "no legitimate use" premise
#    that block-mode rests on.
#
#    (a) SEGMENT SCOPE. Split on `;` / `&&` / `||` / newline and test only the segments that are
#        THEMSELVES grep-family invocations. Deliberately NOT split on a bare `|`: the pipe
#        character is also the alternation operator we are hunting, so splitting there would
#        destroy the signal.
#    (b) THE `|` MUST BE INSIDE THE PARENS. The old test was `grep -qF '|'` over the whole line
#        under a comment claiming "only if there is actually an alternation inside those parens" —
#        a fixed-string search for one byte cannot know about parens, and a shell pipe is not an
#        alternation. The comment described a check the code did not implement. Now the `|` must
#        appear after the `(` and before any `)`, which is what makes the sentence true.
_GBW_GAP='[^|]{0,20}\([^)]{0,200}\|'
_gbw_shape=0
# (d) THE SPLIT IS QUOTE-AWARE, AND IT NOW INCLUDES THE BARE `|` (2026-08-18).
#     (a) above declined to split on `|` because "the pipe is also the alternation
#     operator we are hunting". True of a QUOTED pipe and false of an unquoted one:
#     an alternation lives inside a quoted regex argument by construction, since an
#     unquoted `(` or `|` is a subshell or a pipe to the shell. So an UNQUOTED pipe is
#     a shell pipe, always, and splitting there cannot destroy the signal.
#     WHY IT MATTERS: (b) requires the `|` after a `(` and before any `)`, but nothing
#     stopped that span leaving the command. Measured on a real deny —
#     an awk program supplying `[a-z_]+` and `(`, then `[^)]{0,200}` running past the
#     closing quote to reach the SHELL PIPE, with the far side being a fixed-string
#     search carrying no alternation at all. The command's own label said "no
#     alternation" and it was denied anyway. The `|` satisfying (b) was the pipe (b)
#     exists to exclude.
#     The `;` / `&&` split is quote-aware for the same reason, and that direction is
#     the safe one: a separator inside a regex used to cut a hazard in half and hide
#     it, so honouring quotes makes the guard fire MORE, not less.
#     KNOWN HOLE, DELIBERATELY UNFIXED: the tracker refuses backslash-escapes inside
#     single quotes, which is right for POSIX `'…'` and WRONG for ANSI-C `$'…'`, where
#     an escaped quote IS an escape — so the sq flag inverts for the rest of the line
#     and a real hazard can go silent. Base rate measured over the fires ledger
#     (2026-08-18): 3,556 records, 33 carry ANSI-C quoting, ZERO carry it together with
#     an escaped quote, i.e. the desync precondition has never once occurred here. A
#     predicate change at this branch spends more risk than the hole is worth; if you
#     ever see it fire, re-measure that pair before touching the state machine.
_gbw_segs=$(printf '%s' "$cmd" | awk '{ out=""; sq=0; dq=0; n=length($0);
  for (i=1;i<=n;i++) { c=substr($0,i,1);
    if (c=="\\" && !sq) { out=out c substr($0,i+1,1); i++; continue }
    if (c=="'"'"'" && !dq) { sq=!sq; out=out c; continue }
    if (c=="\"" && !sq) { dq=!dq; out=out c; continue }
    if (!sq && !dq && (c=="|" || c==";")) { out=out "\n"; continue }
    if (!sq && !dq && c=="&" && substr($0,i+1,1)=="&") { out=out "\n"; i++; continue }
    out=out c }
  print out }')
#    ⛔ FAIL CLOSED IF THE SPLIT ITSELF DIES. The pre-2026-08-18 split was bash parameter
#       expansion and could not fail; this one shells out. awk exiting non-zero leaves
#       _gbw_segs EMPTY, the loop below `continue`s on its single empty line, _gbw_shape
#       stays 0, and a GENUINE hazard is ALLOWED (measured: rc=2 with awk live, rc=0 with
#       an awk shim exiting 1). Scanning the unsplit command is the safe degradation —
#       it costs the cross-boundary FP this commit fixed, and never a missed hazard.
[ -z "$_gbw_segs" ] && _gbw_segs="$cmd"
while IFS= read -r _gbw_seg; do
  [ -z "$_gbw_seg" ] && continue
  printf '%s' "$_gbw_seg" | grep -qE '(^|[|;( ])(grep|egrep|ugrep|rg)([[:space:]]|$)' || continue
  #    (c) STRIP COMMAND SUBSTITUTIONS FIRST (2026-08-13). `$( ... | ... )` is parens-with-a-pipe
  #        BY CONSTRUCTION, so it satisfies (b) with no alternation anywhere in the command —
  #        which is the FP that got this arm demoted. Note (b) was written to EXCLUDE shell pipes
  #        and is what re-admitted them: requiring the pipe inside parens is precisely what a
  #        substitution supplies. The discriminator is one character — a substitution is `$(`,
  #        a regex group is `(` — so strip `$(...)` and backtick spans, and leave real groups.
  #        Two passes handles one level of nesting; a partial strip errs toward still-firing.
  #        Measured: two independent seats denied on real invocations, both of their bug reports
  #        denied too.
  _gbw_scan="$_gbw_seg"
  for _gbw_pass in 1 2; do
    _gbw_scan=$(printf '%s' "$_gbw_scan" | sed -E 's/\$\([^()]*\)//g; s/`[^`]*`//g')
  done
  if printf '%s' "$_gbw_scan" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}" \
     || printf '%s' "$_gbw_scan" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}" ; then
    _gbw_shape=1
  fi
done <<< "$_gbw_segs"
[ "$_gbw_shape" = 1 ] && hits="${hits}shape "

# --- FIRE 2: absolute repo root on a grep-family recursive walk -----------------------------
# rg is immune (own gitignore walker), so exempt it.
#
# ⚠️ STRIP `cd <abs-path>` FIRST — measured within ONE command of going block-mode (2026-08-01).
# Every Bash call in this repo opens with `cd <abs-repo>`, so the absolute path is
# present in the command string of NEARLY EVERY COMMAND. A naive substring test therefore fires on
# any command that cds to the repo AND contains a grep anywhere — which blocked the hook's own
# smoke-test invocation on its first run. A `cd` target is not a grep ROOT; only an absolute path
# used as a search argument is. This is the FP class an observation window exists to find, and it
# was found the hard way — worth keeping as the reason the strip is not optional.
# The ROOT is derived at run time, so the arm is PORTABLE: it used to key on the literal path of one
# Mac's checkout, so on any other checkout it silently never fired while the hazard (the ugrep shim
# + agent worktrees) travels with Claude Code. ORDER: git FIRST, CLAUDE_PROJECT_DIR the fallback —
# this arm asks a CWD question (does the command root a grep at the tree it runs IN), not the SESSION question LOG_DIR asks,
# so the tree the command executes in is the primary; the variable answers only when cwd is not a repo. A
# worktree under the root still matches (prefix). The root is escaped for the sed ERE (a path may carry
# `.`/`+`/etc.), `#` is the sed delimiter — and the root enters the sed PATTERN and a fixed-string grep ONLY,
# never a sed REPLACEMENT, where `&` expands to the match and no ERE escape set can cover it.
_gbw_root="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}")"
_gbw_root_re="$(printf '%s' "$_gbw_root" | sed -E 's/[][\\.^$*+?(){}|#]/\\&/g')"
cmd_scan=$(printf '%s' "$cmd" | sed -E "s#(^|[|;&[:space:]])cd[[:space:]]+${_gbw_root_re}[^[:space:];|&]*#\\1#g")
if printf '%s' "$cmd_scan" | grep -qE '(^|[|;( ])(grep|egrep|ugrep)([[:space:]])' ; then
  if printf '%s' "$cmd_scan" | grep -qF "$_gbw_root" ; then
    printf '%s' "$cmd_scan" | grep -qF -- '--exclude-dir=worktrees' || hits="${hits}absroot "
  fi
fi

[ -z "$hits" ] && exit 0

SHAPE_MSG=""
case "$hits" in
  *shape*)
    SHAPE_MSG="BACKTRACKING SHAPE: a variable-width quantifier sits BEFORE an alternation. Measured at 19.78 GB RSS over about 5 MB of input, roughly 4000x, and still climbing when killed. REWRITE: anchor on a LITERAL first and put the bounded context AFTER it, rather than leading with a wildcard span in front of the alternation. Better still, search one FIXED string at a time with grep -F, which cannot backtrack at all. "
    ;;
esac
ROOT_MSG=""
case "$hits" in
  *absroot*)
    ROOT_MSG="ABSOLUTE ROOT: grep here is a ugrep shim whose --ignore-files filtering DIES on an absolute root, so this walks the 124,878 files under .claude/worktrees/. Measured 206 files with a relative root versus 6,735 with an absolute one, 32.7x, 88 percent worktree clones. REWRITE: use rg, which is immune at 167 either spelling, or spell the root relatively. "
    ;;
esac

# --- MODE SPLIT ------------------------------------------------------------------------------
# shape -> BLOCK · absroot -> WARN. Both-fire => block.
#
# The sequence matters. The shape arm was dropped to warn after a use-class FP hit two seats on
# real invocations and denied BOTH their bug reports — and that raised the right question: wasn't
# the block there to stop a runaway? It was. Four ugrep processes reached 5.44 / 19.78 / 21.71 /
# 57.66 GB on this box, and warn-mode is measurably weak here (a brief carrying the 57 GB number
# went to three agents; two deviated).
#
# So the demotion was used as a WINDOW rather than an endpoint: while the arm could not deny, the
# actual defect was fixed (see (c) at the shape predicate — command substitutions are stripped
# before the gap test, because `$( ... | ... )` is parens-with-a-pipe by construction), and the
# block was restored. The hazard stays blocked; the false alarm is gone at the source.
#
# The general point, because it generalises past this hook: a blocking guard cannot be repaired
# safely while it is blocking — a wrong edit denies the tool through which its own SKIP_ escape
# would have to be typed. DEMOTE, FIX, RE-PROMOTE is the safe order, and the demotion window is
# the only moment the repair is cheap.
#
# Controls run at the restore, all five as predicted: substitution-only -> silent · real
# backtracking shape -> DENY · BOTH substitution and shape -> DENY (the hole-check: stripping must
# not create an escape) · backtick substitution -> silent · clean command -> silent.
case "$hits" in
  *shape*) DECISION="deny" ;;
  *)       DECISION="warn" ;;
esac

# Fires log FIRST — a fire must be recorded whichever way it is emitted, and the log is the
# calibration data for any future re-promotion of the absroot arm.
# ⛔ THIS IS A **MATCH LOG, NOT A COMMAND LOG** — the single most misread property of this file.
#    `[ -z "$hits" ] && exit 0` sits ABOVE this block, so a command the guard SAW and let pass
#    leaves no record at all. Consequence: ANY rate whose denominator should be "commands the
#    guard saw" is UNANSWERABLE from here, and the answer you get instead is well-formed and
#    wrong. It bites hardest on the question people actually ask of it — "did this change start
#    blocking anything new?" — because the commands that could newly-deny are exactly the ones
#    that previously passed silently, i.e. the population this file excludes BY CONSTRUCTION.
#    A replay over it therefore CANNOT produce a counterexample, so a clean result is not
#    evidence. Measured 2026-08-18: "0 newly denied across all 3,532 records" was reported off
#    this log, in a commit message, and could not have come out any other way.
#    ⚠️ Worse than an unclassified corpus, which announces itself the moment somebody reads a
#    row. A selection effect at the LOGGING layer is invisible from inside the data forever.
#    Second-order: the records are also truncated at `head -c 400` below, so ~21% of deny rows
#    do not reproduce against their own baseline (measured: 129 of 610, 78 at the ceiling),
#    which makes every count derived here a FLOOR and never a total.
# (best-effort; never fail the hook on a logging problem)
if [ "${GREP_BLOWUP_NO_LOG:-0}" != "1" ]; then
  LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s","kinds":"%s","decision":"%s","cmd":%s}\n' "$TS" "${hits% }" "$DECISION" \
    "$(printf '%s' "$cmd" | head -c 400 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
    >> "$LOG_DIR/grep-blowup-fires.jsonl" 2>/dev/null
fi

EVIDENCE="Four ugrep processes reached 5.44 / 19.78 / 21.71 / 57.66 GB on this box and had to be killed; the machine hit 85% with swap 76% consumed, and a live /wrap has already been lost to an OOM here."

if [ "$DECISION" = "warn" ]; then
  # WARN arm (absroot only). Stderr + exit 0 — see the MODE note in the header for why this arm
  # was demoted back out of block-mode: it produced 3 of 3 measured false positives, two of them
  # structural (a command-string matcher cannot tell an invocation from a quoted mention).
  # This arm is the FOUNDING MEASUREMENT of the warn-channel finding cited in
  # lib/warn-emit.sh's header — and it was still writing to the channel that
  # measurement proved the model cannot read. A warn arm exists to change the
  # NEXT command; on bare stderr it changed nothing and looked healthy.
  warn_emit <<EOF || true

⚠️  GREP BLOWUP (warn) — ${ROOT_MSG}
   ${EVIDENCE}
   (Warn, not block: this arm produced 3/3 of the measured false positives — a quoted MENTION of an absolute-root grep is indistinguishable from an invocation. Escape: SKIP_GREP_BLOWUP_WARN=1.)

EOF
  exit 0
fi

cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by grep-blowup-warn.sh. ${SHAPE_MSG}${ROOT_MSG}${EVIDENCE} BLOCKING because a leading variable-width quantifier before an alternation has no legitimate use — it is rewritable above with identical results, so this costs one rewrite. Escape if genuinely intended: this is a PreToolUse hook, so an inline SKIP_GREP_BLOWUP_WARN=1 prefix cannot reach it — set it in .claude/settings.json's env block (applied at launch) and restart the session."
  }
}
JSON

exit 2
