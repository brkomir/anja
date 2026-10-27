#!/usr/bin/env bash
# safe-commit.sh — stage + gate + commit on a shared worktree. REFUSES; never repairs.
#
# TWO GATES, TWO DIFFERENT HAZARDS (measured 2026-08-07):
#   bare commit  -> takes foreign PATHS    : staged set must equal the paths you declared
#   -o <path>    -> takes foreign CONTENT  : index must equal worktree for those paths
# Neither verb is safe alone. Both gates run in the SAME invocation as the commit, because a
# check from a previous shell call is already stale — two calls is the whole window.
#
# WHY IT REFUSES AND NEVER REPAIRS. A recovery recipe prescribes record-SHAs -> unstage -> commit ->
# restore-by-SHA. Steps 1-3 work. Step 4 died silently in a `while read` over a process
# substitution and left a peer's staged state DESTROYED rather than merely mis-attributed.
# A sweep costs provenance; a failed auto-restore costs their work. So: print, exit 1, human repairs.
#
# ⚠️ NARROWS, NEVER CLOSES (measured by 3 peers 2026-08-07, after two live sweeps).
# There is ONE index per repo and every seat runs `git add`, so the two verbs are immune
# to DIFFERENT writers and neither to both:
#     -o <path>  immune to a peer's STAGED other files / exposed to a WORKTREE write to your path
#     bare       immune to a peer's WORKTREE write     / exposed to a peer's STAGED other files
# Gate 1 is what covers the writer `bare` is blind to, and same-process is what keeps the
# gate from going stale. There is NO LOCK between them — a peer's `git add` landing in
# those ~35 lines still enters. Orders of magnitude narrower than two tool calls; not zero.
# Say NARROWS. The word "safe" was retracted by its own author within the hour.
#
# NO FP CALIBRATION IS POSSIBLE OR NEEDED: this compares a path SET against the paths you
# passed. No regex, no prose, no mention-vs-use ambiguity — so author-disqualification
# (which governs string-matching guards) does not attach.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: safe-commit.sh (-F <msgfile> | -m <msg>) [--del N] [--add N] [--staged] -- <path>...
       safe-commit.sh --self-test

Stages exactly <path>..., refuses if anything else is staged or if the index and
worktree disagree for those paths, then commits. Exits non-zero on refusal.

  --del N   REQUIRED for any commit containing a deletion. Declared deletions.
  --add N   Declared insertions (advisable on a many-writer file).
            *** COUNT YOUR OWN EDITS. DO NOT DERIVE THESE FROM `git diff`. ***
            The gate compares YOUR EXPECTATION against the real diff, so a peer's
            lines riding into your commit show up as a mismatch. Compute the
            numbers from what YOU changed -- a one-line row edit is 1 add/1 del,
            an N-line insert is N adds/0 dels -- then pass them.
            Deriving them with `git diff --numstat` makes the gate compare the
            diff to ITSELF: it is then structurally incapable of refusing, and it
            passes silently. That is the same failure as copying the number a
            refusal prints, one step earlier and with no refusal to warn you.
            MEASURED 2026-08-12: declared --add 183 --del 1, both
            piped straight out of `git diff --numstat`. Gate PASSED. 47 of the
            183 lines were a peer's lessons, hand-staged by them as an isolated
            blob minutes earlier; there is ONE index per repo, so the stage
            overwrote their entry and the commit took the lot. A hand-formed
            expectation of ~136 would have refused.
            SCOPE (this part was always right): whichever way you count, count
            over the WHOLE declared pathspec -- this script AGGREGATES, so a
            per-file check passes and the gate still refuses.
            If the gate refuses, the delta is somebody else's. Investigate it;
            never adjust your declaration to match — UNLESS a documented
            own-arithmetic cause applies (rename · tool-written diff · untracked
            files entering the cached diff at add · wc -l newline undercount ·
            shared block-endpoint context lines · long-paragraph collapse ·
            a disclosed ride-along): for those, take the printed derived pair
            AFTER verifying content (git diff --cached -U0 HEAD -- <paths>).
            The full cause list lives in active-recall.md's commit row.
            *** EXCEPTION — A COMMIT CONTAINING A RENAME. ***
            There the pair is UNGUESSABLE BY CONSTRUCTION and "count your own
            edits" has no answer, because the quantity gated is not a count of
            edits: git pairs a delete with an add as a RENAME only when BOTH
            endpoints fall inside the pathspec, so the SAME staged tree reports
            +254/-306 over 4 paths and +1010/-200 over 3 (measured 2026-08-09,
            an 86% rename -- the rationale on gate_col's derived-pair
            print, below). The number is a function of the pathspec, not of
            anything a person typed.
            So for a rename commit the derived pair printed on refusal IS the
            intended instrument -- read it, then verify the CONTENT rather than
            the count: `git diff --cached -U0 HEAD -- <paths>` and confirm every
            changed line is yours. You lose the arithmetic check and keep the
            one that matters.
            WHY THIS CARVE EXISTS: without it the usage text forbade the only
            method available on a rename, i.e. it contradicted this script's own
            refusal path -- the same defect class as the one the block above
            fixes, one layer over. Found by the author of that fix while
            verifying a review finding that had CLEARED them.
  --staged  Commit what is already staged (e.g. a hand-staged blob isolation).
            NOTE: GATE 1 still refuses while ANY foreign path is staged.
            Hand-staging a blob? `--cacheinfo` takes a MODE argument -- read it
            first (git ls-files --stage -- <path>) and pass it back (100755 for
            scripts/ and hooks): every written copy of the recipe hard-codes
            100644 and silently un-executables scripts (hit twice).
USAGE
  exit 2
}

MSGFILE=""; MSG=""; STAGED_MODE=0; EXP_DEL=0; EXP_ADD=""; DRIFT_OK=0; CAUSES_PRINTED=0; declare -a PATHS=()
[ $# -eq 0 ] && usage
case "${1:-}" in --self-test) SELFTEST=1;; *) SELFTEST=0;; esac

if [ "$SELFTEST" -eq 0 ]; then
  while [ $# -gt 0 ]; do
    case "$1" in
      --staged) STAGED_MODE=1; shift ;;
      --del) EXP_DEL="${2:-}"; shift 2 ;;
      --add) EXP_ADD="${2:-}"; shift 2 ;;
      --drift-ok) DRIFT_OK=1; shift ;;
      -F) MSGFILE="${2:-}"; shift 2 ;;
      -m) MSG="${2:-}"; shift 2 ;;
      --) shift; PATHS=("$@"); break ;;
      -h|--help) usage ;;
      *) echo "safe-commit: unexpected arg '$1'" >&2; usage ;;
    esac
  done
  [ -n "$MSGFILE" ] || [ -n "$MSG" ] || { echo "safe-commit: need -F or -m" >&2; usage; }
  [ "${#PATHS[@]}" -gt 0 ] || { echo "safe-commit: need at least one path after --" >&2; usage; }

  # A backtick in a -m body is command-substituted by the shell before we ever see it; the
  # message that lands is not the message written (bash-environment.md). Force -F.
  case "$MSG" in *'`'*) echo "safe-commit: REFUSED — backtick in -m body; use -F <file>" >&2; exit 1 ;; esac

  # A declared `*` or `?` is a git GLOB to the `git add` below, which stages every modified match (a
  # peer's unstaged edit included), and Gate 1 then refuses it anyway (it compares plain strings), with
  # those matches left staged (arm AF). Refuse before anything is staged. `[` stays allowed: 181 tracked
  # paths carry `[locale]`-style segments and 0 carry `*` or `?` (2026-10-24).
  for _sc_p in "${PATHS[@]}"; do
    case "$_sc_p" in *'*'*|*'?'*)
      echo "safe-commit: REFUSED — '$_sc_p' carries a glob character; nothing was staged." >&2
      echo "  Declare the FILES (git diff --cached --name-only --no-renames -- '<glob>' after a quoted git add)." >&2
      exit 1 ;;
    esac
  done

  # FIRE LEDGER (2026-08-25). OBSERVABILITY ONLY, never a gate: the
  # commit-row rule class had no falsifier — nobody could say whether its rewrites changed
  # outcomes. rc!=0 = refusal, rc=0 = commit (sha recorded). Fail-open by design: a ledger
  # append must never block a commit, so the whole group is || true. Consumers: the
  # outcome reads that ask whether those rewrites changed anything.
  # ${VAR%%-*} on an UNSET var is an unbound-variable abort under `set -u` on bash >=4 (3.2 lets it
  # through), so derive the prefix through :- once, here, for the ledger and the pause guard.
  SC_SID8="${CLAUDE_CODE_SESSION_ID:-}"; SC_SID8="${SC_SID8%%-*}"
  SC_LEDGER="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/logs/safe-commit-fires.jsonl"
  sc_ledger_exit() {
    _rc=$?
    { mkdir -p "$(dirname "$SC_LEDGER")"
      printf '{"ts":"%s","rc":%s,"mode":"%s","npaths":%s,"add":"%s","del":"%s","sha":"%s","sid":"%s"}\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$_rc" "$([ "$STAGED_MODE" -eq 1 ] && echo staged || echo normal)" \
        "${#PATHS[@]}" "${EXP_ADD:-}" "${EXP_DEL:-}" \
        "$([ "$_rc" -eq 0 ] && git rev-parse --short HEAD 2>/dev/null || echo '')" \
        "$SC_SID8" >> "$SC_LEDGER"; } 2>/dev/null || true
  }
  trap sc_ledger_exit EXIT

  # PAUSE MARKER (2026-10-08). pause/SKILL.md § While paused: a pause means NO COMMIT OF ANY
  # KIND until the resume. WARN-MODE per warn-before-block: the commit
  # proceeds and the fire is logged to .claude/logs/safe-commit-pause-fires.jsonl (an ATTEMPT: it
  # is written before the gates, so join on ts+sid with safe-commit-fires.jsonl for rc and sha).
  # Keyed on the COMMITTING seat's own marker only — a peer's pause binds the peer. The enter
  # ceremony's work-order commit lands BEFORE the marker is written (pause/SKILL.md enter step 5)
  # and never trips it. The RESUME's commits DO trip it: resume step 4 verifies and commits the
  # banked hand-backs and step 5 only then clears the marker, so every resume with a banked
  # hand-back logs fires that are not breaches. NO BLOCK-MODE while that order stands — a refusal
  # here would refuse the resume itself. Promotion trigger: the first fire that is not a resume
  # step-4 commit; then move the marker clear ahead of step 4 and promote per session-cadence.md
  # § PROMOTING WARN -> BLOCK. Self-test arms C1-C4 pin the warn and its log row, a peer's silence, no-sid silence and a capped reader;
  # the session prefix is derived once above the fire-ledger trap, `:-` included (bash 4+ aborts on an unset var under set -u).
  SC_PAUSE_WARN=0
  SC_PAUSE_MARKER="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/state/session-pause-${SC_SID8}"
  if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && [ -f "$SC_PAUSE_MARKER" ]; then
    SC_PAUSE_BODY="$(head -c 160 "$SC_PAUSE_MARKER" 2>/dev/null | tr -d '\n"\\' || true)"
    # The two WARN lines print AFTER the commit, beside the sha line: printed here, a caller's
    # `2>&1 | head -1` SIGPIPE-killed the script at its next pre-commit echo and no commit landed.
    SC_PAUSE_WARN=1
    { mkdir -p "$(dirname "$SC_LEDGER")"
      printf '{"ts":"%s","sid":"%s","marker":"%s"}\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$SC_SID8" "$SC_PAUSE_BODY" \
        >> "$(dirname "$SC_LEDGER")/safe-commit-pause-fires.jsonl"; } 2>/dev/null || true
  fi

  # --staged: you already hand-staged (hash-object -w + update-index --cacheinfo). Do NOT
  # `git add` — that re-reads the worktree and undoes the isolation. Gate 2 is load-bearing HERE.
  # Default: we stage for you. Gate 2 is then a DETECTOR (did someone write between the add
  # and the gate?), not the control — the control is the bare commit below, which cannot take
  # an unstaged write at all. Previously this comment called the residual "sub-second"; it fired.
  # Record each declared path's index entry BEFORE `git add`, so a REFUSAL can undo the
  # tool's own side effect. Gate 1 must run AFTER `git add` (it compares staged vs declared),
  # so every refusal used to leave the caller's paths sitting in the shared index — the tool
  # that exists to prevent index sweeps was arming one on every refusal, and it deadlocked
  # two seats tonight (my refusal left my file staged, which blocked the peer whose staged
  # file had caused my refusal). Undoing OUR OWN add on YOUR OWN paths is not the "never
  # repairs" principle weakening: that principle is about never touching state that is not
  # yours, and nothing here touches a foreign path.
  # HEAD AT RUN START, READ *BEFORE* PRE_INDEX (2026-10-05).
  # A peer's bare commit can sweep the paths our `git add` just staged; Gate 1
  # then refuses, and restoring PRE_INDEX writes back the PRE-change blob of every swept path — a
  # staged REVERT of the commit that just landed, which the next bare commit ships (measured
  # 2026-10-03: six files, the cached diff the exact inverse of the sweeping commit). unstage_ours compares
  # this to HEAD at restore time. The ORDER is load-bearing: a commit landing between the two reads
  # then leaves PRE_INDEX holding the NEW entries (restoring those reverts nothing); read the other
  # way round it would leave HEAD looking unmoved over a PRE_INDEX that is pre-commit.
  SC_H0="$(git rev-parse -q --verify HEAD 2>/dev/null || true)"
  # core.quotePath=false: ls-files C-quotes a non-ASCII path ("caf\303\251.txt"), the exact-path awk
  # below then misses it, and the restore falls to `git rm --cached` = a staged DELETION of a tracked file.
  PRE_INDEX="$(git -c core.quotePath=false ls-files --stage -- "${PATHS[@]}" 2>/dev/null || true)"
  # Every other git verb below reads a declared path LITERALLY: `[...]` is still a glob to git (arm AK).
  LPATHS=("${PATHS[@]/#/:(literal)}")
  unstage_ours() {
    if [ "$STAGED_MODE" -eq 1 ]; then
      # A blob a peer commit SWEPT is no longer staged, so "STILL IN THE SHARED INDEX" would be false; say what happened.
      if git diff --cached --quiet HEAD -- "${LPATHS[@]}" 2>/dev/null; then
        _sc_h1="$(git rev-parse -q --verify HEAD 2>/dev/null || true)"
        echo "safe-commit: nothing is staged for your paths any more (HEAD ${SC_H0:0:9} -> ${_sc_h1:0:9})." >&2
        [ "$_sc_h1" = "$SC_H0" ] || echo "  HEAD MOVED DURING THIS RUN — whose commit took them: git log --oneline ${SC_H0:0:9}..${_sc_h1:0:9} -- <paths>" >&2
        return 0
      fi
      # --staged: the caller staged deliberately, so we must NOT unstage it. But the index is
      # per-REPO — a blob left here is takeable by ANY peer's bare commit, and that is measured,
      # not hypothetical (one commit shipped another seat's row under this seat's message).
      echo "safe-commit: ⚠️  YOUR HAND-STAGED BLOB IS STILL IN THE SHARED INDEX." >&2
      # Deliberately does NOT re-offer --drift-ok. This is the LAST line the caller reads, and
      # the drift refusal above has just told them to check for a stale baseline first; a
      # trailing "--drift-ok if the drift is deliberate" here hands back the one-sided framing
      # that gate just split apart (belt-and-braces defeating the isolation).
      # unstage_ours has THREE call sites (Gate 1, Gate 2, Gate 3) and only Gate 2 prints the
      # CAUSES block, so an unconditional "see the CAUSES above" points two of the three at a
      # decision table that was never rendered — worst on the Gate 3 paths, which are already
      # asking "read them; whose are they?". Gate the pointer on the flag the block itself sets.
      if [ "$CAUSES_PRINTED" -eq 1 ]; then
        echo "  Two exits, no third: commit it, or unstage it — see the CAUSES above for which." >&2
      else
        echo "  Two exits, no third: commit it, or unstage it." >&2
      fi
      echo "  A blob left here is takeable by any peer's bare commit." >&2
      return 0
    fi
    local pth mode sha left="" h1 moved="" e0 eh swept="" movedpre=""
    h1="$(git rev-parse -q --verify HEAD 2>/dev/null || true)"
    if [ -n "$SC_H0" ] && [ -n "$h1" ] && [ "$h1" != "$SC_H0" ]; then moved=1; fi
    for pth in "${PATHS[@]}"; do
      mode="$(printf '%s\n' "$PRE_INDEX" | awk -F'\t' -v f="$pth" '$2==f {split($1,a," "); print a[1]}')"
      sha="$(printf '%s\n'  "$PRE_INDEX" | awk -F'\t' -v f="$pth" '$2==f {split($1,a," "); print a[2]}')"
      if [ -n "$moved" ]; then
        # HEAD MOVED SINCE RUN START. "mode sha" of the path at run-start HEAD and at HEAD now; empty
        # = absent. A path whose pre-run index entry EQUALS its run-start HEAD entry was NOT staged
        # before this run, so "undo our own add" means "not staged" — index = HEAD, and HEAD is now
        # the NEW one. If a commit since run start changed the path, the pre-run blob is the OLD
        # content (or, for a new file, an absence the restore would stage as a DELETION): reset to
        # the new HEAD instead. A path untouched by that commit falls through to the restore below.
        e0="$(git ls-tree "$SC_H0" -- "$pth" 2>/dev/null | awk '{print $1" "$3}' || true)"
        eh="$(git ls-tree "$h1" -- "$pth" 2>/dev/null | awk '{print $1" "$3}' || true)"
        if [ "$e0" != "$eh" ]; then
          # A DIRECTORY pathspec has no exact PRE_INDEX entry, so it always reads "not pre-staged" and
          # `git reset -- <dir>` would unstage children the caller staged and the commit never took.
          if [ "$e0" = "$(printf '%s' "$mode${sha:+ $sha}")" ] && [ "${e0%% *}" != 040000 ] && [ "${eh%% *}" != 040000 ]; then
            # :(literal) — every git verb in this restore takes a DECLARED path, and git reads `*`, `?` and
            # `[...]` in a pathspec as a glob: `x[1].txt` also resets a staged `x1.txt` (arm AC).
            git reset -q -- ":(literal)$pth" 2>/dev/null || true
            swept="$swept    $pth"$'\n'
            continue
          fi
          # pre-staged by the caller: restored below, and NAMED with its blob so a later reset is undoable.
          # Skip when the pre-run entry IS the new HEAD's (a commit landed between the SC_H0 and PRE_INDEX
          # reads): restoring it is a no-op and the warning would name a pre-stage that never happened.
          [ "$(printf '%s' "$mode${sha:+ $sha}")" = "$eh" ] || movedpre="$movedpre    $pth  (pre-run entry: ${mode:-absent} ${sha:-})"$'\n'
        fi
      fi
      if [ -n "$mode" ] && [ -n "$sha" ]; then
        # --add: our own `git add` of a path deleted on disk REMOVED its entry, and without --add git
        # refuses to re-create it (rc 128, "missing --add option?"), the `|| true` hides that, and the
        # deletion stays staged under an "ALREADY STAGED BEFORE THIS RUN" warning (arm AE).
        git update-index --add --cacheinfo "$mode,$sha,$pth" 2>/dev/null || true
      else
        # ⛔ NO `-r`, DELIBERATELY — REVERTED 2026-08-13 within minutes of adding it. `-r` was
        # applied untested and it is DESTRUCTIVE on a DIRECTORY pathspec.
        # PRE_INDEX is keyed on the EXACT path, so a declared dir `d` never matches (entries are
        # `d/a.txt`, …) and falls to this branch. With `-r`, `git rm -r --cached -- d` evicts EVERY
        # entry under d — including tracked files the caller never touched — leaving them staged
        # as DELETIONS (measured: `D  d/a.txt`, file present on disk, committed at base). On a
        # shared index the next bare commit by any seat commits that deletion. Without `-r` the
        # rm simply fails and the caller's own pre-staged dir survives — which is CORRECT: they
        # staged it, so leaving it and warning is the intended behaviour, not a bug.
        # The real dir fix is a per-entry restore from PRE_INDEX, not a wholesale rm — filed.
        # :(literal) for the same reason, the GLOB form of it: a declared `d/*.md` has no exact PRE_INDEX
        # entry either, and as a plain pathspec this rm evicted every match (16 of 16, arm AD).
        git rm -q --cached --force -- ":(literal)$pth" 2>/dev/null || true
      fi
    done
    # SAY IT WAS A SWEEP. The Gate 1 text above reads like an ordinary staged-set mismatch, and the
    # caller's next question is "where did my change go" — answer it with the range that holds it.
    if [ -n "$swept" ]; then
      echo "safe-commit: HEAD MOVED DURING THIS RUN (${SC_H0:0:9} -> ${h1:0:9}) AND A COMMIT TOOK THESE DECLARED PATHS:" >&2
      printf '%s' "$swept" >&2
      echo "  Their index entries were RESET TO THE NEW HEAD, not restored to the pre-run blob: that blob is" >&2
      echo "  the PRE-change content, so restoring it would stage a REVERT of the commit for the next bare" >&2
      echo "  commit to ship. Whose commit took them: git log --oneline ${SC_H0:0:9}..${h1:0:9} -- <paths>" >&2
      echo "  If it carries your change, nothing is left to commit for these paths; read git diff HEAD -- <paths>." >&2
    fi
    if [ -n "$movedpre" ]; then
      echo "safe-commit: WARN -- HEAD MOVED OVER THESE PRE-STAGED PATHS DURING THIS RUN (${SC_H0:0:9} -> ${h1:0:9}):" >&2
      printf '%s' "$movedpre" >&2
      echo "  Their pre-run entries were restored and may now REVERT that commit. Read" >&2
      echo "  git diff --cached HEAD -- <path>; if it undoes the commit, unstage: git reset -q -- <path>" >&2
      echo "  (undo that reset: git update-index --add --cacheinfo <mode>,<blob>,<path> with the pre-run entry above)" >&2
    fi
    # THE RESTORE IS TO PRE-INVOCATION STATE, NOT TO HEAD. A path the CALLER had already staged
    # is restored INTO the shared index and LEFT there -- the same state the --staged branch above
    # spends three lines warning about, and until now this branch said nothing. SILENCE IS THE
    # DEFECT: staging is a SIDE EFFECT of `git mv` and `git rm`, so the caller has no model that
    # they staged anything, and the natural post-refusal check reads EMPTY here *because* the path
    # is still staged (`git diff --numstat` is the worktree plane; index==worktree after a restore)
    # -- it confirms the opposite of what it is read as saying. Measured 2026-08-12: a `git mv`
    # endpoint survived a Gate 1 refusal in silence and a peer bare commit took it minutes later.
    # Assert the STATE after the restore rather than a remembered flag: that IS the exposed set.
    for pth in "${PATHS[@]}"; do
      git diff --cached --quiet HEAD -- ":(literal)$pth" || left="$left    $pth"$'\n'
    done
    [ -n "$left" ] || return 0
    echo "safe-commit: WARN -- DECLARED PATHS WERE ALREADY STAGED BEFORE THIS RUN AND REMAIN IN THE SHARED INDEX:" >&2
    printf '%s' "$left" >&2
    echo '  This tool undoes only its OWN `git add`; `git mv`/`git rm` stage as a SIDE EFFECT.' >&2
    echo '  These are YOURS -- both exits are open: commit them, or unstage them.' >&2
    echo '  A blob left here is takeable by any peer bare commit.' >&2
  }
  [ "$STAGED_MODE" -eq 1 ] || git add -- "${LPATHS[@]}"

  # GATE 1 — foreign PATHS. Compare the staged set to the declared set.
  # core.quotePath=false: name-only C-quotes a non-ASCII path ("caf\303\251.txt") while
  # DECLARED holds it as typed, so without it a staged café.txt never equals its own
  # declaration and the gate refuses every such commit (arm AA).
  STAGED="$(git -c core.quotePath=false diff --cached --name-only --no-renames | sort)"
  DECLARED="$(printf '%s\n' "${PATHS[@]}" | sort -u)"
  if [ "$STAGED" != "$DECLARED" ]; then
    echo "safe-commit: REFUSED — staged set != declared set." >&2
    FOREIGN="$(comm -23 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$DECLARED"))"
    MISSING="$(comm -13 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$DECLARED"))"
    # TWO distinct conditions. Reporting only the first one describes the wrong failure
    # when the real cause is "nothing to stage" — measured 2026-08-07: a peer committed the
    # file between the append and the commit, STAGED was EMPTY, and the tool printed
    # "foreign staged paths:" followed by nothing. Correct refusal, wrong diagnosis.
    # ⛔ DO NOT RESTORE THE WORD "someone else" HERE (2026-08-13). This line read
    # "FOREIGN staged paths (someone else staged these)" and asserted a PEER-NOUN AS FACT at
    # the exact decision moment — against the repo's most-enforced discipline (uncommitted =
    # NO git author; never write a peer-noun without whose-edit THIS turn). git cannot
    # attribute a staged path, and the index is per-REPO, so the commonest real cause is your
    # OWN previous safe-commit run leaving its declared paths staged after a refusal
    # (--staged mode deliberately does NOT unstage on refusal). MEASURED IN-SESSION: a seat
    # read this line, believed it, and routed itself into the expensive peer-collision ladder
    # (don't unstage · don't commit bare · don't hold · disclose) for its own leftover.
    # Say what git KNOWS — the paths are staged and undeclared — and let the reader attribute.
    [ -n "$FOREIGN" ] && { echo "  UNDECLARED staged paths (staged by SOMEONE — could be your own" >&2
                           echo "  previous run's leftover; git cannot attribute a staged path):" >&2
                           printf '%s\n' "$FOREIGN" | sed 's/^/    /' >&2; }
    [ -n "$MISSING" ] && { echo "  DECLARED but NOT staged — nothing to commit for these." >&2
                           echo "  Usually: a peer already committed your change, the file is unmodified," >&2
                           echo "  OR you passed --staged with nothing staged (a prior refusal auto-unstages)." >&2
                           printf '%s\n' "$MISSING" | sed 's/^/    /' >&2
                           echo "  Check: git log -1 -S '<your text>' -- <path>" >&2; }
    echo "  If you DECLARED A DIRECTORY: this gate compares FILE paths, so a directory can never" >&2
    echo "  match -- every staged file reads foreign and the directory reads missing, which mimics a" >&2
    echo "  peer collision. Expand it (git diff --cached --name-only --no-renames -- <dir>) and declare the FILES." >&2
    echo "  If you passed ':(literal)...' pathspec magic: git add honors it, this gate string-compares" >&2
    echo "  PLAIN paths -- declare the plain path; keep :(literal) for git diff/show." >&2
    echo "  NOT repairing. Unstage them yourself (record their blob SHAs first:" >&2
    echo "    git ls-files --stage -- <path>)   then re-run." >&2
    unstage_ours
    exit 1
  fi

  # GATE 2 — foreign CONTENT inside your own paths. Empty diff => index == worktree.
  # ⛔ IN --staged MODE A DELIBERATE index!=worktree IS THE WHOLE POINT, and this gate
  # refused it — measured 2026-08-07, mid-wrap, on the exact hazard --staged exists for.
  # The peer-isolation recipe is: hand-stage a blob EXCLUDING a peer's worktree lines, then
  # commit. That leaves index != worktree BY DESIGN, so a bare refusal here blocks the
  # correct move and pushes you back toward `git add`, which is the sweep. Gate 2 still
  # earns its keep (it catches "you hand-staged, then edited your own file again, and the
  # commit would miss it") — it just cannot tell that case from deliberate exclusion, so the
  # caller acknowledges with --drift-ok rather than the tool guessing.
  DRIFT="$(git diff --numstat -- "${LPATHS[@]}")"
  if [ -n "$DRIFT" ] && [ "$STAGED_MODE" -eq 1 ] && [ "$DRIFT_OK" -eq 1 ]; then
    echo "safe-commit: index!=worktree ACKNOWLEDGED (--drift-ok) — deliberate isolation:" >&2
    printf '%s\n' "$DRIFT" | sed 's/^/    /' >&2
    DRIFT=""
  fi
  if [ -n "$DRIFT" ]; then
    echo "safe-commit: REFUSED — index and worktree disagree for your paths." >&2
    printf '%s\n' "$DRIFT" | sed 's/^/    /' >&2
    echo "  Someone wrote in the window. Re-read the diff before committing." >&2
    # ⛔ TWO CAUSES, ONE MESSAGE, OPPOSITE ACTIONS — measured 2026-08-10, one keystroke from a
    # peer-commit revert. The old text named only (a), so a seat in case (b) reads its own
    # deliberate exclusion in the description and overrides correctly-by-its-own-lights. A
    # hand-staged blob is PINNED to the HEAD it was built against and DECAYS the moment a peer
    # commits; --drift-ok then reverts that commit. The gate cannot tell the cases apart — it
    # sees index!=worktree either way — so the message must, and it must lead with the check.
    if [ "$STAGED_MODE" -eq 1 ]; then
      # FIVE causes on TWO INDEPENDENT AXES (was THREE until 2026-09-05, while commit-doctrine.md
      # enumerated (a)-(e); the seat mid-refusal reads THIS, not the doctrine, so the message was two
      # causes behind the rule it implements — the same completeness defect the note below describes).
      # The two-cause version of this message shipped
      # 2026-08-10 and was broken by review the same evening: cause (c) SATISFIES clause (a)
      # WORD-FOR-WORD, so a seat that verified every clause carefully still destroyed work.
      # Measured end-to-end: peer hand-stages the same path -> your blob is gone from the index
      # -> --drift-ok commits THEIR content under YOUR message and your row lands in NO commit
      # (`git log --all -S <your row>` -> 0, unrecoverable). Gate 1 is blind by construction
      # (it compares path SETS and the peer wrote a path you DECLARED); Gate 3 is blind because
      # the direction is ADDITIVE (delete column 0). An exhaustive-LOOKING message is worse than
      # a one-sided one: the one-sided text made no completeness claim, so a seat in state (c)
      # had no sentence telling them they were covered. Hence: name the AXES, not just the causes.
      QP="$(printf '%q ' "${PATHS[@]}")"
      echo "  FIVE CAUSES ON TWO AXES — --drift-ok is right for ONE. Check BOTH axes first:" >&2
      echo "    AXIS 1 · DID HEAD MOVE?          compare the HEAD you built the blob against with:" >&2
      echo "                                     git rev-parse HEAD" >&2
      echo "                                     ⛔ NOT 'git log -1 -- ${QP}' — that reads the path's last" >&2
      echo "                                     commit AND HEAD both at CHECK time, so whenever the tip IS" >&2
      echo "                                     that commit it prints one sha twice and reads NO-DRIFT however" >&2
      echo "                                     stale your blob is. Refuted 2026-09-02; capture H0 at build." >&2
      echo "    AXIS 2 · IS THE INDEX STILL YOURS?" >&2
      for _p in "${PATHS[@]}"; do
        echo "                                     git show :$(printf '%q' "$_p")" >&2
      done
      echo "    (c) CONCURRENT ISOLATOR — a peer hand-staged the SAME path. There is ONE index per" >&2
      echo "        repo, so their update-index REPLACED your blob. --drift-ok then commits THEIR" >&2
      echo "        content under YOUR message and yours reaches no commit at all. AXIS 2 shows" >&2
      echo "        your content missing. This state satisfies (a)'s wording exactly — check axis 2." >&2
      echo "    (b) STALE BASELINE — a peer COMMITTED since you built your blob, so --drift-ok" >&2
      echo "        REVERTS that commit. AXIS 1 newer than your hash-object => unstage, re-derive" >&2
      echo "        against the new HEAD, re-run." >&2
      echo "    (d) CONTEXT INFLATION — a peer edited lines ADJACENT to your hunk, so the STAGED" >&2
      echo "        numstat exceeds your declared pair while BOTH axes pass. Tell: the excess is" >&2
      echo "        exactly +1/-1 on a file a peer also holds dirty. Read the staged -U0 diff," >&2
      echo "        not the pair. --drift-ok is NOT the answer here." >&2
      echo "    (e) YOUR BLOB IS GONE — not stale, not swapped, ABSENT. A peer's private-index" >&2
      echo "        commit ends in 'git reset -- <their paths>', and on a path you BOTH declared" >&2
      echo "        that reset re-points your index entry to HEAD; it cannot tell its own residue" >&2
      echo "        from your gate-passing blob. AXIS 2 shows nothing. Loss is PROVENANCE and" >&2
      echo "        effort, never content — the worktree was never touched, so re-stage and re-run." >&2
      echo "    (a) DELIBERATE EXCLUSION — you left out a peer's UNCOMMITTED worktree lines, AXIS 1" >&2
      echo "        has NOT moved, AND AXIS 2 still shows YOUR content. Only with all three of" >&2
      echo "        THOSE true — not merely with a refusal in hand:" >&2
      echo "        re-run with --drift-ok." >&2
      CAUSES_PRINTED=1
    fi
    unstage_ours
    exit 1
  fi

  # GATE 3 — DELETE-COLUMN. The one gate that is REACHABLE IN DEFAULT MODE, and the one
  # that would have caught the commit that motivated it (4 deletions where the edit accounted for 1).
  # Gate 2 compares index-vs-worktree, which `git add` makes identical by construction in
  # default mode — so it is structurally silent exactly when you are not hand-staging.
  # This compares STAGED-vs-HEAD, which `git add` cannot flatten. Deletions above what your
  # own edit produces are somebody else's lines: a stale read-modify-write, a whole-file
  # snapshot restore that reverted peer commits, or a sweep. Declare yours with --del N.
  # BOTH COLUMNS, because they fail differently and only one of them ever complains.
  # A DELETED discrepancy destroys a peer's line — loud, someone notices. An ADDED
  # discrepancy commits a peer's work under YOUR message: nothing downstream breaks, so it
  # is never noticed, and git permanently records the wrong author. Measured 2026-08-07,
  # one commit after this gate shipped with only the delete half: a commit took 8 lines of
  # a peer's row under a message about withdrawing my own.
  ACT_DEL="$(git diff --cached --numstat HEAD -- "${LPATHS[@]}" | awk '{s+=$2} END {print s+0}')"
  ACT_ADD="$(git diff --cached --numstat HEAD -- "${LPATHS[@]}" | awk '{s+=$1} END {print s+0}')"
  gate_col() {   # $1=label $2=actual $3=declared $4=diff-prefix $5=flag $6=verb
    [ "$2" = "$3" ] && return 0
    echo "safe-commit: REFUSED — $1 $2, declared $3." >&2
    echo "  Lines this commit would $6 (read them; whose are they?):" >&2
    # `|| true` IS LOAD-BEARING, and it is the SAFE use of it: we are already inside the refusal
    # branch, so this pipeline is DISPLAY, never a gate — it launders no decision. Without it, an
    # ACTUAL count of 0 makes the grep match nothing, exit 1, and `set -euo pipefail` kills the
    # script MID-REFUSAL: measured 2026-08-09, `--del 999` against 0 real deletions printed two
    # lines and died, skipping the "re-run with" guidance, the derived pair, AND `unstage_ours` —
    # so the caller's paths stayed in the shared index. That is precisely the arming-on-refusal
    # this function's own header says "deadlocked two seats tonight", alive on the zero-count path.
    git diff --cached -U0 HEAD -- "${LPATHS[@]}" | grep "^$4" | grep -v "^$4$4$4" | cut -c1-140 | sed 's/^/    /' >&2 || true
    echo "  If they are all yours, re-run with $5 $2." >&2
    # BOTH numbers, because ONE is not enough to finish. Deletions gate first and exit, so a
    # commit wrong on both columns costs two round trips: you learn --del, fix it, re-run, THEN
    # meet --add. Worse, the pair is UNGUESSABLE from the staged content: git pairs a delete with
    # an add as a RENAME only when BOTH endpoints are in the pathspec, so the same staged tree
    # reports +254/-306 over 4 paths and +1010/-200 over 3 (measured 2026-08-09, prompt-engineer
    # memory roll — an 86% rename). Three attempts across two dirs before the
    # contract was satisfiable. Both values are already computed above to refuse; printing them
    # turns an unguessable contract into a copy-paste. Zero change to what the gate ALLOWS.
    echo "  Derived pair for THIS pathspec:  --add $ACT_ADD --del $ACT_DEL" >&2
    echo "  ⚠ Both move if you change the pathspec (rename pairing) — declare the SAME paths you commit." >&2
    unstage_ours
    exit 1
  }
  gate_col deletions "$ACT_DEL" "$EXP_DEL" - --del REMOVE
  # ADDITIONS ARE OPT-IN, and the asymmetry is deliberate rather than a compromise:
  # almost every honest commit ADDS lines and almost none DELETE them, so a default-on
  # add-gate refuses the simplest correct commit — measured, it broke both BASELINE GREEN
  # arms, i.e. the positive control this harness rests on. A gate that cannot pass its own
  # baseline is not strict, it is broken. So: print the number unconditionally (the sweep
  # that motivated this was silent, not unstoppable — I never looked at +8/-0), and offer
  # --add N when you want it enforced.
  # ⚠️ --add would NOT have caught that sweep on its own, because I would not have passed it.
  # What catches an additive sweep on a MANY-WRITER file is --staged: hand-stage your own
  # blob so `git add` never re-reads a worktree holding someone else's uncommitted lines.
  #
  # ⛔ AND THE SWEEP IS NOT ALWAYS SILENT — N=2, TWO SHAPES, AND THE SECOND ONE STRENGTHENS THE
  # CASE FOR --staged RATHER THAN FOR PRINTING HARDER (measured 2026-08-08, disclosed by the
  # committer against their own interest). The line above generalises from the first instance,
  # where the number was never surfaced. The second is the other shape: this script PRINTED
  # `staged +140/-4` and the committer READ it — as a RECEIPT confirming the commit went
  # through, not as a figure to reconcile. ~37 of those 140 were a peer's uncommitted
  # row, committed under an unrelated subject. Delete column was 1 and fully theirs, so the
  # deletions gate (correctly) said nothing.
  #   SILENT           — no gate ran, the number never reached a human
  #   DISPLAYED-UNREAD — the number was in the success line and was read
  # So "surface it more loudly" is refuted by the second instance: it was already in the line
  # being read to confirm success. And on a MULTI-FILE commit the printed total is not
  # eyeball-reconcilable — 52+50+38 across three files requires knowing your own per-file
  # expectation and summing it, which is arithmetic nobody does at commit time. --staged
  # removes the need for the arithmetic instead of asking for more of it.
  [ -n "$EXP_ADD" ] && gate_col additions "$ACT_ADD" "$EXP_ADD" + --add ADD
  echo "safe-commit: staged +$ACT_ADD/-$ACT_DEL for ${PATHS[*]}" >&2

  # GATE 4 — PARSE THE STAGED BLOBS. Gates 1-3 read path SETS and line COUNTS; none reads
  # CONTENT, and `tsc`/`.githooks/pre-push` both compile the WORKTREE. In --staged mode the
  # index deliberately differs from the worktree, so NOTHING reads the bytes being committed:
  # one commit shipped a `const` spliced between a declaration and its initializer, and
  # another shipped 99 parse diagnostics (repaired). Runs in BOTH modes on purpose
  # — index==worktree only means tsc COULD have seen these bytes, never that anyone re-ran it.
  # Syntax only (no tsconfig, no resolution): 0 findings over all 2,871 tracked .ts/.tsx/.mts/
  # .mjs files in 2.77 s, which is what licenses BLOCK rather than warn. Controls:
  # `node scripts/staged-parse-check.mjs --self-test`.
  # Key the list on the STAGED SET (added/copied/modified/renamed), never on the declared
  # paths alone: a declared path that is a DELETION has no staged blob, `git rev-parse :path`
  # exits 128, and the checker's rc=2 read as "the STAGED bytes do not parse" — a false
  # message pointing at re-staging the file you just removed. Found 2026-09-05 on the
  # commit that shipped this gate; the sibling in private-index-commit.sh had
  # the ACMR filter from the start.
  SC_PARSE=()
  _SC_STAGED_ACMR="$(git -c core.quotePath=false diff --cached --name-only --diff-filter=ACMR)"
  for _p in "${PATHS[@]}"; do
    case "$_p" in *.ts|*.tsx|*.mts|*.mjs) ;; *) continue;; esac
    # HERE-STRING, never `printf … | grep -q` (pipefail): past ~64 KB of staged paths printf dies of
    # SIGPIPE after an early match and the path silently leaves GATE 4 (same defect as
    # run-changed-e2e.sh's selector).
    grep -Fxq -- "$_p" <<< "$_SC_STAGED_ACMR" && SC_PARSE+=("$_p")
  done
  if [ "${#SC_PARSE[@]}" -gt 0 ]; then
    _SCP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/staged-parse-check.mjs"
    [ -f "$_SCP" ] || { echo "safe-commit: REFUSED — staged-parse-check.mjs missing ($_SCP); ${#SC_PARSE[@]} TS path(s) staged and unread." >&2; unstage_ours; exit 1; }
    node "$_SCP" --staged "${SC_PARSE[@]}" || { echo "safe-commit: REFUSED — GATE 4, the STAGED bytes do not parse. Nothing was committed." >&2; unstage_ours; exit 1; }
  fi

  # BARE in BOTH modes. `--only`/`-o` RE-READS THE WORKTREE at commit time, so any gate
  # that ran before it checked a plane the commit does not use — a peer keystroke in that
  # window lands regardless. Measured 2026-08-07: a correct same-command gate
  # read 1 deletion and the commit took 6. A bare commit takes the INDEX; there is no
  # re-read, so a worktree write cannot land. Gate 1 is what makes index-wide safe.
  # SESSION PROVENANCE — auto-injected by design; the caller is never asked for it.
  # A `Claude-Session:` trailer convention already existed, documented in three places and
  # enforced nowhere; it decayed to 3 of 163 commits (1.8%) in the 24h before this shipped,
  # against 34.2% lifetime. A DOCUMENTED-UNENFORCED convention is what decays — so this adds
  # nothing to anyone's checklist and stamps it at the one choke point every seat passes.
  # WHAT IT ANSWERS, AND THE TWO HALVES IT DOES NOT.
  # ⛔ IT RECORDS WHO RAN `git commit` **ONLY WHEN THE MESSAGE BODY IS SILENT** — the flat
  # claim was wrong and is corrected here (re-verified locally):
  # `ifExists=doNothing` means a PRE-EXISTING trailer WINS. Body carrying `<body-sid>` with env
  # sid `<env-sid>` records **<body-sid>**, rc=0, one line. That is the right semantics — a
  # deliberate manual value should not be silently overwritten — but it means the field is a
  # DEFAULT, not a guarantee, and a templated or copied body propagates a foreign sid.
  # `ifExists=replace` would guarantee the runner at the cost of discarding intent; kept
  # doNothing deliberately.
  # ⛔ AND IT CANNOT SETTLE AUTHORSHIP — not a hypothetical, it already happened. On the day
  # this shipped, a four-seat attribution dispute cited trailer base rates as evidence about
  # who AUTHORED a commit; correctly hedged as weak, and cited anyway. On this shared index a
  # commit routinely sweeps a peer's uncommitted lines (the whole reason Gate 1 exists), so
  # this field PARTITIONS and never IDENTIFIES. Under pressure a reader reaches for whatever
  # field exists, which is precisely why the limit is written next to the thing that writes it.
  # `bash-environment.md`'s ranked-instrument list still governs content attribution.
  # What it does replace is the /summary "N mine" floor, which greps the author's own
  # transcript for git's confirmation line and is destroyed by `-q`, a `| tail`, or a stdout
  # redirect — three measured self-inflicted holes, ~16% miss across 112 transcripts.
  # SAFETY, all four verified in a scratch repo before this landed:
  #   · unset/empty CLAUDE_CODE_SESSION_ID  -> no trailer, commit proceeds, rc=0
  #   · `--trailer` JOINS the existing trailer block (lands after Co-Authored-By), not a new one
  #   · ifExists=doNothing makes it IDEMPOTENT — a message already carrying the trailer keeps
  #     ITS value; without that config the same message gets two Claude-Session lines
  #   · the arrays are expanded `${A[@]+"${A[@]}"}` because this script is `set -euo pipefail`
  #     on bash 3.2, where a bare "${A[@]}" on an EMPTY array is an unbound-variable error —
  #     i.e. the unguarded form would have failed every commit made without a session id.
  # Read it back per commit with: git log -1 --format='%(trailers:key=Claude-Session,valueonly)'
  SC_GITCFG=(); SC_TRAILER=()
  if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    SC_GITCFG=(-c trailer.Claude-Session.ifExists=doNothing)
    SC_TRAILER=(--trailer "Claude-Session: ${CLAUDE_CODE_SESSION_ID%%-*}")
  fi
  # ---- THE SHA IS THE LAST LINE WE PRINT, AND IT IS PARSED, NEVER RE-QUERIED ----------
  # `git commit` prints `[main <sha>] <subject>` then ` N files changed…`, so the ONE line
  # that unambiguously identifies THIS seat's commit is not the last one — and the house
  # habit of reading a command's tail (`| tail -1`) therefore keeps the stat line and EATS
  # the sha. Measured 2026-09-08: a seat did exactly that, re-derived the sha with
  # `git log -1 --format=%h`, a peer committed in the 39-second gap, and the peer's commit
  # was named as its own in outbound mail to a third session.
  # ⛔ PARSED FROM THE LINE GIT JUST PRINTED — NOT `git rev-parse HEAD`, NOT `git log -1`.
  # On a branch every seat commits to, a second query re-reads a MOVING ref: any peer commit
  # landing between our `git commit` returning and our read hands us THEIR sha, with nothing
  # to distinguish it. Re-querying only narrows that window; parsing the confirmation line
  # closes it, because git printed that line for OUR commit object and no later event can
  # change what it says. Same reason `private-index-commit.sh` echoes its own `$C`.
  # ⛔ `[^]]*`, NOT `.*` — BRE `.*` is GREEDY, so on a subject that itself cites a sha and a
  # bracket (`[main <sha-A>] see <sha-B>] …`, and this repo's subjects DO cite shas) it
  # backtracks to the LAST ` <hex>]` on the line and reports <sha-B>: a wrong sha, i.e. the
  # exact failure this block exists to remove, reintroduced by the regex meant to fix it.
  # Measured on all three real confirmation shapes — `[main <sha>]`, `[main (root-commit)
  # <sha>]`, `[detached HEAD <sha>]` — plus that adversarial subject: `[^]]*` cannot cross the
  # first `]`, so it is right on all four where `.*` is wrong on the fourth.
  # ⛔ THE CAPTURE MUST RE-EMIT ON THE FAILURE PATH TOO. "git prints the confirmation to
  # stdout and errors to stderr" is FALSE for the commonest failure: measured, a
  # nothing-staged refusal writes its ENTIRE diagnostic ("nothing added to commit…") to
  # STDOUT at rc=1, while a missing `-F` file (rc=128) and a blocking hook (rc=1) use stderr.
  # So a bare `$( )` under `set -e` would abort with a CORRECT exit code and a SILENT
  # terminal. `set +e` around the capture, re-print whatever git said, then exit git's own
  # status — which is what `set -e` did before, so the failure path keeps its rc and its
  # message. stderr is never captured and keeps flowing live.
  # ⛔ THE TWO `git … commit` LINES STAY AT COLUMN-START, IN A FUNCTION, ON PURPOSE.
  # `.claude/orchestrator/commit-doctrine.md` tells every seat to verify this tool's
  # "commits BARE in both modes, carries no `-o`/`--only`" claim by running
  #   grep -nE '^[[:space:]]*git .*commit ' scripts/safe-commit.sh
  # and READING the lines. Writing the capture as `SC_COMMIT_OUT="$(git … commit …)"` moves the
  # literal off column-start, and that grep then returns ONLY the two self-test FIXTURE lines —
  # measured, both production lines gone — so an always-loaded safety claim silently becomes
  # unverifiable while the check still prints a plausible non-empty result. That clause has
  # already taken one false zero of exactly this shape (the doctrine records it: the literal
  # `git commit`, split by the array expansion, read 0). Hoisting the invocation into a function
  # keeps the instrument returning the same two lines AND lets the caller capture stdout.
  sc_run_commit() {
    if [ -n "$MSGFILE" ]; then
      git ${SC_GITCFG[@]+"${SC_GITCFG[@]}"} commit ${SC_TRAILER[@]+"${SC_TRAILER[@]}"} -F "$MSGFILE"
    else
      git ${SC_GITCFG[@]+"${SC_GITCFG[@]}"} commit ${SC_TRAILER[@]+"${SC_TRAILER[@]}"} -m "$MSG"
    fi
  }
  set +e
  SC_COMMIT_OUT="$(sc_run_commit)"
  SC_CRC=$?
  set -e
  # Git's own lines, verbatim and in order, BEFORE anything of ours — every existing consumer
  # of this output keeps reading exactly what it read before, at the same position.
  if [ -n "$SC_COMMIT_OUT" ]; then printf '%s\n' "$SC_COMMIT_OUT"; fi
  if [ "$SC_CRC" -ne 0 ]; then
    # A git-level failure AFTER the gates (a HEAD ref-lock race, a commit hook) skips unstage_ours,
    # so the declared paths stay in the shared index. Say so at the moment it happens.
    # Name the paths: a peer commit can sweep some of them, and a --staged re-run naming a swept
    # path then fails Gate 1 on it.
    _sc_left=""
    for _p in "${PATHS[@]}"; do
      git diff --cached --quiet HEAD -- "$_p" 2>/dev/null || _sc_left="$_sc_left    $_p"$'\n'
    done
    if [ -n "$_sc_left" ]; then
      echo "safe-commit: NOT COMMITTED (git rc=$SC_CRC) and these declared paths are STILL STAGED in the shared index:" >&2
      printf '%s' "$_sc_left" >&2
      echo "  Read git diff --cached -U0 -- <paths>, then re-run with --staged (same message, paths, --del/--add)," >&2
      echo "  or unstage with git reset -q -- <paths>. An identical default re-run re-adds the worktree." >&2
    fi
    exit "$SC_CRC"
  fi
  if [ "$SC_PAUSE_WARN" = 1 ]; then
    echo "safe-commit: WARN -- THIS SEAT IS PAUSED: ${SC_PAUSE_MARKER##*/} exists (${SC_PAUSE_BODY})." >&2
    echo "safe-commit: WARN -- a pause means no commit of any kind until the resume (pause/SKILL.md § While paused). Warn-mode: committed anyway; this fire is logged." >&2
  fi
  SC_SHA="$(printf '%s\n' "$SC_COMMIT_OUT" | sed -n 's/^\[[^]]*[[:space:]]\([0-9a-f]\{7,40\}\)\].*/\1/p')"
  # Validate before printing: empty (no match) and multi-line (two matches — the embedded
  # newline is a non-hex byte, so this case rejects too) both fall to the marked fallback.
  # A silent empty `committed ` would read as a sha nobody can see is missing.
  case "$SC_SHA" in
    ""|*[!0-9a-f]*) SC_SHA="" ;;
    *) [ ${#SC_SHA} -ge 7 ] && [ ${#SC_SHA} -le 40 ] || SC_SHA="" ;;
  esac
  if [ -n "$SC_SHA" ]; then
    echo "safe-commit: committed $SC_SHA"
  else
    echo "safe-commit: committed — SHA UNPARSED, read it from git's own line above; do NOT"
    echo "             re-derive it with 'git log -1' on a shared branch (that is the race)."
  fi
  exit 0
fi

# ---------------------------------------------------------------- self-test
# Every arm states its EXPECTED rc before running. The first arm is a BASELINE
# GREEN: a positive control on the DETECTOR itself, so a harness that can never
# report success cannot report every gate as working (the oracle-half trap).
# basename, NOT a hardcoded name: the codified mutation procedure copies a mutant BESIDE the
# original and runs it. With the name hardcoded, the harness resolved back to the PRISTINE
# sibling while every arm reported on it — a 17/0 banked over a gutted warning (2026-08-13).
# Any self-invoking harness that resolves its target by NAME makes mutant-on-a-copy vacuous.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cd "$T"; git init -q .; git config user.email t@t; git config user.name t
echo base > mine.txt; echo base > theirs.txt
git add -A; git commit -qm init
PASS=0; FAIL=0
# Per-run capture file. Was a FIXED global /tmp/sc-out until 2026-08-10 — fine while it was
# display-only, not fine once an arm GATES on its contents: two seats self-testing this script
# at once share the path, and the collision window opens exactly when two people review it
# concurrently, which is the situation that produced this fix. Under the existing EXIT trap.
SC_OUT="$(mktemp -t sc-out)"; trap 'rm -rf "$T"; rm -f "$SC_OUT"' EXIT
run() { set +e; "$SELF" "$@" >"$SC_OUT" 2>&1; RC=$?; set -e; }
# `sed` on a missing capture file exits 1 and, under `set -euo pipefail`, kills the runner
# before the summary line — the same class this file already guards at the derived-pair check.
ck() { if [ "$RC" = "$1" ]; then PASS=$((PASS+1)); echo "  PASS $2 (rc=$RC)";
       else FAIL=$((FAIL+1)); echo "  FAIL $2 — expected rc=$1 got $RC"; sed 's/^/      /' "$SC_OUT" || true; fi; }
# `ck` reads the RETURN CODE and nothing else, so it is structurally incapable of asserting
# WHAT was printed. The sha-emission arms below are content assertions; routing them through
# `ck` would report an rc that is not the thing under test. `-F` is load-bearing — the
# `[<branch> <sha>]` needle opens with `[`, a BRE bracket expression, which under `grep -q`
# alone matches nothing and yields a clean, plausible, permanent PASS-by-absence inversion.
ckout() { if grep -qF "$1" "$SC_OUT"; then PASS=$((PASS+1)); echo "  PASS $2";
          else FAIL=$((FAIL+1)); echo "  FAIL $2 — '$1' absent from output"; sed 's/^/      /' "$SC_OUT" || true; fi; }

echo "safe-commit --self-test"
echo one >> mine.txt
run -m "clean case" -- mine.txt;                    ck 0 "BASELINE GREEN: clean single path commits"

echo two >> mine.txt; echo peer >> theirs.txt; git add theirs.txt
run -m "should refuse" -- mine.txt;                 ck 1 "RED: foreign staged path refused"
git restore --staged theirs.txt; git checkout -- theirs.txt

# drift: stage, then write again so index != worktree for MY path
run -m "should refuse" -- ;                         ck 2 "RED: no paths after -- is a usage error"

# GATE 2, in the mode where it can actually fire: hand-stage, then dirty the worktree.
echo three >> mine.txt; git add mine.txt; echo four >> mine.txt
run --staged -m "should refuse" -- mine.txt;        ck 1 "RED: --staged + index!=worktree refused"
git add mine.txt
run --staged -m "staged and clean" -- mine.txt;     ck 0 "GREEN: --staged with index==worktree commits"

# --staged + DELIBERATE drift (the peer-isolation recipe). Gate 2 refused this until
# 2026-08-07, i.e. it blocked the exact move --staged exists for and pushed the caller
# back to `git add`, which is the sweep.
echo five >> mine.txt; git add mine.txt; echo peerline >> mine.txt
run --staged -m "drift unacknowledged" -- mine.txt;   ck 1 "RED: --staged drift still refuses without --drift-ok"
# The refusal MESSAGE is itself the control here (measured 2026-08-10: a seat read its own
# deliberate exclusion in a one-sided description and was one keystroke from --drift-ok
# reverting a peer's commit). rc alone cannot see a message that collapses back to one case,
# so assert BOTH causes by name. Mutation: delete either echo -> this arm REDs, rc stays 1.
# ⛔ ASSERT THE PAIRING, NOT THE PRESENCE. A labels-present check passes under a mutant that
# SWAPS the two labels — which renders "(b) STALE BASELINE — you left out a peer's UNCOMMITTED
# worktree lines … Only then: --drift-ok", i.e. the 2026-08-10 incident restored under a green
# self-test — and under one that keeps all labels and guts every remedy line.
# ⛔ AND THE OBVIOUS DISCRIMINATOR IS A SUPERSTRING TRAP: bare `COMMITTED` matches `UNCOMMITTED`
# on the (a) line too, so `STALE BASELINE.*COMMITTED` stays GREEN under the swap — the naive
# implementation of the correct fix fails exactly the way the bug does. Clean tokens, verified
# at 1 occurrence each: `COMMITTED since` and `left out`. Trade-off, stated: this arm is now
# sensitive to those two phrases, so a legitimate reword REDs it — loudly and self-naming,
# which is the direction to fail in.
# The axis assertions key on the HEADERS' distinctive text, not on the token `AXIS 2` — that
# token also appears inside the (c) and (a) cause lines, so a presence check on it survives
# deleting the header entirely (measured GREEN). Presence-on-a-repeated-token is the same
# weakness this arm exists to close, reproduced inside the fix for it. And the two COMMAND
# tokens are what make a keep-the-labels-gut-the-guidance mutant RED.
if grep -q 'STALE BASELINE.*COMMITTED since' "$SC_OUT" \
   && grep -q 'DELIBERATE EXCLUSION.*left out' "$SC_OUT" \
   && grep -q 'CONCURRENT ISOLATOR.*hand-staged the SAME path' "$SC_OUT" \
   && grep -q 'CONTEXT INFLATION.*ADJACENT' "$SC_OUT" \
   && grep -q 'YOUR BLOB IS GONE.*ABSENT' "$SC_OUT" \
   && grep -q 'DID HEAD MOVE' "$SC_OUT" \
   && grep -q 'IS THE INDEX STILL YOURS' "$SC_OUT" \
   && grep -q 'git rev-parse HEAD' "$SC_OUT" \
   && grep -q "NOT 'git log -1" "$SC_OUT" \
   && grep -q 'git show :' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS RED-message: all FIVE causes PAIRED with their own remedies + both axes named"
else
  FAIL=$((FAIL+1)); echo "  FAIL RED-message: each cause must be PAIRED with its own remedy (STALE BASELINE/COMMITTED since · DELIBERATE EXCLUSION/left out · CONCURRENT ISOLATOR/same path · CONTEXT INFLATION/ADJACENT · YOUR BLOB IS GONE/ABSENT) + AXIS 2"; sed 's/^/      /' "$SC_OUT" || true
fi
run --staged --drift-ok -m "drift ack" -- mine.txt;   ck 0 "GREEN: --drift-ok commits the staged blob only"

printf 'seven\n' >> mine.txt
run -m 'has a \`backtick\`' -- mine.txt;            ck 1 "RED: backtick in -m body refused"

# GATE 3 — the delete column. The arms above only ever APPEND, so they cannot witness
# this gate: adding it left PASS unchanged at 6, which is the tell that the fixture set
# was drawn from the guard's own habits rather than from the obligation.
# Fixture is a real DELETION, which is the shape a stale write or a snapshot-restore makes.
git checkout -- mine.txt 2>/dev/null || true
printf 'a\nb\nc\n' > mine.txt; git add mine.txt; git commit -qm "three lines"
printf 'a\nc\n' > mine.txt                       # removes exactly one line
run -m "undeclared deletion" -- mine.txt;           ck 1 "RED: deletion without --del refused"
run --del 1 -m "declared deletion" -- mine.txt;     ck 0 "GREEN: deletion matching --del commits"
printf 'a\n' > mine.txt                            # removes one MORE than declared
run --del 0 -m "understated" -- mine.txt;           ck 1 "RED: --del understates actual deletions"

# ADDED column. Fails silently by construction — an additive sweep breaks nothing downstream,
# so nothing complains and git records the wrong author permanently.
printf 'a\nZ\n' > mine.txt                          # one added line, one deleted
run --del 1 --add 9 -m "wrong add" -- mine.txt;     ck 1 "RED: --add mismatch refused"
run --del 1 --add 1 -m "both declared" -- mine.txt; ck 0 "GREEN: both columns declared commits"

# A REFUSAL MUST NOT LEAVE YOUR PATHS STAGED. Gate 1 runs after `git add`, so before this
# fix every refusal armed the exact index sweep the tool exists to prevent — and deadlocked
# two seats: one refusal left a file staged, which caused the peer's refusal.
git checkout -- mine.txt 2>/dev/null || true
echo peer2 >> theirs.txt; git add theirs.txt          # foreign staged path -> Gate 1 refuses
echo eight >> mine.txt
run -m "will refuse" -- mine.txt;                   ck 1 "RED: foreign path still refuses"
STAGED_AFTER="$(git diff --cached --name-only -- mine.txt)"
# The warn-ABSENCE conjunct is load-bearing and was missing: my own M2 mutated whether the ARM
# demands the state (a decorative-arm check); it never tested whether the WARN demands it (a
# FALSE-POSITIVE check). Deleting `[ -n "$left" ] || return 0` passed 17/0 while the warn fired
# on every default-mode refusal with an EMPTY path list — three independent green
# mutants (2026-08-13). Here the path was NOT pre-staged, so the warn MUST be silent.
if [ -z "$STAGED_AFTER" ] && ! grep -q 'ALREADY STAGED BEFORE THIS RUN' "$SC_OUT" 2>/dev/null; then PASS=$((PASS+1)); echo "  PASS GREEN: refusal left MY path unstaged, and the pre-staged warn correctly stayed SILENT (rc=n/a)";
else FAIL=$((FAIL+1));
  # Split so the RED NAMES which conjunct spoke — a shared else branch reports both failures
  # identically, and a mutation reading is void unless the message names the assertion it hit.
  if [ -n "$STAGED_AFTER" ]; then echo "  FAIL refusal left mine.txt staged — arms an index sweep";
  else echo "  FAIL the pre-staged warn FIRED on a path that was never pre-staged — false positive; the conditionality guard is gone"; fi
fi
git restore --staged theirs.txt; git checkout -- theirs.txt 

# A path the CALLER staged BEFORE the run is RESTORED to that state, not removed -- the tool
# undoes only its own `git add` -- so it stays in the SHARED index and the caller must be TOLD.
# The --staged branch has warned about this state since it shipped; the DEFAULT branch was
# silent, and the silence is the defect: `git mv`/`git rm` stage as a SIDE EFFECT, so the caller
# has no model that they staged anything. Measured 2026-08-12: a `git mv` endpoint survived a
# Gate 1 refusal unmentioned and a peer bare commit took it. Asserts BOTH halves -- the path
# really IS still staged, AND the refusal named it -- so deleting either the restore or the
# warning REDs this arm. Adding it moved PASS 16 -> 17; an unchanged count would have meant the
# fixture set was drawn from the guard's own habits (the tell this file already records at GATE 3).
git checkout -- mine.txt 2>/dev/null || true
echo nine >> mine.txt; git add mine.txt                # CALLER pre-stages their OWN path
echo peer3 >> theirs.txt; git add theirs.txt           # foreign path -> Gate 1 refuses
run -m "will refuse" -- mine.txt
if [ "$RC" = 1 ] && [ -n "$(git diff --cached --name-only -- mine.txt)" ] \
   && grep -q 'ALREADY STAGED BEFORE THIS RUN' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS GREEN: refusal NAMED the caller's pre-staged path left in the index"
else
  FAIL=$((FAIL+1)); echo "  FAIL pre-staged path left in the shared index, unmentioned"; sed 's/^/      /' "$SC_OUT" || true
fi
git restore --staged theirs.txt mine.txt; git checkout -- theirs.txt mine.txt

# SESSION-PROVENANCE TRAILER (2026-08-17). TWO arms, because the two failure modes are
# opposite and only one of them is visible in rc. A broken injection is SILENT — rc=0, a
# missing trailer, nothing to notice until a later /summary under-reports its own work. A
# broken empty-array guard is the reverse: bash 3.2 under `set -u` errors on "${A[@]}" when
# A is EMPTY, so the unguarded spelling fails EVERY commit made without a session id — which
# is every human invocation and every cron. Arm B is that control, and it is the reason this
# is not a one-arm test: the dangerous mutation is invisible to Arm A.
# Both arms are DISCRIMINATING rather than merely failing: dropping `--trailer` leaves Arm A
# reading empty where it wants `aaaaaaaa`, and dropping the `[@]+` guard leaves Arm B non-zero
# where it wants 0. `run()` cannot serve here — it inherits the caller's environment, and the
# whole point of Arm B is an environment the caller does not have.
git checkout -- mine.txt 2>/dev/null || true
echo ten >> mine.txt
set +e; CLAUDE_CODE_SESSION_ID='aaaaaaaa-<uuid-rest>' "$SELF" \
  -m "trailer arm" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
SC_TRV="$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
if [ "$RC" = 0 ] && [ "$SC_TRV" = "aaaaaaaa" ]; then
  PASS=$((PASS+1)); echo "  PASS GREEN: session id prefix stamped as a Claude-Session trailer"
else
  FAIL=$((FAIL+1)); echo "  FAIL trailer arm — rc=$RC value='$SC_TRV' (want rc=0, value=aaaaaaaa)"; sed 's/^/      /' "$SC_OUT" || true
fi

# Arms C1/C2 — the pause-marker warn (2026-10-08). C1: the committing seat's OWN marker fires the
# warn and the commit still lands (warn-mode, rc 0). C2: ANOTHER seat's marker is silent — the
# false-positive arm, and the one a "simplify to any marker" refactor would break while C1 stays
# green. The marker lives under the repo toplevel, which here is the scratch repo.
SC_PSID=aaaaaaaa   # the paused seat's visibly-fake 8-hex id; the fire-log needle is built from it below, never spelled out
mkdir -p .claude/state; echo "0 deadbeef resume=owner wo=none builders=none" > ".claude/state/session-pause-$SC_PSID"
echo pausedA >> mine.txt
set +e; CLAUDE_CODE_SESSION_ID="$SC_PSID-<uuid-rest>" "$SELF" \
  -m "paused seat arm" -- mine.txt 2>"$SC_OUT" >/dev/null; RC=$?; set -e
if [ "$RC" = 0 ] && grep -q 'THIS SEAT IS PAUSED' "$SC_OUT" \
   && grep -qF "\"sid\":\"$SC_PSID\"" .claude/logs/safe-commit-pause-fires.jsonl 2>/dev/null; then
  PASS=$((PASS+1)); echo "  PASS GREEN: the committing seat's pause marker WARNS and the commit still lands (warn-mode)"
else
  FAIL=$((FAIL+1)); echo "  FAIL pause arm C1 — rc=$RC (want rc=0, the warn on STDERR, a fire-log row)"; sed 's/^/      /' "$SC_OUT" || true
fi
echo pausedB >> mine.txt
set +e; CLAUDE_CODE_SESSION_ID='bbbbbbbb-<uuid-rest>' "$SELF" \
  -m "peer paused arm" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 0 ] && ! grep -q 'THIS SEAT IS PAUSED' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS GREEN: another seat's pause marker is SILENT for this seat's commit"
else
  FAIL=$((FAIL+1)); echo "  FAIL pause arm C2 — rc=$RC (want rc=0 and NO pause warn for a peer's marker)"; sed 's/^/      /' "$SC_OUT" || true
fi
: > .claude/state/session-pause-; echo pausedC >> mine.txt   # C3: no sid must never match an empty-sid marker
set +e; env -u CLAUDE_CODE_SESSION_ID "$SELF" -m "no sid, empty-sid marker" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 0 ] && ! grep -q 'THIS SEAT IS PAUSED' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS GREEN: no session id never reads a session-pause- marker"
else
  FAIL=$((FAIL+1)); echo "  FAIL pause arm C3 — rc=$RC (want rc=0, no warn)"; sed 's/^/      /' "$SC_OUT" || true
fi
echo pausedD >> mine.txt; SC_HD=$(git rev-parse HEAD)   # C4: a capped reader must not kill the commit
set +e; CLAUDE_CODE_SESSION_ID="$SC_PSID-<uuid-rest>" "$SELF" -m "paused, capped reader" -- mine.txt 2>&1 | head -1 >/dev/null; set -e
if [ "$(git rev-parse HEAD)" != "$SC_HD" ]; then
  PASS=$((PASS+1)); echo "  PASS GREEN: the pause warn under '2>&1 | head -1' still lets the commit land (no SIGPIPE kill)"
else
  FAIL=$((FAIL+1)); echo "  FAIL pause arm C4 — HEAD unmoved: the warn's SIGPIPE killed the script before the commit"; git reset -q -- mine.txt; git checkout -q -- mine.txt
fi
rm -rf .claude

# Arm B COUNTS THE LINE, and the earlier spelling could not. It read
# %(trailers:key=…,valueonly), which is EMPTY both for "no trailer" and for "a trailer whose
# VALUE is empty" — so the plausible simplifying refactor (always append, let an empty sid
# through) kept this arm green while every human and cron commit gained a junk bare
# `Claude-Session:` line. Aiming note worth keeping: the mutant that
# breaks BOTH arms is caught by Arm A for an unrelated reason, so only the mutant that
# PRESERVES Arm A's expected value exposes this one.
echo eleven >> mine.txt
set +e; env -u CLAUDE_CODE_SESSION_ID "$SELF" \
  -m "no sid arm" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
set +e; SC_NOV=$(git log -1 --format='%B' | grep -c '^Claude-Session:'); set -e
if [ "$RC" = 0 ] && [ "$SC_NOV" = 0 ]; then
  PASS=$((PASS+1)); echo "  PASS GREEN: no session id -> ZERO trailer lines, commit still succeeds (bash-3.2 empty-array guard)"
else
  FAIL=$((FAIL+1)); echo "  FAIL unset-sid arm — rc=$RC trailer-lines=$SC_NOV (want rc=0 and ZERO lines)"; sed 's/^/      /' "$SC_OUT" || true
fi

# IDEMPOTENCY had NO arm at first: deleting the SC_GITCFG assignment left
# --self-test at 19/0 GREEN while every message gained a SECOND Claude-Session line. And the
# exposure is wider than the original comment claimed — git's default is
# addIfDifferentNeighbor, not "skip if present", so the duplicate appears even for the SAME
# value once any other trailer sits between it and the end. A Co-Authored-By line does exactly
# that, and it is this repo's standard message shape, so the default would duplicate on the
# COMMON path rather than an exotic one. Verified both halves here before folding.
# The arm asserts ONE line AND that the BODY's value won, which is what makes it discriminate:
# a count-only check passes under a mutant that swaps the config for ifExists=replace.
printf 'twelve\n' >> mine.txt
cat > "$T/sc_idem.txt" <<'IDEM'
body already carries a foreign session id

Claude-Session: <body-sid>
Co-Authored-By: Someone <s@s>
IDEM
set +e; CLAUDE_CODE_SESSION_ID='cccccccc-<uuid-rest>' "$SELF" \
  -F "$T/sc_idem.txt" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
set +e; SC_IDN=$(git log -1 --format='%B' | grep -c '^Claude-Session:'); set -e
SC_IDV="$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
if [ "$RC" = 0 ] && [ "$SC_IDN" = 1 ] && [ "$SC_IDV" = "<body-sid>" ]; then
  PASS=$((PASS+1)); echo "  PASS GREEN: a body that already carries the trailer keeps ITS value, exactly once"
else
  FAIL=$((FAIL+1)); echo "  FAIL idempotency arm — rc=$RC lines=$SC_IDN value='$SC_IDV' (want rc=0, 1 line, <body-sid>)"; sed 's/^/      /' "$SC_OUT" || true
fi

# ---- NON-8-HEX PRE-EXISTING VALUE — the arm the idempotency arm above cannot be ----------
# The arm above pins `<body-sid>`, a stand-in for an 8-hex seat id, so it asserts preservation while
# remaining blind to the question that matters: is the preserved value SHAPED like a seat id?
# It is not, on a real and recurring slice of commits. SOME seats' system prompts instruct them to
# end commit messages with a `Claude-Session: <a claude.ai code-session URL>` footer — NOT every
# seat, which is the correction: a reviewing peer read its own prompt and found only a
# Co-Authored-By line, so it is a live counter-example. Measured over the last 400 commits instead
# of asserted: 195 8-hex, 21 URL-form, 0 other — the shape is real at ~10%. The ifExists=doNothing
# config above deliberately lets a hand-written value WIN — so a seat following the harness's
# own instruction ships a URL where a consumer expects 8 hex characters.
# This arm CHARACTERISES that: the URL form is preserved verbatim and is NOT a seat id.
# ⛔ It deliberately does NOT assert a fix. `doNothing` is correct semantics (a deliberate
# hand-written value should win) and flipping to `replace` would be the wrong repair. The
# defect is that nothing validates SHAPE — so any future consumer MUST parse defensively
# rather than compare exactly. As of 2026-08-19 there is no live consumer of this value:
# /summary's exact-8-hex compare was retired, and band-growth-decomposition.mjs
# carries a comment refusing to use it for attribution. This arm exists so the next consumer
# author meets the real contract instead of inferring it from the idempotency fixture.
printf 'thirteen\n' >> mine.txt
cat > "$T/sc_urlform.txt" <<'URLF'
body carries the harness-suggested footer, not a seat id

Claude-Session: https://<host>/code/<code-session-id>
Co-Authored-By: Someone <s@s>
URLF
set +e; CLAUDE_CODE_SESSION_ID='dddddddd-<uuid-rest>' "$SELF" \
  -F "$T/sc_urlform.txt" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
set +e; SC_UN=$(git log -1 --format='%B' | grep -c '^Claude-Session:'); set -e
SC_UV="$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
# The discriminating pair: the URL survived (doNothing held) AND it is not 8-hex (so an exact
# compare against a seat id would read ZERO for this commit — a confident, wrong zero).
case "$SC_UV" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) SC_USHAPE=hex8 ;;
  *) SC_USHAPE=not-hex8 ;;
esac
if [ "$RC" = 0 ] && [ "$SC_UN" = 1 ] && [ "$SC_USHAPE" = "not-hex8" ] && [ "$SC_UV" != "dddddddd" ]; then
  PASS=$((PASS+1)); echo "  PASS GREEN: a URL-form trailer is preserved and is NOT a seat id — consumers must parse, never compare"
else
  FAIL=$((FAIL+1)); echo "  FAIL url-form arm — rc=$RC lines=$SC_UN shape=$SC_USHAPE value='$SC_UV' (want rc=0, 1 line, not-hex8, env sid NOT stamped)"; sed 's/^/      /' "$SC_OUT" || true
fi

# ── GATE 4 — the parse gate over the STAGED blobs ───────────────────────────
# The 21 arms above stage only .txt, so every one of them SKIPS gate 4 — without
# these two the gate would be wired and unexercised, which reads as coverage.
# RED uses the --staged shape deliberately: it is the mode where index!=worktree
# is legitimate and therefore the mode where nothing else reads the bytes.
# MUTATION: delete the gate-4 block and the RED arm goes green.
printf 'export const a = 1;\n' > good.ts
git add good.ts; git commit -qm "seed a parseable ts"
# RED — hand-stage a BROKEN blob (the `git apply --cached` shape) and commit it
# with --staged --drift-ok, the exact combination that shipped the unparseable commit.
printf 'export const a = 1;\nconst b: number =\nconst c = 1;\n' > /tmp/sc-broken.$$
BLOB="$(git hash-object -w /tmp/sc-broken.$$)"; rm -f /tmp/sc-broken.$$
git update-index --cacheinfo 100644,"$BLOB",good.ts
run -m "gate4 red" --staged --drift-ok --add 2 -- good.ts
ck 1 "RED: --staged commits a blob that does not parse -> GATE 4 refuses"
# :3 is MEASURED, not guessed — the parser reports the unexpected `const`, which
# is line 3, not the incomplete declaration on line 2. A line pin is what makes
# this arm more than "some text was printed".
if grep -q 'good.ts:3:' "$SC_OUT"; then PASS=$((PASS+1)); echo "  PASS GATE 4 names the file AND the line (good.ts:3)"
else FAIL=$((FAIL+1)); echo "  FAIL GATE 4 must name good.ts:3"; sed 's/^/      /' "$SC_OUT" || true; fi
# GREEN — the control that must come out the other way, same mode, same flags.
git checkout -q -- good.ts 2>/dev/null || true
printf 'export const a = 1;\nexport const b = 2;\n' > /tmp/sc-good.$$
BLOB2="$(git hash-object -w /tmp/sc-good.$$)"; rm -f /tmp/sc-good.$$
git update-index --cacheinfo 100644,"$BLOB2",good.ts
run -m "gate4 green" --staged --drift-ok --add 1 -- good.ts
ck 0 "GREEN: --staged commits a blob that DOES parse"
# GREEN — a declared DELETED .ts path has NO staged blob; GATE 4 must skip it, not read
# `git rev-parse :good.ts` rc=128 as "the STAGED bytes do not parse" (found 2026-09-05:
# every retire/rename of a .ts file was refused with a message pointing at
# re-staging the file just removed). MUTATION: restore the declared-paths list build and
# this arm goes rc=1.
rm -f good.ts
run -m "gate4 deleted ts" --del 2 -- good.ts
ck 0 "GREEN: a declared DELETED .ts path is skipped by GATE 4 (list keyed on the staged ACMR set)"
# RED — a broken .ts staged beside ~170 KB of other paths. GATE 4 builds its list with an
# early-exit grep over the staged path list; as `printf … | grep -Fxq` under pipefail, printf
# died of SIGPIPE once the paths after the match passed the ~64 KB pipe buffer and the .ts
# silently left the gate. The .ts sorts FIRST so every other staged path follows the match.
# MUTATION: restore the pipe and this arm commits (rc=0).
mkdir -p zz; SC_LONG="$(printf 'x%.0s' $(seq 1 200))"
for SC_I in $(seq 1 800); do : > "zz/$SC_I-$SC_LONG"; done
printf 'export const a = 1;\nconst b: number =\nconst c = 1;\n' > aa-big.ts
run -m "gate4 big list" --add 3 -- aa-big.ts zz/*
ck 1 "RED: a broken .ts staged beside ~170 KB of other paths is still parsed by GATE 4"
rm -rf zz aa-big.ts

# ── THE SHA IS THE LAST LINE WE PRINT ───────────────────────────────────────
# The fix exists to serve the `| tail -1` habit, so "the sha line exists" is NOT the
# assertion — "the sha line is LAST" is, and arm C is the only one that tests it. Arm C also
# pins the sha to THIS commit, which is the point of parsing git's printed line rather than
# re-querying a ref every seat is moving.
# ⛔ ARM D MUST SURVIVE THE MUTATION AND THE OTHERS MUST NOT. Deleting the
# `safe-commit: committed` emission REDs B and C; D is the REGRESSION guard for every
# consumer that reads git's own `[<branch> <sha>]` line, so a D that also went red would mean
# it is keyed on our line instead of git's, i.e. measuring the wrong thing. Measured
# 2026-09-08: mutation out -> 27 PASS / 2 FAIL, exactly B and C, D green.
# The branch name is DERIVED, not the literal `main`: `git init` honours
# init.defaultBranch, so a hardcoded needle would fail on a `master`-defaulting clone for a
# reason unrelated to this gate. Arm D doubles as the proof that git's own abbreviation and
# `rev-parse --short` agree — arm C's equality rests on that.
git checkout -- mine.txt 2>/dev/null || true
echo fourteen >> mine.txt
run -m "sha emission" -- mine.txt;                  ck 0 "GREEN: sha-emission arm commits"
SC_HEAD_SHORT="$(git rev-parse --short HEAD)"; SC_BR="$(git rev-parse --abbrev-ref HEAD)"
ckout "safe-commit: committed " "B: the sha line is emitted at all"
SC_LAST="$(tail -1 "$SC_OUT")"
if [ "$SC_LAST" = "safe-commit: committed $SC_HEAD_SHORT" ]; then
  PASS=$((PASS+1)); echo "  PASS C: the LAST line IS the sha line and names THIS commit ($SC_HEAD_SHORT) — '| tail -1' now yields the sha"
else
  FAIL=$((FAIL+1)); echo "  FAIL C: tail -1 gave '$SC_LAST', want 'safe-commit: committed $SC_HEAD_SHORT'"; sed 's/^/      /' "$SC_OUT" || true
fi
ckout "[$SC_BR $SC_HEAD_SHORT]" "D: git's own '[$SC_BR <sha>]' line still present ahead of ours (existing consumers unbroken)"

# A git-level failure AFTER the gates leaves the declared paths staged. A pre-commit hook
# that exits 1 stands in for the HEAD ref-lock race (same code path: SC_CRC != 0 past the gates).
mkdir -p "$T/.failhooks"; printf '#!/bin/sh\nexit 1\n' > "$T/.failhooks/pre-commit"; chmod +x "$T/.failhooks/pre-commit"
git config core.hooksPath "$T/.failhooks"
echo fifteen >> mine.txt
run -m "git fails after the gates" -- mine.txt;     ck 1 "RED: a post-gate git failure exits non-zero"
ckout "STILL STAGED" "the post-gate failure says the declared paths are still staged"
git config --unset core.hooksPath; git reset -q -- mine.txt
# The real race, not a stand-in: a held ref lock is git rc=128, so this arm also pins that the
# script exits GIT's code (a hardcoded `exit 1` passes the hook arm above, whose rc is also 1).
SC_LOCK="$(git rev-parse --git-dir)/$(git symbolic-ref HEAD).lock"; : > "$SC_LOCK"
run -m "ref lock held" -- mine.txt;                 ck 128 "RED: a held ref lock exits git's own rc"
ckout "STILL STAGED" "the ref-lock failure says the declared paths are still staged"
rm -f "$SC_LOCK"; git reset -q -- mine.txt
# False-positive control: a post-gate failure that leaves the paths NOT staged must stay silent.
printf '#!/bin/sh\ngit reset -q -- mine.txt\nexit 1\n' > "$T/.failhooks/pre-commit"; git config core.hooksPath "$T/.failhooks"
run -m "fails, nothing left staged" -- mine.txt;    ck 1 "RED: post-gate failure with nothing left staged still exits non-zero"
if grep -qF "STILL STAGED" "$SC_OUT"; then FAIL=$((FAIL+1)); echo "  FAIL: STILL STAGED printed with nothing staged"; sed 's/^/      /' "$SC_OUT" || true
else PASS=$((PASS+1)); echo "  PASS: no STILL STAGED when the paths are not staged"; fi
git config --unset core.hooksPath; git reset -q -- mine.txt; git checkout -- mine.txt

# ── A PEER COMMIT LANDS BETWEEN OUR `git add` AND THE REFUSAL ──
# A `git` shim on PATH runs the real `git add`, then — once, when armed — a "peer" script: the only
# way to put a commit INSIDE this process's add→gate window without a test hook in production code.
# Arm S (the sweep): the peer commits BARE, taking our two staged paths, one of them a NEW file.
# Before the fix the refusal restored mine.txt's PRE-change blob (a staged revert) and `git rm
# --cached` fresh.txt (a staged DELETION). Both conjuncts below are what discriminate; the HEAD
# check is the control that the sweep really happened.
SC_REALGIT="$(command -v git)"; mkdir -p "$T/.sweepbin"
printf '#!/bin/sh\n"%s" "$@"; rc=$?\nif [ "$1" = add ] && [ -f "%s" ]; then mv "%s" "%s.ran"; sh "%s.ran"; fi\nexit $rc\n' \
  "$SC_REALGIT" "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" > "$T/.sweepbin/git"
chmod +x "$T/.sweepbin/git"
echo sixteen >> mine.txt; printf 'brand new\n' > fresh.txt
SC_H0T="$(git rev-parse HEAD)"
printf '"%s" commit -q -m "peer bare commit"\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" -m "swept mid-run" -- mine.txt fresh.txt >"$SC_OUT" 2>&1; RC=$?; set -e
SC_SWHEAD="$(git rev-parse HEAD)"; SC_SWTIP="$(git show HEAD:mine.txt 2>/dev/null | tail -1 || true)"
SC_SWIDX=clean; git diff --cached --quiet HEAD -- mine.txt fresh.txt || SC_SWIDX=dirty
if [ "$RC" = 1 ] && [ "$SC_SWHEAD" != "$SC_H0T" ] && [ "$SC_SWTIP" = sixteen ] && [ "$SC_SWIDX" = clean ] \
   && grep -qF 'HEAD MOVED DURING THIS RUN' "$SC_OUT" && ! grep -qF 'ALREADY STAGED BEFORE THIS RUN' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS S: a peer commit swept our staged paths -> index reset to the NEW HEAD (no staged revert), refusal names the sweep"
else
  FAIL=$((FAIL+1)); echo "  FAIL S: rc=$RC head-moved=$([ "$SC_SWHEAD" != "$SC_H0T" ] && echo y || echo n) tip='$SC_SWTIP' index-vs-HEAD=$SC_SWIDX (want rc=1, y, sixteen, clean, sweep named, no pre-staged warn)"
  git diff --cached --stat HEAD -- mine.txt fresh.txt | sed 's/^/      /' || true; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- mine.txt fresh.txt   # a RED arm S leaves a staged revert; arm U must not inherit it
# Arm U (the false-positive control): HEAD moves under a commit that does NOT touch our path, and a
# later gate refuses (--del 5 against 0). The old restore is right there; the sweep message must
# stay SILENT and our path must come out unstaged.
echo seventeen >> mine.txt; echo peer5 >> theirs.txt
SC_H0T="$(git rev-parse HEAD)"
printf '"%s" commit -q -m "peer -o commit" -o theirs.txt\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" --del 5 -m "unrelated peer commit" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
SC_SWIDX=clean; git diff --cached --quiet HEAD -- mine.txt || SC_SWIDX=dirty
if [ "$RC" = 1 ] && [ "$(git rev-parse HEAD)" != "$SC_H0T" ] && [ "$SC_SWIDX" = clean ] \
   && ! grep -qF 'HEAD MOVED' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS U: HEAD moved over OTHER paths -> plain restore, no sweep message"
else
  FAIL=$((FAIL+1)); echo "  FAIL U: rc=$RC index-vs-HEAD=$SC_SWIDX (want rc=1, HEAD moved, clean, no HEAD MOVED line)"; sed 's/^/      /' "$SC_OUT" || true
fi
git checkout -- mine.txt; rm -f "$T/.sweep-arm" "$T/.sweep-arm.ran"

# Arm V (the PRE==e0 conjunct): the caller PRE-STAGED a blob that differs from the
# worktree, then a peer bare commit sweeps. That blob is in NO commit (our `git add` overwrote it
# before the sweep), so resetting to the new HEAD would leave it dangling. It must be restored + named.
echo eighteen >> mine.txt; git add mine.txt; SC_PREB="$(git rev-parse :mine.txt)"; echo nineteen >> mine.txt
printf '"%s" commit -q -m "peer bare commit 2"\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" -m "pre-staged then swept" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 1 ] && [ "$(git rev-parse :mine.txt)" = "$SC_PREB" ] && grep -qF 'PRE-STAGED PATHS' "$SC_OUT" \
   && grep -qF "$SC_PREB" "$SC_OUT" && ! grep -qF 'A COMMIT TOOK THESE' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS V: a pre-staged blob survives a sweep (restored, named with its sha), not reset away"
else
  FAIL=$((FAIL+1)); echo "  FAIL V: rc=$RC index=$(git rev-parse :mine.txt) want $SC_PREB, PRE-STAGED warn naming it"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- mine.txt; git checkout -- mine.txt
# Arm W (directory pathspec): a NEW dir declared whole, the caller pre-staged d/keep.txt, and a peer -o
# commit takes only d/a.txt. The reset arm must not fire on the tree entry and unstage d/keep.txt.
mkdir -p d; echo k > d/keep.txt; echo a > d/a.txt; git add d/keep.txt
printf '"%s" commit -q -m "peer -o d/a" -o d/a.txt\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" -m "dir pathspec" -- d >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 1 ] && git ls-files --error-unmatch d/keep.txt >/dev/null 2>&1 && ! grep -qF 'A COMMIT TOOK THESE' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS W: a directory pathspec under a moved HEAD keeps the caller's pre-staged child"
else
  FAIL=$((FAIL+1)); echo "  FAIL W: rc=$RC d/keep.txt staged=$(git ls-files d/keep.txt | grep -c .) (want rc=1, 1, no sweep claim)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- d; rm -rf d
# Arm X (non-ASCII path, no HEAD move): a foreign staged path refuses at Gate 1; the restore must not
# stage a DELETION of the tracked non-ASCII file (ls-files C-quoting made PRE_INDEX miss it).
SC_NA="$(printf 'caf\303\251.txt')"; printf 'base\n' > "$SC_NA"; git add -- "$SC_NA"; git commit -qm nonascii
echo mine >> "$SC_NA"; echo peer6 >> theirs.txt; git add theirs.txt
run -m "should refuse" -- "$SC_NA"
if [ "$RC" = 1 ] && [ -z "$(git -c core.quotePath=false diff --cached --diff-filter=D --name-only HEAD)" ]; then
  PASS=$((PASS+1)); echo "  PASS X: a refusal on a non-ASCII path leaves no staged deletion"
else
  FAIL=$((FAIL+1)); echo "  FAIL X: rc=$RC staged deletions: $(git -c core.quotePath=false diff --cached --diff-filter=D --name-only HEAD)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- theirs.txt "$SC_NA"; git checkout -- theirs.txt "$SC_NA"
# Arm Y (the SC_H0 -> PRE_INDEX window): a peer commit lands BETWEEN the two reads, taking our path. PRE_INDEX
# then holds the NEW HEAD's entry; nothing was pre-staged, so no PRE-STAGED warning may name the path.
printf '#!/bin/sh\nif [ -f "%s" ]; then case " $* " in *" ls-files "*) mv "%s" "%s.ran"; sh "%s.ran";; esac; fi\nexec "%s" "$@"\n' \
  "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" "$SC_REALGIT" > "$T/.sweepbin/git"
echo twenty >> mine.txt
printf '"%s" commit -q -m "peer -o in the window" -o mine.txt\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" --del 7 -m "window" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 1 ] && [ -f "$T/.sweep-arm.ran" ] && git diff --cached --quiet HEAD -- mine.txt && ! grep -qF 'PRE-STAGED' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS Y: a commit between the HEAD and PRE_INDEX reads -> no false PRE-STAGED warning"
else
  FAIL=$((FAIL+1)); echo "  FAIL Y: rc=$RC peer-ran=$([ -f "$T/.sweep-arm.ran" ] && echo y || echo n)"; sed 's/^/      /' "$SC_OUT" || true
fi
rm -f "$T/.sweep-arm" "$T/.sweep-arm.ran"
# Arm Z (--staged mode, swept): the hand-staged blob is taken by a peer commit inside the run (same
# ls-files trigger as arm Y). The refusal must not claim the blob is STILL staged; it must name the move.
echo twentyone >> mine.txt; git add mine.txt
printf '"%s" commit -q -m "peer bare sweeps a hand-staged blob"\n' "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" --staged -m "staged swept" -- mine.txt >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 1 ] && [ -f "$T/.sweep-arm.ran" ] && ! grep -qF 'STILL IN THE SHARED INDEX' "$SC_OUT" && grep -qF 'HEAD MOVED DURING THIS RUN' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS Z: --staged blob swept mid-run -> no false STILL-STAGED claim, the move is named"
else
  FAIL=$((FAIL+1)); echo "  FAIL Z: rc=$RC peer-ran=$([ -f "$T/.sweep-arm.ran" ] && echo y || echo n)"; sed 's/^/      /' "$SC_OUT" || true
fi
rm -f "$T/.sweep-arm" "$T/.sweep-arm.ran"
# Arm AA (non-ASCII path, the happy path): Gate 1 must read the staged name unquoted, or a
# declared café.txt never equals the C-quoted "caf\303\251.txt" and every such commit refuses.
# MUTATION: drop -c core.quotePath=false from Gate 1's STAGED read -> this arm reds.
echo more >> "$SC_NA"
run -m "non-ascii commit" -- "$SC_NA"
if [ "$RC" = 0 ] && [ "$(git show HEAD:"$SC_NA" | grep -c '^more$')" = 1 ]; then
  PASS=$((PASS+1)); echo "  PASS AA: a declared non-ASCII path commits (Gate 1 reads it unquoted)"
else
  FAIL=$((FAIL+1)); echo "  FAIL AA: rc=$RC"; sed 's/^/      /' "$SC_OUT" || true
fi
# Arm AB (non-ASCII .ts, Gate 4): the parse list is keyed on the staged ACMR set, which must be read
# unquoted too, or a declared caf\303\251.ts never matches it, is skipped, and unparseable bytes commit:
# fail-OPEN, the opposite direction from AA's refusal. MUTATION: drop -c core.quotePath=false from
# the _SC_STAGED_ACMR read -> this arm reds (rc=0, the broken blob lands).
SC_NATS="$(printf 'caf\303\251.ts')"; printf 'export const a = 1;\nconst b: number =\nconst c = 1;\n' > "$SC_NATS"
SC_HAB="$(git rev-parse HEAD)"
run -m "non-ascii ts gate4" -- "$SC_NATS"
if [ "$RC" = 1 ] && grep -qF 'GATE 4' "$SC_OUT" && [ "$(git rev-parse HEAD)" = "$SC_HAB" ]; then
  PASS=$((PASS+1)); echo "  PASS AB: a declared non-ASCII .ts with unparseable bytes is refused by GATE 4"
else
  FAIL=$((FAIL+1)); echo "  FAIL AB: rc=$RC (want 1, GATE 4, HEAD unmoved)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- "$SC_NATS" 2>/dev/null || true; rm -f "$SC_NATS"

# ── THE RESTORE'S GIT VERBS READ A DECLARED PATH AS A PATHSPEC ──
# `[`, `*` and `?` are glob characters to git, so each verb below gets :(literal). Fixtures use a bracket
# path (`x[1].txt` globs to `x1.txt`) because a declared `*`/`?` is now refused before the add (arm AF).
printf 'x\n' > 'x[1].txt'; printf 'one\n' > x1.txt; printf 'n\n' > n1.txt; printf 'gone\n' > gone.txt
git add -- ':(literal)x[1].txt' x1.txt n1.txt gone.txt; git commit -qm brackets
# Arm AG (the left-over check): a foreign STAGED x1.txt refuses Gate 1; a plain `diff --cached -- 'x[1].txt'`
# then counts x1.txt as OURS and prints a false "ALREADY STAGED BEFORE THIS RUN" naming x[1].txt.
# MUTATION: drop :(literal) from the `left` loop's diff -> this arm reds.
echo mine >> 'x[1].txt'; echo peer7 >> x1.txt; git add x1.txt
run -m "bracket path, foreign glob sibling" -- 'x[1].txt'
if [ "$RC" = 1 ] && ! grep -qF 'ALREADY STAGED BEFORE THIS RUN' "$SC_OUT" && git diff --cached --quiet HEAD -- ':(literal)x[1].txt' \
   && ! git diff --cached --quiet HEAD -- x1.txt; then
  PASS=$((PASS+1)); echo "  PASS AG: a staged glob-sibling of a bracket path is not reported as our pre-staged path"
else
  FAIL=$((FAIL+1)); echo "  FAIL AG: rc=$RC (want 1, no ALREADY STAGED, x[1].txt unstaged, x1.txt still staged)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- ':(literal)x[1].txt' x1.txt; git checkout -q -- ':(literal)x[1].txt' x1.txt
# Arm AD (the `git rm --cached` branch, a path with no exact PRE_INDEX entry): a NEW n[1].txt refuses on
# a foreign path; a plain rm of 'n[1].txt' also evicts the tracked n1.txt, a staged DELETION.
# MUTATION: drop :(literal) from the rm -> this arm reds.
printf 'new\n' > 'n[1].txt'; echo peer8 >> theirs.txt; git add theirs.txt
run -m "new bracket path" -- 'n[1].txt'
if [ "$RC" = 1 ] && [ -z "$(git diff --cached --diff-filter=D --name-only HEAD)" ] && [ -z "$(git ls-files -- ':(literal)n[1].txt')" ]; then
  PASS=$((PASS+1)); echo "  PASS AD: a refusal on a new bracket path evicts no tracked glob sibling"
else
  FAIL=$((FAIL+1)); echo "  FAIL AD: rc=$RC staged deletions: $(git diff --cached --diff-filter=D --name-only HEAD | tr '\n' ' ')"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- n1.txt theirs.txt; git checkout -q -- theirs.txt; rm -f 'n[1].txt'
# Arm AE (the `update-index` branch): a declared path deleted on disk. Our `git add` removes its entry;
# without --add the restore fails silently, the deletion stays staged and is reported as the caller's.
# MUTATION: drop --add from `update-index --cacheinfo` -> this arm reds.
rm gone.txt; echo peer9 >> theirs.txt; git add theirs.txt
run -m "deleted path" -- gone.txt
if [ "$RC" = 1 ] && git diff --cached --quiet HEAD -- gone.txt && ! grep -qF 'ALREADY STAGED BEFORE THIS RUN' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS AE: a refusal on a deleted path restores its index entry (no staged deletion left)"
else
  FAIL=$((FAIL+1)); echo "  FAIL AE: rc=$RC status='$(git diff --cached --name-status HEAD -- gone.txt)' (want 1, '', no ALREADY STAGED)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- gone.txt theirs.txt; git checkout -q -- gone.txt theirs.txt
# Arm AF (a declared `*`): refused before the add, so a peer's UNSTAGED edit to a match is never staged.
# MUTATION: delete the glob-character refusal -> the add stages d2/b.md and leaves it staged; this arm reds.
mkdir -p d2; printf 'a\n' > d2/a.md; printf 'b\n' > d2/b.md; git add d2; git commit -qm d2
echo mine >> d2/a.md; echo peer-unstaged >> d2/b.md; echo peer10 >> theirs.txt; git add theirs.txt
run -m "glob" -- 'd2/*.md'
if [ "$RC" = 1 ] && grep -qF 'glob character' "$SC_OUT" && [ -z "$(git diff --cached --name-only -- d2)" ] && [ "$(git ls-files d2 | wc -l | tr -d ' ')" = 2 ]; then
  PASS=$((PASS+1)); echo "  PASS AF: a declared glob is refused before anything is staged"
else
  FAIL=$((FAIL+1)); echo "  FAIL AF: rc=$RC staged under d2: $(git diff --cached --name-status -- d2 | tr '\n' ' ')"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- d2 theirs.txt; git checkout -q -- d2 theirs.txt
# Arm AC (the moved-HEAD `git reset` branch): our add stages x[1].txt, a peer bare commit sweeps it and
# then stages x1.txt. Gate 1 refuses; the reset of 'x[1].txt' must not also unstage the peer's x1.txt.
# MUTATION: drop :(literal) from that reset -> this arm reds.
printf '#!/bin/sh\n"%s" "$@"; rc=$?\nif [ "$1" = add ] && [ -f "%s" ]; then mv "%s" "%s.ran"; sh "%s.ran"; fi\nexit $rc\n' \
  "$SC_REALGIT" "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" "$T/.sweep-arm" > "$T/.sweepbin/git"
echo swept >> 'x[1].txt'
printf '"%s" commit -q -m "peer sweeps x[1]"\necho peer11 >> x1.txt\n"%s" add x1.txt\n' "$SC_REALGIT" "$SC_REALGIT" > "$T/.sweep-arm"
set +e; PATH="$T/.sweepbin:$PATH" "$SELF" -m "bracket swept" -- 'x[1].txt' >"$SC_OUT" 2>&1; RC=$?; set -e
if [ "$RC" = 1 ] && [ -f "$T/.sweep-arm.ran" ] && grep -qF 'A COMMIT TOOK THESE' "$SC_OUT" && ! git diff --cached --quiet HEAD -- x1.txt; then
  PASS=$((PASS+1)); echo "  PASS AC: the sweep reset of a bracket path leaves the peer's staged glob sibling staged"
else
  FAIL=$((FAIL+1)); echo "  FAIL AC: rc=$RC peer-ran=$([ -f "$T/.sweep-arm.ran" ] && echo y || echo n) x1.txt staged=$(git diff --cached --name-only HEAD -- x1.txt | grep -c .)"; sed 's/^/      /' "$SC_OUT" || true
fi
rm -f "$T/.sweep-arm" "$T/.sweep-arm.ran"; git reset -q -- x1.txt
# Arm AH (a shard roll refused by a FOREIGN staged path): a rename done on disk, BOTH endpoints declared.
# The restore must leave the index at HEAD for rs/: the old name re-entered (needs --add), the new unstaged.
# MUTATION: drop --add from `update-index --cacheinfo` -> the old name stays a staged deletion; this arm reds.
mkdir -p rs; seq 1 40 > rs/S-old.md; git add rs; git commit -qm shard; mv rs/S-old.md rs/S-new.md
echo peer12 >> theirs.txt; git add theirs.txt
run -m "roll" -- rs/S-old.md rs/S-new.md
if [ "$RC" = 1 ] && [ -z "$(git diff --cached --name-only HEAD -- rs)" ] && [ -z "$(git ls-files -- rs/S-new.md)" ]; then
  PASS=$((PASS+1)); echo "  PASS AH: a refused shard roll leaves the index at HEAD (no staged deletion of the old name)"
else
  FAIL=$((FAIL+1)); echo "  FAIL AH: rc=$RC staged under rs: $(git diff --cached --name-status HEAD -- rs | tr '\n' ' ')"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- theirs.txt; git checkout -q -- theirs.txt
# Arm AI (Gate 1 --no-renames, the both-endpoints declaration): the same roll with no foreign path COMMITS.
# MUTATION: drop --no-renames from GATE 1 -> name-only lists only rs/S-new.md, the old name reads MISSING; this arm reds.
run -m "roll both endpoints" -- rs/S-old.md rs/S-new.md
if [ "$RC" = 0 ] && [ "$(git show --name-status --format= HEAD -- rs | cut -c1)" = R ] && [ -z "$(git status --porcelain -- rs)" ]; then
  PASS=$((PASS+1)); echo "  PASS AI: a roll declared with both endpoints commits as one rename"
else
  FAIL=$((FAIL+1)); echo "  FAIL AI: rc=$RC head=$(git show --name-status --format= HEAD -- rs | tr '\n' ' ')"; sed 's/^/      /' "$SC_OUT" || true
fi
# Arm AJ (Gate 1 --no-renames, the hiding direction): a FOREIGN staged deletion pairs as a rename with our
# NEW file, so a rename-folded name-only lists only our path and Gate 1 passes, committing the deletion.
# MUTATION: drop --no-renames from GATE 1 -> the commit lands with the peer's deletion in it; this arm reds.
seq 1 40 | sed 's/^/l /' > pd-old.md; git add pd-old.md; git commit -qm pd; git rm -q --cached pd-old.md
{ seq 1 40 | sed 's/^/l /'; echo mine; } > my-new.md
run --add 41 -m "new file beside a staged foreign deletion" -- my-new.md
if [ "$RC" = 1 ] && git cat-file -e HEAD:pd-old.md 2>/dev/null && grep -qF 'pd-old.md' "$SC_OUT"; then
  PASS=$((PASS+1)); echo "  PASS AJ: a foreign staged deletion that pairs as a rename is refused, not committed"
else
  FAIL=$((FAIL+1)); echo "  FAIL AJ: rc=$RC pd-old.md in HEAD: $(git cat-file -e HEAD:pd-old.md 2>/dev/null && echo y || echo n)"; sed 's/^/      /' "$SC_OUT" || true
fi
git reset -q -- pd-old.md my-new.md; rm -f my-new.md

# Arm AK (LPATHS: the main add, Gate 2 and the numstat read a declared path literally): a bracket path
# whose glob sibling holds a peer's UNSTAGED edit commits only the declared file.
# MUTATION: build LPATHS without :(literal) -> our add stages the sibling and Gate 1 refuses; this arm reds.
mkdir -p 'k/[id]' k/i; printf 'a\n' > 'k/[id]/p.txt'; printf 'b\n' > k/i/p.txt; git add -- ':(literal)k/[id]/p.txt' k/i/p.txt; git commit -qm k
echo mine >> 'k/[id]/p.txt'; echo peer-unstaged >> k/i/p.txt
run --add 1 -m "bracket path beside an unstaged glob sibling" -- 'k/[id]/p.txt'
if [ "$RC" = 0 ] && [ "$(git show --name-only --format= HEAD)" = 'k/[id]/p.txt' ] && [ -z "$(git diff --cached --name-only)" ] && ! git diff --quiet -- k/i/p.txt; then
  PASS=$((PASS+1)); echo "  PASS AK: a bracket path commits alone beside a glob sibling's unstaged edit"
else
  FAIL=$((FAIL+1)); echo "  FAIL AK: rc=$RC head=$(git show --name-only --format= HEAD | tr '\n' ' ') staged=$(git diff --cached --name-only | tr '\n' ' ')"; sed 's/^/      /' "$SC_OUT" || true
fi
git checkout -q -- k/i/p.txt

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
