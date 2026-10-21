#!/usr/bin/env bash
# private-index-commit.sh — commit declared paths through a PRIVATE git index.
#
# WHY THIS EXISTS. `safe-commit.sh` GATE 1 compares the WHOLE shared staged set against your
# declared paths and sits outside every mode branch, so while ANY peer holds ANY path staged it
# refuses in every mode, `--staged` included — the exact state where a hand-rolled gate is the
# only remaining option, which fleet guidance forbids. The private-index dance closes the
# foreign-PATH axis by construction (the shared index is never read, and is written only by the
# closing `git reset` on paths you declared), and `update-ref <new> <old>` is a compare-and-swap
# that FAILS rather than clobbers if a peer commits in the window.
#
# ⛔ WHAT THIS DOES NOT BUY — read this before trusting it.
#   · The foreign-CONTENT axis is UNCHANGED. `git add` re-reads the WORKTREE for your declared
#     paths, so a peer's uncommitted line inside a file you declare rides into your commit. This
#     script prints the staged diff for exactly that reason. READ IT.
#   · "The shared index is never written" holds only FOR PATHS YOU DID NOT DECLARE. The closing
#     `git reset -- <declared>` writes it for the paths you did. If a peer holds a hand-staged
#     blob on a path you ALSO declare, that reset discards their index entry — their line then
#     reads 0 in HEAD, 0 in the index, 0 in the worktree. The blob object survives unreferenced
#     and nobody will find it. That is the concurrent-isolator collision the rules already call
#     unserialisable; it needs their staging to be blob-only, and in the commoner worktree-edit
#     case nothing is destroyed (their line simply rides into your commit, per the axis above).
#   · A clean run is not evidence. Clean commits look identical under "there was no race" and
#     under "there was a race that did not fire".
#   · `commit-tree` runs NO `pre-commit` hook. Today every exit in this repo's hook is 0, so the
#     cost is missed warnings — one of which is the router-staleness arm that fires on staged
#     memory shards, i.e. exactly the shared files this recipe exists for. The hook's own header
#     plans a block-mode promotion; on that day this tool becomes a silent hole around it.
#
# HISTORY, so nobody re-derives it: shipped 2026-08-30 with `refs/heads/main` HARDCODED and zero
# branch derivation, which moved SHARED main from a feature branch or a linked worktree at rc=0
# while printing a success readout, and left the shared repo holding a staged REVERT of the commit
# that had just landed. Disarmed the same hour, fixed here.
#
# Usage:  private-index-commit.sh -F <msgfile> -- <path> [<path> ...]
#         private-index-commit.sh --self-test
set -euo pipefail

# ⛔ RESOLVED ONCE, BEFORE ANY `cd`. `$0` may be relative, and this script changes directory
# below; a LATE `dirname "$0"` then resolves against the wrong root. That is not theoretical —
# it shipped a FAIL-OPEN on the seam gate, reproduced: relative $0 from scripts/
# gave rc=0 with the payload EXECUTED, absolute $0 gave rc=2 and refused.
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
REF_MOVED=""          # set to the new sha the instant update-ref succeeds
PRIVATE_IDX_DIR=""    # the private index lives in a temp dir; the EXIT trap removes it
on_exit() {
  local rc=$?
  # The private index is scratch state by construction — it must never outlive the run, and
  # it must be cleaned on the refusal paths too, which is most of them.
  [ -n "$PRIVATE_IDX_DIR" ] && rm -rf "$PRIVATE_IDX_DIR"
  # ⛔ NEVER exit non-zero after the ref has moved without saying the ref moved. The measured
  # worst case is `.git/index.lock` held by an ordinary concurrent git command: the ref moves,
  # the reset dies, and without this the operator sees only a failure and assumes nothing landed.
  if [ "$rc" -ne 0 ] && [ -n "$REF_MOVED" ]; then
    echo "" >&2
    echo "⚠️  THE REF ALREADY MOVED — your commit IS on the branch: $REF_MOVED" >&2
    echo "    This failure happened AFTER the ref update. Do NOT re-run; the shared index may" >&2
    echo "    still hold pre-commit blobs for your declared paths (re-point it with" >&2
    echo "    'git reset -- <paths>' or a peer's next bare commit can revert you)." >&2
  fi
}
trap on_exit EXIT

usage() {
  cat >&2 <<'USAGE'
usage: private-index-commit.sh -F <msgfile> -- <path> [<path> ...]
       private-index-commit.sh --self-test

  -F <msgfile>  commit message file (prose-safe; never -m, an embedded quote ends the arg)
  --            everything after is a DECLARED FILE path (never a directory: the gate compares
                file paths, so a directory can never equal the staged set and always refuses)

Refuses from a linked worktree and on a detached HEAD: it moves the branch HEAD points at, and
doing that from a tree you do not own is the most consequential form of writing to someone
else's plane.
USAGE
}

# ── self-test ────────────────────────────────────────────────────────────────
# Runs the REAL commit path in throwaway repos. Every arm carries a control that must come out
# the other way, so a passing arm cannot be passing vacuously.
self_test() {
  local pass=0 fail=0 tmp
  tmp="$(cd "$(mktemp -d)" && pwd -P)"   # pwd -P: mktemp -d returns the SYMLINKED spelling
  trap 'rm -rf "$tmp"' RETURN
  local self; self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"

  ok()  { pass=$((pass+1)); echo "  PASS $1"; }
  bad() { fail=$((fail+1)); echo "  FAIL $1"; }

  # two DIFFERENT seat ids across two arms. A single hardcoded literal can satisfy at most one,
  # so the pair is non-vacuous where one arm alone was not: the previous fixture was
  # `<session-id>-0000`, a stock value whose prefix IS the literal a hardcoder writes, and a
  # hardcoded-trailer mutant survived the arm whose comment claimed it would not.
  local SID_A='<session_id_a>' SID_B='<session_id_b>'

  git init -q "$tmp/repo"; cd "$tmp/repo"
  git config user.email t@t; git config user.name t
  echo base > mine.txt; echo base > peer.txt; echo base > untouched.txt
  git add .; git commit -qm base
  printf 'subject\n\nbody\n' > "$tmp/msg"

  # ARM 1 — a peer holds a FOREIGN path staged; we must still commit, and must NOT take theirs.
  echo "peer edit" >> peer.txt; git add peer.txt
  echo "my edit" >> mine.txt
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- mine.txt >/dev/null 2>&1 \
    && ok "commits while a peer holds a foreign path staged" \
    || bad "commits while a peer holds a foreign path staged"
  git show --stat --format= HEAD | grep -q 'peer.txt' \
    && bad "peer's staged file must NOT enter the commit" \
    || ok "peer's staged file did NOT enter the commit"
  git diff --cached --name-only | grep -q 'peer.txt' \
    && ok "peer's staging SURVIVED (they lose nothing)" \
    || bad "peer's staging SURVIVED (they lose nothing)"

  # ARM 2a — the trailer carries THIS seat's id.
  local t1; t1="$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
  [ "$t1" = "$SID_A" ] && ok "trailer stamped with seat id A (got '$t1')" \
                       || bad "trailer stamped with seat id A (got '$t1')"

  # ARM 6 — the shared index must be re-pointed at HEAD for our declared paths, or a peer's next
  # bare commit REVERTS us. Control: peer.txt must STILL be staged in the same reading, so a
  # blanket index wipe fails this arm rather than passing it.
  git diff --cached --name-only | grep -q '^mine.txt$' \
    && bad "shared index re-pointed at HEAD for the declared path" \
    || ok "shared index re-pointed at HEAD for the declared path"

  # ARM 2b — a DIFFERENT seat id must produce a DIFFERENT trailer. This is what kills a hardcode.
  echo "second edit" >> mine.txt
  CLAUDE_CODE_SESSION_ID="${SID_B}-0000" bash "$self" -F "$tmp/msg" -- mine.txt >/dev/null 2>&1 || true
  local t2; t2="$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
  [ "$t2" = "$SID_B" ] && ok "trailer TRACKS the seat id, B != A (got '$t2')" \
                       || bad "trailer TRACKS the seat id, B != A (got '$t2')"

  # ARM 3 — RED CONTROL: an empty delta must REFUSE. A ;-chained recipe commits it.
  local h1; h1="$(git rev-parse HEAD)"
  if CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- mine.txt >/dev/null 2>&1; then
    bad "REFUSES an empty delta"
  else
    [ "$(git rev-parse HEAD)" = "$h1" ] && ok "REFUSES an empty delta and HEAD did not move" \
                                        || bad "REFUSES an empty delta and HEAD did not move"
  fi

  # ARM 4 — RED CONTROL: a DIRECTORY declaration refuses, and the message SAYS directory — the
  # whole point is that it must not wear a peer-collision costume.
  mkdir -p sub; echo x > sub/a.txt
  local d; d="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- sub 2>&1 || true)"
  case "$d" in *DIRECTORY*) ok "REFUSES a directory AND names it a directory" ;;
               *)           bad "REFUSES a directory AND names it a directory (got: $d)" ;; esac

  # ARM 5 — RED CONTROL: malformed args. An unvalidated predicate is fail-open.
  bash "$self" >/dev/null 2>&1 && bad "REFUSES no arguments" || ok "REFUSES no arguments"
  bash "$self" -F /nonexistent/msg -- mine.txt >/dev/null 2>&1 \
    && bad "REFUSES a missing message file" || ok "REFUSES a missing message file"

  # ARM 7 — THE GATE, which had no arm at all. Its real everyday trigger is not a peer: it is
  # declaring a path that turns out byte-identical to HEAD, so the staged set is SHORTER than
  # the declared set. Assert it refuses AND that the message names the unchanged path rather
  # than implying a collision.
  echo "third edit" >> mine.txt
  local g; g="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- mine.txt untouched.txt 2>&1 || true)"
  case "$g" in *"untouched.txt"*) ok "GATE refuses an unchanged declared path and names it" ;;
               *)                 bad "GATE refuses an unchanged declared path and names it (got: $g)" ;; esac

  # ARM 8 — THE COMPARE-AND-SWAP, the tool's ONLY shared-branch safety property, which had no
  # arm. The seam below runs a peer commit between write-tree and update-ref; the CAS must then
  # REFUSE, leave the peer's commit on top, and land ours nowhere.
  git init -q "$tmp/race"; cd "$tmp/race"
  git config user.email t@t; git config user.name t
  echo base > f.txt; git add .; git commit -qm base
  echo mine >> f.txt
  printf 'racy\n\nbody\n' > "$tmp/racemsg"
  local rc=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" \
  PRIVATE_INDEX_COMMIT_TEST_RACE='echo peer > peer.txt; git add peer.txt; git commit -qm "peer wins"' \
    bash "$self" -F "$tmp/racemsg" -- f.txt >/dev/null 2>&1 || rc=$?
  # ⚠️ -eq 7, NOT -ne 0. The CAS refusal is exit 7; every OTHER refusal in this tool is also
  # non-zero (2 usage, 3 gate, 5 worktree, 6 detached, 8 deletions), so `-ne 0` would read a
  # crash for an unrelated reason as a correct compare-and-swap. That is the EIGHTH
  # vacuous-control way, and ARM 9 below already carries a comment about it.
  [ "$rc" -eq 7 ] && ok "CAS REFUSES with the CAS code when a peer commits in the window (rc=$rc)" \
                  || bad "CAS REFUSES with the CAS code when a peer commits in the window (rc=$rc, want 7)"
  [ "$(git log -1 --format=%s)" = "peer wins" ] \
    && ok "CAS left the PEER's commit on top" || bad "CAS left the PEER's commit on top"
  [ "$(git log --all --oneline | grep -c 'racy')" = "0" ] \
    && ok "CAS: our commit landed on no branch" || bad "CAS: our commit landed on no branch"

  # ARM 9 — THE DEFECT THAT GOT THIS TOOL DISARMED. From a linked worktree it must REFUSE.
  # ⚠️ THE WORKTREE MUST BE ON A BRANCH (`-b`), NOT `--detach`. My first version used --detach
  # and the arm was VACUOUS: a detached worktree also trips the detached-HEAD refusal, which
  # fires whether or not the plane check exists, so removing the plane check left the arm GREEN.
  # Caught by mutation testing, not by reading. (EIGHTH vacuous-control way: when the expected
  # reading is a FAILURE, every other cause of failure impersonates it.)
  git init -q "$tmp/wt"; cd "$tmp/wt"
  git config user.email t@t; git config user.name t
  echo base > f.txt; git add .; git commit -qm base
  local wt_head; wt_head="$(git rev-parse HEAD)"
  git worktree add -q -b wtbranch "$tmp/wtlinked" HEAD 2>/dev/null
  ( cd "$tmp/wtlinked" && echo edit >> f.txt
    CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- f.txt ) >/dev/null 2>&1 \
    && bad "REFUSES from a linked worktree ON A BRANCH" || ok "REFUSES from a linked worktree ON A BRANCH"
  [ "$(git rev-parse HEAD)" = "$wt_head" ] \
    && ok "shared branch UNMOVED after the worktree refusal" \
    || bad "shared branch UNMOVED after the worktree refusal"
  # CONTROL for ARM 9 — the identical command from the MAIN checkout must WORK, so the arm above
  # cannot be passing merely because the tool is broken everywhere.
  echo edit2 >> f.txt
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- f.txt >/dev/null 2>&1 \
    && ok "control: same command from the MAIN checkout succeeds" \
    || bad "control: same command from the MAIN checkout succeeds"

  # ARM 10 — a detached HEAD has no branch to move.
  git checkout -q --detach HEAD 2>/dev/null
  echo edit3 >> f.txt
  local dh; dh="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- f.txt 2>&1 || true)"
  case "$dh" in *"detached HEAD"*) ok "REFUSES a detached HEAD and names it" ;;
                *)                 bad "REFUSES a detached HEAD and names it (got: $dh)" ;; esac

  # ARM 11 — THE ORIGINAL DEFECT, which no worktree arm can reach: with the branch HARDCODED,
  # committing from a FEATURE BRANCH in the main checkout moves `main` instead. The worktree arm
  # cannot see this because the plane refusal fires first. Assert the branch we are ON moved and
  # the default branch did NOT.
  git init -q "$tmp/br"; cd "$tmp/br"
  git config user.email t@t; git config user.name t
  echo base > f.txt; git add .; git commit -qm base
  local default_branch; default_branch="$(git symbolic-ref --short HEAD)"
  local main_before; main_before="$(git rev-parse HEAD)"
  git checkout -q -b feature
  echo feat >> f.txt
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- f.txt >/dev/null 2>&1 \
    && ok "commits from a feature branch" || bad "commits from a feature branch"
  [ "$(git rev-parse feature)" != "$main_before" ] \
    && ok "the FEATURE branch moved" || bad "the FEATURE branch moved"
  [ "$(git rev-parse "$default_branch")" = "$main_before" ] \
    && ok "the DEFAULT branch did NOT move (kills a hardcoded ref)" \
    || bad "the DEFAULT branch did NOT move (kills a hardcoded ref)"

  # ARM 12 — THE DELETION GATE, and the state it guards is one the fleet's OTHER codified
  # recipe produces by construction: a peer's COMMIT ahead of your worktree for a declared path.
  # Before this gate the tool committed the stale snapshot at rc=0 and the peer's committed line
  # was gone from HEAD. Reproduced on the real tool before the fix; this arm is that reproduction.
  git init -q "$tmp/del"; cd "$tmp/del"
  git config user.email t@t; git config user.name t
  printf 'L1\n' > shared.txt; git add .; git commit -qm base
  printf 'L1\nPEER-COMMITTED-LINE\n' > shared.txt; git add shared.txt; git commit -qm "peer commits a line"
  printf 'L1\nMY-LINE\n' > shared.txt          # my worktree is now STALE for shared.txt
  local drc=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- shared.txt >/dev/null 2>&1 || drc=$?
  [ "$drc" -eq 8 ] && ok "REFUSES a commit that would delete a peer's committed line (rc=$drc)" \
                   || bad "REFUSES a commit that would delete a peer's committed line (rc=$drc)"
  [ "$(git show HEAD:shared.txt | grep -c 'PEER-COMMITTED-LINE')" = "1" ] \
    && ok "the peer's committed line SURVIVES at HEAD" \
    || bad "the peer's committed line SURVIVES at HEAD"
  # ARM 12b — THE REFUSAL NAMES THE EXIT FOR THE BOTH-TOOLS-REFUSE STATE (added 2026-09-04).
  # The refusal's older text ended by sending the operator to safe-commit.sh, which in the one
  # state this tool exists for has ALREADY refused (its GATE 1 sees the whole per-repo index).
  # A message that closes a circle is worse than silence: it reads as a route. Assert the exit
  # is stated, and — the half that matters — that the READ step is stated as mandatory, because
  # `-o` re-reads the worktree and the hand-read IS the only remaining gate on that axis.
  local dout; dout="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- shared.txt 2>&1 >/dev/null || true)"
  case "$dout" in
    *"ZERO overlap"*) ok "ARM 12b: the refusal names the both-tools-refuse state" ;;
    *) bad "ARM 12b: the refusal names the both-tools-refuse state" ;;
  esac
  case "$dout" in
    *"git diff -U0 HEAD --"*) ok "ARM 12b: and it names the hand-read that replaces the gate" ;;
    *) bad "ARM 12b: and it names the hand-read that replaces the gate" ;;
  esac
  # NEGATIVE CONTROL — the exit text must NOT appear on a refusal that is not this state. The
  # binary gate (ARM 16) refuses at the same exit code 8 from a different branch; if the new
  # text leaked to every rc=8 path this arm would still pass above, so check it cannot.
  case "$(printf '%s' "$dout" | grep -c 'ZERO overlap')" in
    1) ok "ARM 12b: the exit text appears ONCE, not on every refusal path" ;;
    *) bad "ARM 12b: the exit text appears ONCE, not on every refusal path" ;;
  esac

  # ⚠️ ARM 12b AND 12c ASSERT THE REFUSAL'S *TEXT*, NOT THE DELETION GATE'S COVERAGE. A green
  # here means the exit is stated and the blame resolves — it says nothing about whether the gate
  # catches every stale-worktree deletion, which is ARM 12's job and is a separate claim. Do not
  # cite a 61/61 as evidence the provenance question is closed: it is not, and that question is
  # deliberately still open.
  # ARM 12c — THE DELETED LINE IS ANNOTATED WITH THE COMMIT THAT INTRODUCED IT (2026-09-05).
  # The listing used to tell the operator to decide whose the lines are and hand them nothing
  # to decide with. This asserts the answer is present and CORRECT, not merely that some hex
  # appeared: the expected sha is the PEER's commit, captured from this fixture's own history,
  # so a blame that resolved to the wrong commit fails here rather than passing on shape.
  # ⛔ The comparison is a PREFIX both ways — `git blame -s` prints 8 chars and
  # `rev-parse --short` 7 — so neither is substring-safe against the other in one direction.
  local peer_sha; peer_sha=$(git rev-parse --short HEAD)
  case "$dout" in
    *"$peer_sha"*) ok "ARM 12c: the deleted line carries the sha that INTRODUCED it" ;;
    *) bad "ARM 12c: the deleted line carries the sha that INTRODUCED it (want $peer_sha)" ;;
  esac
  case "$dout" in
    *"commit that INTRODUCED it"*) ok "ARM 12c: and the legend says what the sha means" ;;
    *) bad "ARM 12c: and the legend says what the sha means" ;;
  esac
  # ⛔ NEGATIVE CONTROL, AND IT IS THE ONE THAT MATTERS: the annotation must not be an
  # unconditional decoration. A line the OPERATOR wrote must blame to a DIFFERENT sha than the
  # peer's — otherwise the arm above passes on any input and the annotation carries no
  # information. Without this, printing a constant would score green.
  # ⛔ RE-AIMED PER-LINE 2026-09-05. It asserted the base sha was absent from the WHOLE
  # listing, which is a property of a ONE-COMMIT fixture, not of the annotation. It FALSE-REDs
  # the moment a fixture spans two commits — measured — so it structurally BLOCKED the
  # two-aged fixture ARM 12e needs. Pinning the assertion to the peer's own listing LINE tests
  # the same property, survives a multi-commit fixture, and yields the positive half free.
  local own_sha; own_sha=$(git rev-parse --short HEAD~1)
  local peer_line; peer_line=$(printf '%s' "$dout" | grep -F 'PEER-COMMITTED-LINE' | head -1)
  [ -n "$peer_line" ] \
    && ok "ARM 12c: the peer's deleted line appears in the listing" \
    || bad "ARM 12c: the peer's deleted line appears in the listing (nothing matched)"
  case "$peer_line" in
    *"$own_sha"*) bad "ARM 12c: NEGATIVE — the base commit must NOT be blamed for the peer's line" ;;
    *) ok "ARM 12c: NEGATIVE — the annotation discriminates, it is not a constant" ;;
  esac

  # CONTROL — a purely ADDITIVE commit on the same repo must still SUCCEED, so the arm above
  # cannot be passing because the gate refuses everything.
  git checkout -q -- shared.txt        # refresh the worktree to HEAD
  printf 'L1\nPEER-COMMITTED-LINE\nMY-ADDED-LINE\n' > shared.txt
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- shared.txt >/dev/null 2>&1 \
    && ok "control: a purely ADDITIVE commit still succeeds" \
    || bad "control: a purely ADDITIVE commit still succeeds"

  # ARM 12d — THE AGE LOOP FORKS ONCE PER DELETED LINE'S SHA, NOT ONCE PER SHA IN THE FILE.
  # RED-at-birth on the shipped code, 2026-09-05: the loop uniqued $map, which is the
  # WHOLE-FILE blame, so annotating a ONE-LINE deletion of a large tracker file forked 2,349
  # `git show` calls (~89.5 s against the Bash tool's 120 s default) and everything after it never printed.
  # ⚠️ ARM 12c cannot catch this — its fixture has 2 commits, so 2 shas is the answer under BOTH
  # the correct and the over-scoped form: a positive control drawn from the population the
  # predicate already handles (the TWELFTH vacuous-control way). This arm needs a file whose
  # blame carries MANY shas while the deletion touches FEW, and it must count FORKS rather than
  # output rows, because the printed listing is identical either way.
  git init -q "$tmp/forks"; cd "$tmp/forks"
  git config user.email t@t; git config user.name t
  : > many.txt
  local i
  for i in $(seq 1 24); do            # 24 commits => 24 distinct blame shas in one file
    printf 'line-%02d\n' "$i" >> many.txt
    git add many.txt; git commit -qm "c$i"
  done
  # Count ONLY the age-probe shape. The tool calls git constantly; a bare call-count would
  # measure everything and discriminate nothing.
  mkdir -p "$tmp/shim"
  cat > "$tmp/shim/git" <<'SHIM'
#!/usr/bin/env bash
case "$*" in *"show -s --format=%cr"*) echo x >> "$FORKLOG" ;; esac
exec /usr/bin/git "$@"
SHIM
  chmod +x "$tmp/shim/git"
  # delete lines introduced by exactly TWO of the 24 commits
  grep -v -e 'line-05' -e 'line-17' many.txt > many.new && mv many.new many.txt
  local forklog; forklog="$tmp/forkcount"; : > "$forklog"
  FORKLOG="$forklog" PATH="$tmp/shim:$PATH" CLAUDE_CODE_SESSION_ID="${SID_A}-0000" \
    bash "$self" -F "$tmp/msg" -- many.txt >/dev/null 2>&1 || true
  local forks; forks=$(grep -c '' "$forklog" 2>/dev/null || echo 0)
  # 2 deleted lines from 2 distinct commits => 2 age probes. The old form would read ~24.
  [ "$forks" -le 4 ] \
    && ok "ARM 12d: age probes scale with DELETED lines, not file size ($forks forks over 24 shas)" \
    || bad "ARM 12d: age probes scale with DELETED lines, not file size ($forks forks over 24 shas — want <=4)"
  # POSITIVE CONTROL — the shim must actually be counting, or <=4 is vacuously true at 0.
  [ "$forks" -ge 1 ] \
    && ok "ARM 12d: control — the shim counted at least one age probe" \
    || bad "ARM 12d: control — the shim counted ZERO, so the arm above measured nothing"
  cd "$tmp"

  # ARM 12e — THE AGE VALUE, AND ITS JOIN TO THE RIGHT LINE (2026-09-05).
  # ARM 12c asserts the SHA and the legend TEXT; ARM 12d asserts the FORK COUNT. Nothing asserted
  # what the parenthesis SAYS or that it belongs to the line it sits beside. Measured at HEAD:
  # killing the join -> every line reads "(age unknown)" -> 63/63 GREEN; pinning a constant ->
  # every line reads "(0 seconds ago)" -> 63/63 GREEN.
  # ⛔ WHY THIS IS A SERIOUS DEFECT RATHER THAN TIDINESS, AND WHY MY OWN FIX RAISED IT: the corrected legend
  # now tells the operator that a sub-hour sha is 99.2% their own work and recency is the SAFE
  # reading. So a dead join no longer prints a meaningless parenthesis — it prints an explicit
  # ALL-CLEAR over a peer's committed line. The operator reads "all recent, all mine", commits
  # the stale snapshot, and the peer's line is gone from HEAD: verbatim the state ARM 12 exists
  # to reproduce. Making the legend load-bearing is what obliged an assertion on its input.
  # ⛔ THE CASE THAT NEEDS PER-LINE PINNING, not merely a vocabulary check: a TRANSPOSED join
  # renders the three-week line as "minutes ago" and the peer's seconds-old line as "weeks ago".
  # Two "does the output contain both vocabularies" assertions BOTH pass through that, and it
  # inverts the reading in the destructive direction. Only pinning each age to its own line sees it.
  git init -q "$tmp/aged"; cd "$tmp/aged"
  git config user.email t@t; git config user.name t
  # ⚠️ RAW `<epoch> <tz>` — git REJECTS approxidate in GIT_COMMITTER_DATE ('3 weeks ago' errors).
  local old_epoch; old_epoch=$(( $(date +%s) - 21*86400 ))
  # ⚠️ NO `--allow-empty` HERE. The first draft used `commit -qam init --allow-empty`, which
  # succeeded as an EMPTY commit (aged.txt was untracked, so -a staged nothing) — the file then
  # landed in the SECOND, recent commit and both lines blamed to it. ARM 12e failed on its own
  # fixture: it reported the 3-week line reading "1 second ago". Stage explicitly.
  printf 'OLD-LINE-FROM-THREE-WEEKS-AGO\n' > aged.txt
  git add aged.txt
  GIT_AUTHOR_DATE="$old_epoch +0000" GIT_COMMITTER_DATE="$old_epoch +0000" git commit -qm old
  printf 'OLD-LINE-FROM-THREE-WEEKS-AGO\nNEW-LINE-FROM-JUST-NOW\n' > aged.txt
  git add aged.txt; git commit -qm new
  printf '\n' > aged.txt                     # delete BOTH lines, from two differently-aged commits
  local aout; aout="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- aged.txt 2>&1 >/dev/null || true)"
  local old_row new_row
  old_row=$(printf '%s' "$aout" | grep -F 'OLD-LINE-FROM-THREE-WEEKS-AGO' | head -1)
  new_row=$(printf '%s' "$aout" | grep -F 'NEW-LINE-FROM-JUST-NOW' | head -1)
  # (a) the join is ALIVE — kills the "(age unknown)" degradation
  case "$old_row$new_row" in
    *"age unknown"*) bad "ARM 12e: the age join is DEAD — a line reads '(age unknown)'" ;;
    *) ok "ARM 12e: the age join resolves for both lines" ;;
  esac
  # (b) the OLD line reads OLD — kills a pinned-recent constant, the destructive direction
  case "$old_row" in
    *"weeks ago"*|*"days ago"*|*"months ago"*) ok "ARM 12e: the 3-week line reads OLD, not recent" ;;
    *) bad "ARM 12e: the 3-week line reads OLD, not recent (got: ${old_row:-<absent>})" ;;
  esac
  # (c) the NEW line reads RECENT — with (b) this pins each age to ITS OWN line, so a
  #     TRANSPOSED join fails here even though both vocabularies are present in the output.
  case "$new_row" in
    *"seconds ago"*|*"second ago"*|*"minutes ago"*|*"minute ago"*) ok "ARM 12e: the just-now line reads RECENT — the join is not transposed" ;;
    *) bad "ARM 12e: the just-now line reads RECENT — the join is not transposed (got: ${new_row:-<absent>})" ;;
  esac
  cd "$tmp"

  # ARM 13 — RUNNING FROM A SUBDIRECTORY. Three refusals have lived here and all three
  # MISDESCRIBED their cause: the plane check cried "linked WORKTREE" (relative vs absolute
  # --git-common-dir); once fixed, GATE 1 cried "your declaration expanded" at a pure spelling
  # mismatch; and the prefixing that fixed THAT silently committed a different file than the one
  # named. Declared paths are REPO-ROOT-RELATIVE, the plane GATE 1 and safe-commit.sh both use.
  git init -q "$tmp/subdir"; cd "$tmp/subdir"
  git config user.email t@t; git config user.name t
  mkdir -p a/b b; echo rootb > b/x.txt; echo nestedb > a/b/x.txt; echo base > a/f.txt
  git add .; git commit -qm base
  printf 'from a subdir\n\nbody\n' > "$tmp/submsg"

  # (a) the root-relative spelling LANDS and carries the edit
  echo mine >> a/f.txt
  ( cd a && CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/submsg" -- a/f.txt ) >/dev/null 2>&1 || true
  [ "$(git log -1 --format=%s)" = "from a subdir" ] \
    && ok "ARM 13a: a root-relative declaration from a SUBDIRECTORY lands" \
    || bad "ARM 13a: a root-relative declaration from a SUBDIRECTORY lands"
  [ "$(git show HEAD:a/f.txt | grep -c 'mine')" = "1" ] \
    && ok "ARM 13a: it carries the edit under its repo-root path" \
    || bad "ARM 13a: it carries the edit under its repo-root path"

  # (b) THE REGRESSION. From a/, `b/x.txt` must mean the ROOT b/x.txt. The prefixing version
  # rewrote it to a/b/x.txt, committed THAT, and GATE 1 agreed because both planes saw the
  # rewritten name. Asserting the WRONG file is absent is the load-bearing half — asserting only
  # that the right one landed would pass under a tool that committed both.
  local h13; h13="$(git rev-parse HEAD)"
  echo CHANGED >> b/x.txt; echo MUST_NOT_RIDE >> a/b/x.txt
  ( cd a && CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/submsg" -- b/x.txt ) >/dev/null 2>&1 || true
  [ "$(git show HEAD --stat --format='' | grep -c 'a/b/x.txt')" = "0" ] \
    && ok "ARM 13b: a root-relative decl from a subdir does NOT commit the prefixed sibling" \
    || bad "ARM 13b: a root-relative decl from a subdir does NOT commit the prefixed sibling"
  [ "$(git show HEAD:b/x.txt | grep -c 'CHANGED')" = "1" ] \
    && ok "ARM 13b: it commits the file the operator actually named" \
    || bad "ARM 13b: it commits the file the operator actually named"

  # (c) a cwd-relative spelling must REFUSE, not guess. Assert HEAD did not move — a refusal that
  # still commits is the failure this whole arm exists for.
  local h13c; h13c="$(git rev-parse HEAD)"; echo z >> a/f.txt
  local out13c; out13c="$( cd a && CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/submsg" -- f.txt 2>&1 )" || true
  [ "$(git rev-parse HEAD)" = "$h13c" ] \
    && ok "ARM 13c: a cwd-relative spelling REFUSES and moves nothing" \
    || bad "ARM 13c: a cwd-relative spelling REFUSES and moves nothing"
  # and it must EXPLAIN itself by naming the path the operator probably meant. Without this the
  # refusal is indistinguishable from the costume-wearing ones this arm exists to retire, and a
  # mutation removing the whole explanation block read GREEN.
  printf '%s' "$out13c" | grep -qF "a/f.txt" \
    && ok "ARM 13c: the refusal NAMES the repo-root spelling the operator meant" \
    || bad "ARM 13c: the refusal NAMES the repo-root spelling the operator meant"

  # (d) COVERAGE GAP: every arm above passes an ABSOLUTE msgfile, so the relative
  # -F path — the reason MSG is absolutised at all — had nothing guarding it.
  # ⛔ THE SUBJECT MUST BE DISTINCT AND HEAD MUST MOVE. The first version of this arm reused
  # "from a subdir", which ARM 13a had ALREADY put at HEAD — so it passed on stale state and a
  # mutation deleting the MSG absolutisation it exists to guard read GREEN 34/34. An arm that
  # asserts a value already true before it ran is measuring nothing.
  printf 'relative msgfile\n\nbody\n' > a/relmsg.txt
  local h13d; h13d="$(git rev-parse HEAD)"; echo w >> a/f.txt
  ( cd a && CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F relmsg.txt -- a/f.txt ) >/dev/null 2>&1 || true
  [ "$(git rev-parse HEAD)" != "$h13d" ] \
    && ok "ARM 13d: a RELATIVE -F msgfile commits (HEAD moved)" \
    || bad "ARM 13d: a RELATIVE -F msgfile commits (HEAD moved)"
  [ "$(git log -1 --format=%s)" = "relative msgfile" ] \
    && ok "ARM 13d: and the commit carries THAT file's subject, resolved from the original cwd" \
    || bad "ARM 13d: and the commit carries THAT file's subject, resolved from the original cwd"

  # ARM 14 — THE SEAM GATE, which FAILED OPEN under a relative $0. The gate resolves
  # the script's own repo; a late `dirname "$0"` after the cd to toplevel yields the repo's PARENT,
  # rev-parse fails, and an unguarded empty compared as "a different repo" so the seam FIRED in the
  # tool's own repo. BOTH invocation forms must refuse, and neither may move HEAD.
  mkdir -p "$tmp/seam/scripts"          # NOT git init here — a nested .git breaks `git add .`
  git init -q "$tmp/seam"; cd "$tmp/seam"
  git config user.email t@t; git config user.name t
  cp "$self" scripts/pic.sh; echo base > scripts/t.txt; git add .; git commit -qm base
  printf 'seam\n\nbody\n' > "$tmp/seammsg"
  local h14 form inv
  for form in relative absolute; do
    h14="$(git rev-parse HEAD)"
    git checkout -q -- scripts/t.txt; echo mine >> scripts/t.txt
    if [ "$form" = relative ]; then inv="pic.sh"; else inv="$tmp/seam/scripts/pic.sh"; fi
    ( cd scripts && PRIVATE_INDEX_COMMIT_TEST_RACE="echo PWNED > $tmp/seam-pwned-$form" \
      CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$inv" -F "$tmp/seammsg" -- scripts/t.txt ) >/dev/null 2>&1 || true
    [ ! -f "$tmp/seam-pwned-$form" ] \
      && ok "ARM 14: seam REFUSES in the tool's own repo ($form \$0) — payload never ran" \
      || bad "ARM 14: seam REFUSES in the tool's own repo ($form \$0) — payload never ran"
    [ "$(git rev-parse HEAD)" = "$h14" ] \
      && ok "ARM 14: seam refusal moved no ref ($form \$0)" \
      || bad "ARM 14: seam refusal moved no ref ($form \$0)"
  done

  # ARM 15 — A RENAME MUST COMMIT ONE COPY, NOT TWO. The tool's headline use case is a staged
  # memory-shard roll, which is a pure rename, and until 2026-09-02 it wrote a tree carrying
  # BOTH copies at rc=0 reporting "1 file changed". No arm existed, so 36/36 was green over it.
  # MUTATION: delete the `--force-remove` loop and `old.md` comes back PRESENT at HEAD.
  git init -q "$tmp/ren"; cd "$tmp/ren"
  git config user.email t@t; git config user.name t
  printf 'shard body\n' > old.md; git add .; git commit -qm base
  git mv old.md new.md
  # 15a — declaring BOTH endpoints must SUCCEED and leave exactly one copy.
  # MUTATION: drop `--no-renames` from GATE 1's STAGED and this refuses at rc=3 instead.
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- old.md new.md >/dev/null 2>&1 || true
  git cat-file -e HEAD:new.md 2>/dev/null \
    && ok "ARM 15a: declaring both endpoints lands the NEW path" \
    || bad "ARM 15a: declaring both endpoints lands the NEW path"
  git cat-file -e HEAD:old.md 2>/dev/null \
    && bad "ARM 15a: the OLD path is GONE (both copies committed — the serious defect)" \
    || ok "ARM 15a: the OLD path is GONE"

  # 15b — THE ACTUAL DUPLICATION PATH, and the one the reported mechanism missed: declaring
  # ONLY the new path. `read-tree` re-seats the old blob and nothing names it, so before the
  # guard this committed BOTH copies at rc=0. MUTATION: delete the RENAME SAFETY block and
  # this returns rc=0 with old2.md alive at HEAD.
  printf 'second shard\n' > old2.md; git add old2.md; git commit -qm base2
  local h15; h15="$(git rev-parse HEAD)"
  git mv old2.md new2.md
  # ⛔ CAPTURE stderr, do not discard it. This arm asserted rc alone until 2026-09-02, which
  # is the exact hole ARM 17 exists to remember: a correct rc with a destroyed message is
  # green here and useless to the operator, who gets the right exit code and no diagnosis.
  # The request that asked for this named a self-test arm
  # asserting the MESSAGE as its closing condition, and only ARM 17 had one.
  local rrc=0 rout
  rout="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- new2.md 2>&1)" || rrc=$?
  [ "$rrc" -eq 9 ] && ok "ARM 15b: REFUSES an undeclared rename endpoint (rc=$rrc)" \
                   || bad "ARM 15b: REFUSES an undeclared rename endpoint (rc=$rrc)"
  # Two phrases, both load-bearing: the DIAGNOSIS names the rename, and the REMEDY names
  # both endpoints. A refusal that says only "refused" sends the operator to re-run it.
  case "$rout" in *"looks like a RENAME of"*) ok "ARM 15b: the refusal NAMES the rename" ;;
    *) bad "ARM 15b: the refusal NAMES the rename (got: $rout)" ;; esac
  case "$rout" in *"Declare BOTH endpoints"*"old2.md"*"new2.md"*)
      ok "ARM 15b: the refusal prints the REMEDY with both endpoints" ;;
    *) bad "ARM 15b: the refusal prints the REMEDY with both endpoints (got: $rout)" ;; esac
  [ "$(git rev-parse HEAD)" = "$h15" ] \
    && ok "ARM 15b: the refusal moved no ref — no duplicate landed" \
    || bad "ARM 15b: the refusal moved no ref — no duplicate landed"

  # ARM 16 — THE DELETION GATE IS BLIND TO BINARIES. `git diff --numstat` prints `-` for a
  # binary and `awk '{s+=$2}'` coerces it to 0, so a stale worktree silently reverted a peer's
  # committed blob at rc=0 reporting "0 deletions". DISCRIMINATING CONTROL below: an ADDED
  # binary must still SUCCEED, or this arm would pass merely by refusing every binary.
  git init -q "$tmp/bin"; cd "$tmp/bin"
  git config user.email t@t; git config user.name t
  printf 'seed\n' > seed.txt; git add .; git commit -qm base
  printf '\x00\x01PEER\x02' > blob.bin; git add blob.bin; git commit -qm "peer commits a binary"
  printf '\x00\x01MINE\x02' > blob.bin          # stale worktree for a binary already in HEAD
  # ⛔ CAPTURE stderr — see the note on ARM 15b. Same defect, same fix, same date.
  local brc=0 bout
  bout="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- blob.bin 2>&1)" || brc=$?
  [ "$brc" -eq 8 ] && ok "ARM 16: REFUSES a binary already in HEAD (rc=$brc)" \
                   || bad "ARM 16: REFUSES a binary already in HEAD (rc=$brc)"
  # The WHY matters more than the refusal here: an operator who is not told the gate counts
  # LINES will read this as the tool being broken on binaries rather than honest about them.
  case "$bout" in *"deletion gate counts LINES"*) ok "ARM 16: the refusal explains WHY (the gate counts lines)" ;;
    *) bad "ARM 16: the refusal explains WHY (got: $bout)" ;; esac
  # And it must NAME the offending path — a list of one is still a list.
  case "$bout" in *"blob.bin"*) ok "ARM 16: the refusal NAMES the binary" ;;
    *) bad "ARM 16: the refusal NAMES the binary (got: $bout)" ;; esac
  [ "$(git show HEAD:blob.bin | tr -d '\000' | grep -c PEER)" = "1" ] \
    && ok "ARM 16: the peer's committed binary SURVIVES at HEAD" \
    || bad "ARM 16: the peer's committed binary SURVIVES at HEAD"
  git checkout -q -- blob.bin
  printf '\x00NEW\x02' > added.bin
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- added.bin >/dev/null 2>&1 \
    && ok "ARM 16 control: an ADDED binary still succeeds (reverts nothing)" \
    || bad "ARM 16 control: an ADDED binary still succeeds (reverts nothing)"

  # ARM 17 — THE CAS REFUSAL MUST REACH THE OPERATOR. ARM 8 asserts rc=7 and never READS the
  # message, which is why a literal backslash-n survived review: bash parsed `>&2\n` as a
  # redirect to a FILE named `2n`, stderr got nothing, rc stayed correct, suite stayed green.
  # This arm reads the TEXT and asserts no `2n` file was created.
  git init -q "$tmp/cas"; cd "$tmp/cas"
  git config user.email t@t; git config user.name t
  printf 'a\n' > f.txt; git add .; git commit -qm base
  printf 'a\nmine\n' > f.txt
  local casout
  casout="$(PRIVATE_INDEX_COMMIT_TEST_RACE="git commit -q --allow-empty -m peer" \
    CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- f.txt 2>&1 || true)"
  case "$casout" in *"did not move the branch"*)
      ok "ARM 17: the CAS refusal TEXT reaches the operator" ;;
    *) bad "ARM 17: the CAS refusal TEXT reaches the operator (got: $casout)" ;; esac
  [ ! -e "$tmp/cas/2n" ] \
    && ok "ARM 17: no stray '2n' file — stderr was a redirect, not a filename" \
    || bad "ARM 17: no stray '2n' file — stderr was a redirect, not a filename"

  # ARM 18 — THE DELETION LISTING MUST SURVIVE CONTENT THAT LOOKS LIKE A DIFF HEADER.
  # A deleted line whose content starts `--` renders as `---…`, so the old `grep -v '^---'`
  # ate it and then exited 1, killing the refusal under `set -euo pipefail` before `exit 8`.
  # MUTATION: restore the grep form and this arm goes red on BOTH assertions at once.
  git init -q "$tmp/dashes"; cd "$tmp/dashes"
  git config user.email t@t; git config user.name t
  printf -- '-- alpha\n-- beta\n' > d.txt; git add .; git commit -qm base
  # ⚠️ EVERY deleted line must start `--`, and that is what makes this fixture discriminating.
  # A first version added a plain `PEER-LINE` here: the listing assertion still caught the
  # mutation, but `grep -v '^---'` then kept that one line, exited 0, and NO abort occurred —
  # so the rc=8 assertion passed under the defect and only one of the two conjuncts was live.
  printf -- '-- alpha\n-- beta\n-- gamma\n' > d.txt; git add d.txt; git commit -qm "peer adds"
  printf -- 'replaced\n' > d.txt          # stale worktree: would delete all three
  local dout drc2=0
  dout="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg" -- d.txt 2>&1)" || drc2=$?
  [ "$drc2" -eq 8 ] && ok "ARM 18: refuses at rc=8, not an abort (rc=$drc2)" \
                    || bad "ARM 18: refuses at rc=8, not an abort (rc=$drc2)"
  case "$dout" in *"-- alpha"*)
      ok "ARM 18: the listing SHOWS a deleted line whose content starts with --" ;;
    *) bad "ARM 18: the listing SHOWS a deleted line whose content starts with -- (got: $dout)" ;; esac

  # ARM 19 — AN ABSENT SESSION ID MUST SAY SO. On bash 3.2 the bare `${VAR%%-*}` skipped set -u's
  # unbound check (bash 4+ aborts on it; ARM 19b), so unset and empty both fell through to a
  # trailerless commit in silence, on exactly the contended files where attribution matters most.
  # MUTATION: delete the NOTE and this reds.
  git init -q "$tmp/notrail"; cd "$tmp/notrail"
  git config user.email t@t; git config user.name t
  printf 'a\n' > n.txt; git add .; git commit -qm base
  printf 'a\nmine\n' > n.txt
  local nout
  nout="$(CLAUDE_CODE_SESSION_ID="" bash "$self" -F "$tmp/msg" -- n.txt 2>&1)" || true
  case "$nout" in *"NO Claude-Session"*)
      ok "ARM 19: an absent session id WARNS rather than dropping the trailer silently" ;;
    *) bad "ARM 19: an absent session id WARNS (got: $nout)" ;; esac
  [ "$(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')" = "" ] \
    && ok "ARM 19: and it still commits, with no trailer rather than an empty one" \
    || bad "ARM 19: and it still commits, with no trailer rather than an empty one"
  # the base commit has no trailer either, so the check above passes with no commit at all; this one cannot
  [ "$(git show HEAD:n.txt 2>/dev/null | tail -1)" = "mine" ] \
    && ok "ARM 19: and the commit lands, carrying the change" \
    || bad "ARM 19: and the commit lands, carrying the change"
  # ARM 19b — TRULY UNSET, not empty. Bash 4+ aborts on the bare `${VAR%%-*}` under set -u (this
  # script exits 1 on 5.2.15; 3.2.57 reads it as empty), so this arm reds only on bash 4 or later,
  # never on macOS's /bin/bash. MUTATION: restore the bare form, run under bash 5 (Linux).
  printf 'a\nmine\nmore\n' > n.txt
  nout="$(env -u CLAUDE_CODE_SESSION_ID bash "$self" -F "$tmp/msg" -- n.txt 2>&1)" || true
  case "$nout" in *"NO Claude-Session"*)
      ok "ARM 19b: an UNSET session id warns on every bash (bash 4+ aborted on the bare form)" ;;
    *) bad "ARM 19b: an UNSET session id warns (got: $nout)" ;; esac
  [ "$(git show HEAD:n.txt 2>/dev/null | tail -1)" = "more" ] \
    && ok "ARM 19b: and the commit lands, carrying the change" \
    || bad "ARM 19b: and the commit lands, carrying the change"
  # ARM 19c — the same defect where no bash 4 runs, as on macOS's /bin/bash, read from the source.
  # No operator touches the variable itself, only its :- copy: no suffix strip (%, %%), prefix
  # strip (#, ##), substitution (/, //) or substring (:N), all of which 3.2 reads as empty when
  # unset and bash 4+ aborts on. The planted line is the control.
  local sidre sidn sidplant
  sidre='CLAUDE_CODE_SESSION_ID''(%|#|/|:[^-+=?])'
  sidn="$(grep -v '^[[:space:]]*#' "$self" | grep -cE "$sidre" || true)"
  sidplant="$(printf 'x="${%s:0:8}"\n' CLAUDE_CODE_SESSION_ID | grep -cE "$sidre" || true)"
  [ "$sidn" = "0" ] && [ "$sidplant" = "1" ] \
    && ok "ARM 19c: no strip, substitution or substring operator touches the session id bare (reds on every bash)" \
    || bad "ARM 19c: a bare operator on the session id is back, or the count is blind (count=$sidn, control=$sidplant)"

  # ARM 20 — THE SEAM WITH THE SCRIPT AT A REPO ROOT. ARM 14 varies the INVOCATION SPELLING
  # (relative vs absolute $0) and the CWD, and always leaves the script in `scripts/` — so it
  # cannot reach the one variable that mattered. `_SELF_REPO` was computed from
  # `dirname "$SELF_PATH"/..`, which at a repo root is the repo's PARENT: rev-parse fails,
  # the value goes empty, the unguarded compare reads "different repo", and the seam OPENED.
  # MEASURED before the fix: rc=0 with the payload EXECUTED in the tool's own repo.
  # MUTATION: put `/..` back and this arm goes red on both assertions.
  git init -q "$tmp/rootseam"; cd "$tmp/rootseam"
  git config user.email t@t; git config user.name t
  echo x > f.txt; git add f.txt; git commit -qm base
  cp "$self" ./pic.sh                      # <-- AT THE ROOT, which is the whole point
  printf 'x\nADDED\n' > f.txt              # append-only: the deletion gate must not refuse first
  local rsrc=0
  PRIVATE_INDEX_COMMIT_TEST_RACE="echo RAN > $tmp/rootseam/payload.marker" \
    CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash ./pic.sh -F "$tmp/msg" -- f.txt >/dev/null 2>&1 || rsrc=$?
  [ "$rsrc" -eq 2 ] && ok "ARM 20: seam REFUSES with the script at a repo ROOT (rc=$rsrc)" \
                    || bad "ARM 20: seam REFUSES with the script at a repo ROOT (rc=$rsrc)"
  [ ! -f "$tmp/rootseam/payload.marker" ] \
    && ok "ARM 20: the payload never ran" \
    || bad "ARM 20: the payload never ran — arbitrary shell executed in the tool's own repo"

  # ── ARMS 21-24 — THE MESSAGE FILE MUST HAVE CONTENT ─────────────────────────
  # `-n` guards the FLAG and `-f` guards EXISTENCE; neither reads a byte. A
  # `mktemp` file is 0 bytes, `interpret-trailers` turns that into a lone
  # `Claude-Session: <sid>` line, and `commit-tree` makes it the SUBJECT — which
  # is exactly what one shipped commit was, before it was rewritten.
  # ⚠️ THE FOUR INPUTS ARE THE CONTROL TABLE, and each rejected predicate dies on
  # a different one: `[ -s "$MSG" ]` alone PASSES arm 24 (whitespace-only), and a
  # first-line test REFUSES arm 22 (leading blank lines, which git strips). Only
  # `grep -q '[^[:space:]]'` is correct on all four.
  # MUTATION: delete that guard and arms 23 + 24 go red on both assertions each.
  git init -q "$tmp/msgguard"; cd "$tmp/msgguard"
  git config user.email t@t; git config user.name t
  echo base > m.txt; git add .; git commit -qm base

  printf 'real subject\n\nbody\n'                  > "$tmp/msg-valid"
  printf '\n\n\nblank-led subject\n\nbody\n'       > "$tmp/msg-blanklead"
  : > "$tmp/msg-empty"                              # 0 bytes — exactly what mktemp yields
  printf '   \n\t\n \n'                            > "$tmp/msg-ws"
  [ ! -s "$tmp/msg-empty" ] && [ -s "$tmp/msg-ws" ] \
    && ok "ARM 21-24 fixture: msg-empty is 0 bytes and msg-ws is NOT (so -s alone would pass it)" \
    || bad "ARM 21-24 fixture: msg-empty is 0 bytes and msg-ws is NOT"

  # ARM 21 — a valid message commits, and the SUBJECT is the message.
  printf 'base\nmine\n' > m.txt
  local a21=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-valid" -- m.txt >/dev/null 2>&1 || a21=$?
  [ "$a21" -eq 0 ] && ok "ARM 21: a valid message is ACCEPTED (rc=$a21)" \
                   || bad "ARM 21: a valid message is ACCEPTED (rc=$a21)"
  [ "$(git log -1 --format=%s)" = "real subject" ] \
    && ok "ARM 21: and the SUBJECT is the message, not the Claude-Session trailer" \
    || bad "ARM 21: and the SUBJECT is the message (got: $(git log -1 --format=%s))"

  # ARM 22 — LEADING BLANK LINES are valid; git strips them. This is the arm that
  # kills a first-line predicate, and it must not be dropped as redundant.
  printf 'base\nmine\nmore\n' > m.txt
  local a22=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-blanklead" -- m.txt >/dev/null 2>&1 || a22=$?
  [ "$a22" -eq 0 ] && ok "ARM 22: leading blank lines are ACCEPTED (rc=$a22)" \
                   || bad "ARM 22: leading blank lines are ACCEPTED (rc=$a22)"
  [ "$(git log -1 --format=%s)" = "blank-led subject" ] \
    && ok "ARM 22: and git stripped them — the SUBJECT is the first non-blank line" \
    || bad "ARM 22: and git stripped them (got: $(git log -1 --format=%s))"

  # ARM 23 — a 0-BYTE message REFUSES, and nothing lands. The worktree change is
  # load-bearing: without it the refusal could not be told from an empty delta.
  printf 'base\nmine\nmore\nyet\n' > m.txt
  local head23; head23="$(git rev-parse HEAD)"
  local a23=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-empty" -- m.txt >/dev/null 2>&1 || a23=$?
  [ "$a23" -eq 2 ] && ok "ARM 23: a 0-byte message REFUSES at rc=2 (rc=$a23)" \
                   || bad "ARM 23: a 0-byte message REFUSES at rc=2 (rc=$a23)"
  [ "$(git rev-parse HEAD)" = "$head23" ] \
    && ok "ARM 23: and HEAD did not move — no trailer-as-subject commit landed" \
    || bad "ARM 23: and HEAD did not move — a commit landed: $(git log -1 --format=%s)"

  # ARM 24 — WHITESPACE-ONLY refuses too. `-s` alone passes this file (it has
  # bytes) and git then strips it to empty, producing the identical bad commit.
  local head24; head24="$(git rev-parse HEAD)"
  local a24=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-ws" -- m.txt >/dev/null 2>&1 || a24=$?
  [ "$a24" -eq 2 ] && ok "ARM 24: a whitespace-only message REFUSES at rc=2 (rc=$a24)" \
                   || bad "ARM 24: a whitespace-only message REFUSES at rc=2 (rc=$a24)"
  [ "$(git rev-parse HEAD)" = "$head24" ] \
    && ok "ARM 24: and HEAD did not move" \
    || bad "ARM 24: and HEAD did not move — a commit landed: $(git log -1 --format=%s)"

  # ── ARMS 25-27 — THE PARSE GATE, AND WHAT IT ACTUALLY CLOSES HERE ──────────
  # ⚠️ BE PRECISE ABOUT THE MECHANISM. This tool `git add`s every declared path,
  # so the blob it commits is the WORKTREE's bytes at add-time — the shared
  # index's hunk-isolated state cannot survive into it. So what the gate closes
  # HERE is "the worktree moved since anyone last ran tsc", which is the second
  # half of the staged-blob problem. The genuine index-vs-worktree divergence
  # (`git apply --cached`) is closed in safe-commit.sh --staged, which
  # commits the index as it stands. Both callers use the same helper.
  # ⚠️ FIXTURES ARE APPEND-ONLY: the deletion gate sits ABOVE this one and would
  # refuse first at rc=8, which is how the first cut of these arms failed.
  # MUTATION: delete the parse-gate block before `git write-tree` and 25 + 27 go
  # red on both assertions each, while 26 stays green.
  git init -q "$tmp/parsegate"; cd "$tmp/parsegate"
  git config user.email t@t; git config user.name t
  printf 'export const a = 1;\n' > ok.ts; git add .; git commit -qm base

  # ARM 25 — an APPEND that breaks the parse REFUSES, and nothing lands.
  printf 'export const a = 1;\nconst b: number =\nconst c = 1;\n' > ok.ts
  local head25; head25="$(git rev-parse HEAD)"
  local pg25=0 pgout25
  pgout25="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-valid" -- ok.ts 2>&1)" || pg25=$?
  [ "$pg25" -eq 9 ] && ok "ARM 25: a staged blob that does not parse REFUSES at rc=9 (rc=$pg25)" \
                    || bad "ARM 25: a staged blob that does not parse REFUSES at rc=9 (rc=$pg25)"
  { [ "$(git rev-parse HEAD)" = "$head25" ] && case "$pgout25" in *"does not parse"*) true ;; *) false ;; esac; } \
    && ok "ARM 25: and HEAD did not move, and the refusal names the parse failure" \
    || bad "ARM 25: and HEAD did not move + names the parse failure (got: $pgout25)"

  # ARM 26 — the CONTROL that must come out the other way. Without it the gate
  # could be refusing every .ts and arm 25 would still read as success.
  printf 'export const a = 1;\nexport const b = 2;\n' > ok.ts
  local pg26=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-valid" -- ok.ts >/dev/null 2>&1 || pg26=$?
  [ "$pg26" -eq 0 ] && ok "ARM 26: CONTROL — valid TypeScript still commits (rc=$pg26)" \
                    || bad "ARM 26: CONTROL — valid TypeScript still commits (rc=$pg26)"

  # ARM 27 — ONE BROKEN PATH AMONG SEVERAL POISONS THE WHOLE COMMIT. A per-file
  # gate that stopped at the first clean file would pass this; the refusal must
  # also NAME the broken path, or the operator cannot act on it.
  printf 'export const a = 1;\nexport const b = 2;\nexport const ok2 = 3;\n' > ok.ts
  printf 'const c: number =\nconst d = 1;\n' > broke.ts
  local head27; head27="$(git rev-parse HEAD)"
  local pg27=0 pgout27
  pgout27="$(CLAUDE_CODE_SESSION_ID="${SID_A}-0000" bash "$self" -F "$tmp/msg-valid" -- ok.ts broke.ts 2>&1)" || pg27=$?
  { [ "$pg27" -eq 9 ] && case "$pgout27" in *"broke.ts:"*) true ;; *) false ;; esac; } \
    && ok "ARM 27: one broken path among clean ones refuses at rc=9 AND names it (rc=$pg27)" \
    || bad "ARM 27: one broken path among clean ones refuses at rc=9 AND names it (rc=$pg27, out: $pgout27)"
  [ "$(git rev-parse HEAD)" = "$head27" ] \
    && ok "ARM 27: and HEAD did not move — the clean sibling did not ride in either" \
    || bad "ARM 27: and HEAD did not move — a broken blob landed: $(git log -1 --format=%s)"

  # ARM 28 — A BRANCH SWITCH DURING THE RUN REFUSES AT rc=10 AND LANDS NOTHING (2026-09-08).
  # The seam runs `git switch -c other` between write-tree and
  # update-ref: the branch derived at the top no longer matches HEAD, so the CAS must NOT be
  # attempted (it would SUCCEED on the old branch — the measured silent loss). -eq 10, not -ne 0,
  # for the same reason ARM 8 pins 7: every other refusal is also non-zero.
  git init -q "$tmp/switch"; cd "$tmp/switch"
  git config user.email t@t; git config user.name t
  echo base > f.txt; git add .; git commit -qm base
  local main28; main28="$(git symbolic-ref --short HEAD)"; local head28; head28="$(git rev-parse HEAD)"
  echo mine >> f.txt
  printf 'switched\n\nbody\n' > "$tmp/switchmsg"
  local rc28=0
  CLAUDE_CODE_SESSION_ID="${SID_A}-0000" \
  PRIVATE_INDEX_COMMIT_TEST_RACE='git switch -q -c other' \
    bash "$self" -F "$tmp/switchmsg" -- f.txt >/dev/null 2>&1 || rc28=$?
  [ "$rc28" -eq 10 ] && ok "ARM 28: a branch switch mid-run REFUSES at rc=10 (rc=$rc28)" \
                     || bad "ARM 28: a branch switch mid-run REFUSES at rc=10 (rc=$rc28, want 10)"
  [ "$(git rev-parse "$main28")" = "$head28" ] \
    && ok "ARM 28: the original branch did not move" || bad "ARM 28: the original branch MOVED — the stranded-commit shape"
  [ "$(git log --all --oneline | grep -c 'switched')" = "0" ] \
    && ok "ARM 28: our commit landed on no branch" || bad "ARM 28: our commit landed somewhere"
  [ "$(git diff --name-only)" = "f.txt" ] \
    && ok "ARM 28: the worktree edit is still there, uncommitted, on the new branch" || bad "ARM 28: the worktree edit is gone"

  cd "$tmp/repo"
  echo "self-test: ${pass}/$((pass+fail)) passed, ${fail} failed."
  [ "$fail" -eq 0 ]
}

[ "${1:-}" = "--self-test" ] && { self_test; exit $?; }

# ── args ─────────────────────────────────────────────────────────────────────
MSG=""
PATHS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -F) MSG="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --) shift; while [ $# -gt 0 ]; do PATHS+=("$1"); shift; done ;;
    -h|--help) usage; exit 0 ;;
    *) echo "REFUSE: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[ -n "$MSG" ] || { echo "REFUSE: -F <msgfile> is required" >&2; usage; exit 2; }
[ -f "$MSG" ] || { echo "REFUSE: message file does not exist: $MSG" >&2; exit 2; }
# ⛔ AND IT MUST HAVE CONTENT. `-n` gates the FLAG, `-f` gates EXISTENCE, and neither reads a
# byte: `mktemp` hands back a 0-byte file, `interpret-trailers` turns 0 bytes into a lone
# `Claude-Session: <sid>` line, and `commit-tree` makes that line the SUBJECT. One shipped
# commit was exactly that (since rewritten), reproduced byte-for-byte.
# ⚠️ `-s` ALONE IS NOT THE FIX — it passes a whitespace-only file, which git strips to empty and
# which produces the identical trailer-as-subject commit. And a FIRST-LINE predicate is not the
# fix either: it false-refuses a valid message with leading blank lines, which git strips. Only
# "is there a non-whitespace byte anywhere" is right across all four inputs; ARMS 21-24 of the
# self-test are those four, and each of the two rejected predicates fails one of them.
grep -q '[^[:space:]]' "$MSG" || {
  echo "REFUSE: message file is empty or whitespace-only: $MSG" >&2
  echo "        A blank message becomes a commit whose SUBJECT is the Claude-Session trailer" >&2
  echo "        (this has shipped once). Write the message, then re-run." >&2
  exit 2
}
# ⛔ THIS COMMENT CLAIMED `${#A[@]}` ON AN EMPTY ARRAY IS AN UNBOUND-VARIABLE ABORT UNDER
# `set -u` ON BASH 3.2. MEASURED FALSE on /bin/bash 3.2.57 here: `set -u; A=(); echo ${#A[@]}`
# prints `0` and exits clean. What DOES abort is the EXPANSION — `echo "${A[@]}"` → `A[@]:
# unbound variable` — which is the rule `bash-environment.md` states and which this comment
# mis-transferred from the count to the expansion. The COUNT below is safe as written; the
# guard is still correct, it just never needed the rationale it claimed.
[ "${#PATHS[@]}" -gt 0 ] || { echo "REFUSE: no declared paths after --" >&2; usage; exit 2; }

for p in "${PATHS[@]}"; do
  [ -d "$p" ] && { echo "REFUSE: '$p' is a DIRECTORY. Declare FILES — the gate compares file paths, so a directory can never match the staged set, and the refusal would wear a peer-collision costume." >&2; exit 2; }
done

# ── PLANE AND BRANCH — the fix for the defect that got this tool disarmed ─────
# A linked worktree has its own git-dir but shares the common dir. Moving refs/heads/* from
# inside one writes a tree you do not own, and — worse — the closing `git reset` would then run
# in the WORKTREE's index, leaving the shared repo holding a staged revert of the commit that
# just landed, armed for exactly the bare peer commit this recipe exists to survive.
# ⚠️ --path-format=absolute IS LOAD-BEARING, not tidiness. Without it these two return
# DIFFERENT SPELLINGS OF THE SAME DIRECTORY from any subdirectory of the main checkout:
# from scripts/, --git-dir is absolute while --git-common-dir is "../.git". The string
# compare then fires a FALSE REFUSAL wearing the exact signature of a real worktree, so the
# operator goes hunting a linked worktree that does not exist.
GIT_DIR_="$(git rev-parse --path-format=absolute --git-dir)"
GIT_COMMON_="$(git rev-parse --path-format=absolute --git-common-dir)"
if [ "$GIT_DIR_" != "$GIT_COMMON_" ]; then
  echo "REFUSE: running inside a linked WORKTREE (git-dir '$GIT_DIR_' != common-dir '$GIT_COMMON_')." >&2
  echo "        This tool moves a branch ref and re-points the caller's index; from a worktree that" >&2
  echo "        writes the shared repo's plane and leaves a staged revert behind. Commit from the" >&2
  echo "        main checkout, or use safe-commit.sh." >&2
  exit 5
fi

# ── SUBDIRECTORY NORMALISATION ───────────────────────────────────────────────
# ⛔ THE TOOL COULD NOT RUN FROM A SUBDIRECTORY AT ALL, AND BOTH FAILURES LIED ABOUT WHY.
# GATE 1 compares the declared set against `git diff --cached --name-only`, which is always
# REPO-ROOT-RELATIVE, while `git add` resolves a pathspec relative to CWD. So from sub/:
#   declared "f.txt"      -> staged as "sub/f.txt" -> gate refuses "STAGED BUT NOT DECLARED —
#                            your declaration expanded", which is FALSE; nothing expanded, the
#                            two spellings are the same file on two different planes;
#   declared "sub/f.txt"  -> `git add` resolves it against sub/ -> fatal, rc=128.
# Neither message names the real cause, and the first sends the operator hunting a glob.
# ⛔ THE FIRST FIX PREFIXED EACH DECLARED PATH WITH `--show-prefix` AND THAT WAS WORSE THAN THE
# DEFECT. It adopted git's cwd-relative pathspec rule, but the CODIFIED house convention — and the
# plane GATE 1 compares on, and what safe-commit.sh requires — is REPO-ROOT-RELATIVE. So an
# operator following the convention from a/ and declaring `b/x.txt` got it silently rewritten to
# `a/b/x.txt`: rc=0, HEAD moves, THEIR file is not committed, and a line they never wrote rides in
# under their message. GATE 1 cannot catch it because both planes agree on the rewritten name.
# 15 such (cwd, declared) pairs exist in the live tree. I named that exact risk when asking for
# review and then shipped it.
#
# DECLARED PATHS ARE REPO-ROOT-RELATIVE, ALWAYS. The tool moves to the toplevel and rewrites
# NOTHING. A cwd-relative spelling now fails LOUD at `git add` instead of committing the wrong
# file, which is the correct direction for a tool whose only safety property is that the declared
# set means exactly what it says. Only the message file is absolutised, because -F is an ordinary
# argument given relative to the ORIGINAL cwd.
GIT_PREFIX_="$(git rev-parse --show-prefix)"
if [ -n "$GIT_PREFIX_" ]; then
  MSG="$(cd "$(dirname "$MSG")" && pwd -P)/$(basename "$MSG")"
  cd "$(git rev-parse --show-toplevel)"
fi

# The branch is DERIVED, never assumed. A detached HEAD has no branch to move.
BRANCH="$(git symbolic-ref -q HEAD || true)"
if [ -z "$BRANCH" ]; then
  echo "REFUSE: detached HEAD — there is no branch to move. Check out a branch first." >&2
  exit 6
fi

HEAD0="$(git rev-parse HEAD)"
PARENT_TREE="$(git rev-parse "${HEAD0}^{tree}")"

IDX_DIR="$(cd "$(mktemp -d)" && pwd -P)"   # pwd -P: mktemp -d returns the SYMLINKED spelling
PRIVATE_IDX_DIR="$IDX_DIR"                 # read by the EXIT trap; the index outlives no run
IDX="$IDX_DIR/private.index"
export GIT_INDEX_FILE="$IDX"
rm -f "$GIT_INDEX_FILE"
git read-tree "$HEAD0"
if ! git add -- "${PATHS[@]}" 2>"$IDX_DIR/add.err"; then
  sed 's/^/  /' "$IDX_DIR/add.err" >&2 || true
  echo "REFUSE: could not stage a declared path." >&2
  if [ -n "$GIT_PREFIX_" ]; then
    echo "  You invoked from '${GIT_PREFIX_}' and declared paths here are REPO-ROOT-RELATIVE," >&2
    echo "  the same plane GATE 1 and safe-commit.sh use. Prepend the prefix yourself:" >&2
    for _p in "${PATHS[@]}"; do echo "      ${GIT_PREFIX_}${_p}" >&2; done
    echo "  This tool deliberately does NOT prefix for you: prefixing let a root-relative" >&2
    echo "  declaration silently commit a DIFFERENT file, with GATE 1 agreeing (in an earlier version)." >&2
  fi
  exit 2
fi

# ── DELETIONS — `git add` on a worktree-absent path is a NO-OP ────────────────
# `read-tree "$HEAD0"` has already re-seated every old blob, and `git add` cannot express a
# removal, so WITHOUT this loop a RENAME (delete + add) writes a tree carrying BOTH copies —
# at rc=0, reporting "1 file changed". `active-recall.md`'s recipe names `--force-remove` as
# required for exactly this; the script shipped without it (a serious defect, 2026-09-02).
#
# ⭐ The headline use case was the dangerous one: a memory-shard ROLL is a pure rename, and
# this file's own header names staged memory shards as what the recipe exists for.
#
# Cwd-independent by construction: declared paths are REPO-ROOT-RELATIVE (see the refusal
# above), and this may run from a subdirectory, so resolve against the toplevel rather than
# testing `-e "$_p"` against whatever cwd happens to be.
_ROOT="$(git rev-parse --show-toplevel)"
for _p in "${PATHS[@]}"; do
  if [ ! -e "${_ROOT}/${_p}" ] && git cat-file -e "${HEAD0}:${_p}" 2>/dev/null; then
    git update-index --force-remove -- "$_p" || {
      echo "REFUSE: '$_p' is gone from the worktree and its deletion could not be staged." >&2
      exit 2
    }
  fi
done

# ── RENAME SAFETY — the duplication path `--force-remove` CANNOT reach ────────
# Declaring BOTH endpoints works (GATE 1 below uses --no-renames). The dangerous input is
# declaring ONLY the new path, which is the natural thing to do — `read-tree "$HEAD0"` re-seats
# the old blob, nothing removes it, and the commit lands BOTH copies at rc=0 reporting
# "1 file changed". REPRODUCED on the real tool 2026-09-02: HEAD tree [new.md old.md], rc=0.
#
# ⚠️ The reported mechanism was "git add on a worktree-absent file is a no-op". MEASURED FALSE
# on this git: `git add -- old.md new.md` stages `R100 old.md -> new.md` correctly. The tree
# keeps both ONLY because the old path is never DECLARED, so nothing ever names it. Same serious defect,
# different cause, and the cause is what decides the fix.
#
# Detect it precisely rather than refusing every worktree deletion: for each path this commit
# ADDS, look for a HEAD0 path carrying the SAME BLOB that is now gone from the worktree and was
# not declared. That is a rename and nothing else.
_ADDED="$(git diff --cached --name-only --no-renames --diff-filter=A "$HEAD0" || true)"
if [ -n "$_ADDED" ]; then
  _TREE0="$(git ls-tree -r "$HEAD0")"
  while IFS= read -r _a; do
    [ -n "$_a" ] || continue
    _ablob="$(git rev-parse ":${_a}" 2>/dev/null || true)"
    [ -n "$_ablob" ] || continue
    while IFS= read -r _old; do
      [ -n "$_old" ] || continue
      [ -e "${_ROOT}/${_old}" ] && continue
      case " ${PATHS[*]} " in *" ${_old} "*) continue ;; esac
      echo "REFUSE: '$_a' looks like a RENAME of '$_old', which you did NOT declare." >&2
      echo "        '$_old' is gone from your worktree but still in HEAD, and this tool" >&2
      echo "        rebuilds its index from HEAD — so it would commit BOTH copies at rc=0" >&2
      echo "        and report '1 file changed'. A memory-shard roll is exactly this shape." >&2
      echo "  Declare BOTH endpoints:  -- ${_old} ${_a}" >&2
      exit 9
    done <<< "$(printf '%s\n' "$_TREE0" | awk -v b="$_ablob" -F'\t' '{split($1,f," "); if (f[3]==b) print $2}')"
  done <<< "$_ADDED"
fi

# ── GATE — a DECLARATION-EXPANSION control, NOT a foreign-path control ────────
# Foreign paths cannot enter here by construction (read-tree HEAD0 then add of declared paths
# only), so this is not what stops them. What it catches is a declared set that does not match
# what actually staged — five structurally different real inputs in testing (a glob, `:/` root
# magic, a subdirectory-relative path, a case variant, a newline path) and one everyday one:
# a declared path that turns out byte-identical to HEAD.
# ⛔ `--no-renames` IS LOAD-BEARING. Without it git COLLAPSES a rename to the NEW path alone,
# so declaring BOTH endpoints — the correct thing to do — produced STAGED={new} vs
# DECLARED={old,new} and this gate refused, telling the operator the old path was
# "byte-identical to HEAD" and to drop it. Dropping it is what commits both copies.
# THE CAREFUL OPERATOR WAS THE ONE WHO GOT BURNED (a serious defect, 2026-09-02).
STAGED="$(git diff --cached --name-only --no-renames "$HEAD0" | sort)"
DECLARED="$(printf '%s\n' "${PATHS[@]}" | sort)"
if [ "$STAGED" != "$DECLARED" ]; then
  # DISTINCT causes get distinct messages. One message for all of them reads as the codified
  # peer-collision signature and sends the operator hunting a collision that does not exist.
  MISSING="$(comm -13 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$DECLARED") || true)"
  EXTRA="$(comm -23 <(printf '%s\n' "$STAGED") <(printf '%s\n' "$DECLARED") || true)"
  echo "REFUSE: the staged set does not match what you declared." >&2
  [ -n "$MISSING" ] && {
    echo "  DECLARED BUT DID NOT STAGE:" >&2
    # ⛔ Do NOT say "byte-identical to HEAD" unconditionally. It said exactly that until
    # 2026-09-02, and for a path DELETED from the worktree the advice that followed —
    # "drop the unchanged path(s) and re-run" — produced the serious duplicated-rename defect it was
    # meant to help with. THE CAREFUL OPERATOR WAS THE ONE WHO GOT BURNED. Name which
    # case each path is actually in; the two want opposite actions.
    while IFS= read -r _m; do
      [ -z "$_m" ] && continue
      if [ ! -e "${_ROOT}/${_m}" ]; then
        echo "    $_m  <- GONE from your worktree, not unchanged. Do NOT drop it." >&2
      else
        echo "    $_m  <- byte-identical to HEAD; dropping it and re-running is correct." >&2
      fi
    done <<< "$MISSING"
    echo "  This is NOT a peer collision." >&2
  }
  [ -n "$EXTRA" ] && {
    echo "  STAGED BUT NOT DECLARED — a glob, a directory, root magic, or a SPELLING mismatch:" >&2
    printf '%s\n' "$EXTRA" | sed 's/^/    /' >&2
    echo "  Declare each FILE explicitly, repo-root-relative." >&2
    [ -n "$GIT_PREFIX_" ] && \
      echo "  You are in '${GIT_PREFIX_}': a cwd-relative spelling stages under that prefix and will" >&2 && \
      echo "  read as 'not declared' here. That is a SPELLING mismatch, not an expansion." >&2
  }
  exit 3
fi

# ── DELETION GATE — added 2026-08-30 after a reproduced SILENT REVERT ─────────
# ⛔ `git add` re-reads the WORKTREE. If a peer's COMMIT is ahead of your worktree for a path
# you declare, this tool commits your stale snapshot and DELETES their line at rc=0 with no
# refusal. Reproduced end to end on my own tool before this gate existed:
#     HEAD:shared.txt  -> [L1, PEER-COMMITTED-LINE]
#     worktree         -> [L1, MY-LINE]          (stale)
#     rc=0, HEAD after -> [L1, MY-LINE]          the peer's committed line GONE
#
# WHAT MAKES IT SHARP, and it is why this gate is not optional: that stale-worktree state is
# what the fleet's OTHER codified recipe produces BY CONSTRUCTION. active-recall.md's
# HAND-STAGED HUNK ISOLATION clause 3 says the hand-staged blob "never lands in the working
# copy, so the NEXT peer to `git add` that shared file commits a snapshot missing your lines and
# SILENTLY REVERTS them." This tool IS that next peer. Two codified recipes, and one manufactures
# the precondition the other could not see. `safe-commit.sh` has a deletion gate; this tool is its
# successor for the one collision state where its GATE 1 refuses, and it shipped without one.
#
# CONSERVATIVE BY DESIGN: this REFUSES on any deletion rather than accepting a declared count.
# ⛔ AND `--del N` IS NOT THE END STATE — THIS COMMENT NAMED IT AS "the likely end state" UNTIL
# 2026-09-04, AND ITS OWN SIBLING HAD ALREADY MEASURED IT INSUFFICIENT. safe-commit's declared
# count verifies ARITY, not PROVENANCE, and the operator supplies that number from the same
# reading that is already wrong — so the gate CONFIRMS the mistake instead of catching it.
# Measured on the sibling tool: a seat declared `--add 58 --del 3`, the staged set matched the
# declared set, they read all three deletions and confirmed those were theirs, and never read
# the 58 additions — one of which was a peer's line, swept at rc=0. Importing that shape
# here would put an arity check on the one axis
# that is purely a provenance question: is this deleted line MINE, or a peer's committed line
# my worktree is stale for? A number the operator types cannot answer it.
# WHAT WOULD: an instrument that decides provenance without asking — e.g. attributing each
# deleted line to the commit that introduced it — which is real design and is NOT built. Until
# then refusing is strictly safer and forecloses nothing, and the refusal now NAMES the exit
# for the state where safe-commit refuses too (see the deletion-gate refusal below).
#
# ⭐ THE SHARPER FORM OF THE ARGUMENT:
# **A DECLARED COUNT CAN BE SATISFIED. A REFUSAL CANNOT.** The arity
# number's only mechanism is forcing the operator to look, and a MATCHING number RELEASES that
# attention — which is exactly what the measured case shows. The seat declared 58/3, the numbers
# matched, attention was released, and the swept line sat in the 58 nobody re-read. The gate did
# not fail to catch the defect; it ISSUED A RECEIPT FOR A READING THAT HAD NOT HAPPENED. A
# refusal has no satisfying input, so the read is unconditional.
#
# ⛔ AND `safe-commit.sh` KEEPING `--del N` IS NOT AN INCONSISTENCY TO "FIX" — THE TWO TOOLS FACE
# DIFFERENT PLANES. safe-commit commits BARE from the SHARED index, where a peer's staged paths
# can enter between its gate and its commit; its `--del` is a tripwire on a plane the operator
# does NOT control, so a mismatch there means SOMEONE ELSE MOVED, which is real information. This
# tool OWNS its index by construction — no foreign path can enter — so the only way a deletion
# appears is that the operator's own worktree is stale against HEAD, which is purely their own
# provenance question and the one thing a self-supplied number cannot answer. Same flag, two
# jobs, because the planes differ.
# ⛔ BINARIES FIRST — the line gate below is STRUCTURALLY BLIND to them. `git diff --numstat`
# prints `-` for a binary path and `awk '{s+=$2}'` coerces `-` to 0, so a binary sailed
# through at rc=0 reporting "0 deletions" and could silently revert a peer's committed blob
# from a stale worktree. Measured with a discriminating control, same gate, two inputs:
# blob.bin -> DELETIONS=0, PASS; file.txt -> DELETIONS=7, REFUSE (a serious defect, 2026-09-02).
#
# Line-counting cannot speak for a binary, so ask a question it CAN answer: was this blob
# already in HEAD? An ADDED binary reverts nothing and is safe. A MODIFIED or DELETED one is
# precisely the stale-worktree revert this gate exists to stop, so it refuses.
BIN_RISK="$(git diff --cached --numstat "$HEAD0" \
  | awk -F'\t' '$1=="-" && $2=="-" {print $3}' \
  | while IFS= read -r _b; do
      [ -n "$_b" ] || continue
      # ⛔ `if`, NOT `cmd && printf`. `git cat-file -e` exits 128 for a blob absent from HEAD —
      # the ADDED-binary case, i.e. the SAFE one — and that status becomes the while loop's,
      # then the command substitution's, then kills the script under `set -e` at rc=128 with
      # NO message. Caught only because a self-test arm carries a control that must SUCCEED; every
      # refusing arm passed while the tool was aborting on every clean binary add.
      if git cat-file -e "${HEAD0}:${_b}" 2>/dev/null; then printf '%s\n' "$_b"; fi
    done)"
if [ -n "$BIN_RISK" ]; then
  echo "REFUSE: this commit MODIFIES or REMOVES a binary that is already in HEAD, and this" >&2
  echo "        tool's deletion gate counts LINES — it cannot speak for a binary at all." >&2
  printf '%s\n' "$BIN_RISK" | sed 's/^/    /' >&2
  echo "  Until 2026-09-02 this read as '0 deletions' and PASSED. Commit the binary with" >&2
  echo "  safe-commit.sh, or split it into its own commit you have verified by hand." >&2
  exit 8
fi
DELETIONS="$(git diff --cached --numstat "$HEAD0" | awk '{s+=$2} END {print s+0}')"
if [ "${DELETIONS:-0}" -gt 0 ]; then
  echo "REFUSE: this commit would DELETE $DELETIONS line(s), and this tool has no way to tell" >&2
  echo "        your intended deletion from a peer's committed line your worktree is stale for." >&2
  echo "" >&2
  echo "  The lines it would remove:" >&2
  # ⛔ AWK ON HUNK POSITION, NOT `grep -v '^---'`. A CONTENT line beginning `--` renders as
  # `---…` in the diff, indistinguishable by prefix from the `--- a/<path>` header — so the
  # old form ate every such line AND, because the second grep then matched nothing, exited 1
  # and ABORTED this refusal under `set -euo pipefail`. Measured: a file whose two deleted
  # lines were `-- alpha` / `-- beta` printed NOTHING and killed the block before `exit 8`.
  # Both halves are bad and the silent one is worse — this listing exists so the operator can
  # read the lines and decide whose they are, and it showed an empty list. `bash-environment.md`
  # codifies exactly this ("NEVER `grep '^-[^-]'` … strip headers by full token"); the tool
  # shipped the defect anyway. Position is the only sound discriminator: content lines are the
  # `-` lines that follow a `@@` hunk header, and `diff --git` resets the state for each file.
  # ⭐ EACH DELETED LINE IS SHOWN WITH THE COMMIT THAT INTRODUCED IT.
  # The listing alone told the operator to "decide whose they are" and gave
  # them nothing to decide WITH — the provenance question this gate exists for was handed
  # back unanswered. `git blame` on the HEAD0 side answers it exactly: a line you wrote shows
  # your own commit, and a line a peer committed while your worktree sat stale shows theirs.
  # ⛔ THIS IS NOT A GATE AND MUST NOT BECOME ONE. It cannot be SATISFIED — there is no input
  # that makes it pass — which is the property the `--del N` strike above turns on. It informs
  # the unconditional read; it does not replace it. An automatic "this sha is not yours ⇒
  # refuse" would be a gate keyed on the `Claude-Session:` trailer, and that trailer is a
  # PARTITION, never an identity (three spellings measured on one seat, ~10% URL-form).
  # ⛔ ONE BLAME PER FILE — AND THIS COMMENT USED TO ASSERT THAT WHILE THE CALL SAT INSIDE THE
  # READ LOOP (verified at source). Per-line blame was one fork per
  # DELETED LINE: measured 7.1-12.6 s per call against a large tracker file, so ~13 deleted
  # lines exceeded the Bash tool's 120 s default and the run was KILLED MID-LISTING. Everything
  # below this function — the legend, the refresh-your-worktree line, the both-tools-refuse exit
  # route — prints AFTER it, so the operator in exactly the state this file exists for got a
  # partial annotation and NONE of the guidance. Break-even was about two lines; archiving three
  # tracker rows is ~27.
  #
  # Failure is SILENT AND NON-FATAL by construction — under `set -euo pipefail` a blame that
  # cannot resolve must not kill the refusal it is annotating, which is the exact defect the
  # comment above records. Worst case the operator gets the old bare listing.
  #
  # ⚠️ ONE DELIBERATE OUTPUT CHANGE beyond the perf fix, named rather than slipped in: the `^`
  # boundary marker `git blame -s` puts on a first-in-range commit is STRIPPED. The old listing
  # printed `^<commit-id>`, which does not resolve if the operator pastes it into `git show`, and
  # resolving it is the entire point of the annotation. Otherwise the two implementations were
  # verified byte-identical on a two-commit fixture (15 deleted lines, two distinct shas, so a
  # smeared or off-by-one join would have shown).
  #
  # ⚠️ The join guard is `FILENAME==M`, NOT the idiomatic `NR==FNR`, and the difference is
  # load-bearing on the DEGRADED path: when every blame fails the map file is EMPTY, and
  # `NR==FNR` is then true for the PLAN's lines instead — awk consumes the plan as the map and
  # the listing comes out BLANK. That is the one path this annotation most needs to survive.
  _blame_annotate() {
    local plan map ages f
    plan=$(mktemp) || return 1
    map=$(mktemp) || { rm -f "$plan"; return 1; }
    git diff --cached -U0 "$HEAD0" \
      | awk '/^diff --git/{f=$3; sub(/^a\//,"",f); h=0; next}
             /^@@/{match($0,/-[0-9]+/); ol=substr($0,RSTART+1,RLENGTH-1)+0; h=1; next}
             h && /^-/{print f "\t" ol "\t" substr($0,2); ol++}' > "$plan"
    # `git blame -s` emits the file's lines IN ORDER, so awk's NR is the line number.
    cut -f1 "$plan" | sort -u | while IFS= read -r f; do
      [ -n "$f" ] || continue
      git blame -s "$HEAD0" -- "$f" 2>/dev/null \
        | awk -v F="$f" '{ s=$1; sub(/^\^/,"",s); print F "\t" NR "\t" s }'
    done > "$map"
    # ⭐ AGE PER SHA, and it is the discriminator the bare sha does not give (2026-09-05).
    # The question this listing serves is "is this a peer's committed line my worktree is
    # STALE for?" — and staleness is a TIME fact, not an authorship one. `%cr` answers it
    # without attributing anything to anybody.
    # ⛔ READ THE OLD LINES FIRST — AGE DOES NOT RANK RISK IN THE DIRECTION IT READS, AND
    # THIS COMMENT SAID THE OPPOSITE UNTIL 2026-09-05. It read "a line introduced minutes
    # ago is the stale-worktree shape; one from days ago is almost certainly a deletion you
    # meant." Measured backwards, over 1,220 deleted-line observations in two disjoint
    # windows (blame -> introducing commit -> trailer, seat ids normalised): <10 min 98.0%
    # SAME SEAT, 10-60 min 99.4%, 1-6 h 94.1%, 1-7 d 38.4%. Sub-hour pooled: 376 same / 3
    # other = 99.2% YOUR OWN line, with exactly one cross-seat deletion under six hours in
    # the whole sample. So a RECENT sha is the safe reading and an OLD one is the suspicious
    # one. Bound the lens stated against itself: session ids are per-session, so the >7 d
    # figure is partly tautological and nothing here leans on it; the sub-hour half carries
    # no such confound and is the half the old text got backwards.
    # ⛔ DELIBERATELY NOT AUTHORSHIP. The block above forecloses a gate keyed on the
    # `Claude-Session:` trailer because it PARTITIONS rather than identifies; the same
    # argument kills the tempting variant "pass when every deleted line traces to a commit
    # I ran", because a peer's uncommitted line SWEPT INTO my commit blames to MY sha.
    # ⚠️ That is NOT "the exact case this gate exists for", which this comment claimed until
    # 2026-09-05. The gate's case is a peer's COMMITTED line against a stale worktree — a
    # DELETION. The sweep is a peer's UNCOMMITTED line riding in — an ADDITION, routed to a
    # different mitigation. The sweep only reaches this listing via a COMPOUND two-step: the
    # sweep, then a later stale deletion of the swept line. Asserting identity inflated a
    # compound event into the base rate. Age is a fact about the commit and carries no
    # identity claim — but it CAN be satisfied: a reading that matches expectation releases
    # the attention that was the mechanism (the declared-count argument above), and on the
    # compound case it mis-reads, showing your own sweeping commit's age for a peer's line.
    # One `git show` per unique sha OF THE DELETED LINES — join $plan against $map first.
    # ⛔ `cut -f3 "$map" | sort -u` was the shipped form and it is a REGRESSION: $map is the
    # WHOLE-FILE blame, so it uniques every sha in the file. Measured 2026-09-05 on a large
    # tracker file: 26,338 blamed lines, 2,349 unique shas, one fork each, ~89.5 s against the
    # Bash tool's 120 s default — so everything after this point (the legend, the refresh
    # line, the both-tools-refuse exit) never printed. Verbatim the failure the one-blame-per-file
    # fix exists to prevent. The correct set is the deleted lines' own: median 1, mean 2.0, max 10 over
    # 80 real commits. The two-commit fixture could not catch it — two commits give two shas
    # either way, a positive control drawn from the population the predicate already handles.
    ages=$(mktemp) || { rm -f "$plan" "$map"; return 1; }
    awk -F'\t' -v M="$map" 'FILENAME==M { sha[$1 FS $2]=$3; next }
                            { k=$1 FS $2; if (k in sha) print sha[k] }' "$map" "$plan" \
      | sort -u | while IFS= read -r s; do
      [ -n "$s" ] || continue
      printf '%s\t%s\n' "$s" "$(git show -s --format=%cr "$s" 2>/dev/null || echo '?')"
    done > "$ages"
    awk -F'\t' -v M="$map" -v A="$ages" '
      FILENAME==A { age[$1]=$2; next }
      FILENAME==M { sha[$1 FS $2]=$3; next }
      { k=$1 FS $2; s=(k in sha) ? sha[k] : "????????";
        a=(s in age && age[s] != "") ? age[s] : "age unknown";
        printf "    %s  (%s)  %s\n", s, a, $3 }
    ' "$ages" "$map" "$plan"
    rm -f "$plan" "$map" "$ages"
  }
  _blame_annotate >&2 || git diff --cached -U0 "$HEAD0" \
    | awk '/^diff --git/{h=0} /^@@/{h=1;next} h && /^-/' \
    | sed 's/^/    /' >&2
  echo "" >&2
  echo "  The sha on each line is the commit that INTRODUCED it, and the parenthesis is that" >&2
  echo "  commit's AGE. One of yours means you are deleting your own work; one you do not" >&2
  echo "  recognise means your worktree is behind HEAD for that path — refresh it and re-run" >&2
  echo "  rather than committing this snapshot." >&2
  echo "  Read the OLD lines first: measured over 1,220 deleted lines, a sha under an hour old" >&2
  echo "  is 99.2% YOUR OWN work, so recency is the safe reading and age is the suspicious one" >&2
  echo "  — the opposite of how the column reads." >&2
  echo "  ⛔ ONE BLINDNESS THE AGE CANNOT SEE: a peer line SWEPT into your own commit carries" >&2
  echo "  YOUR timestamp, so it renders as recent and reads as safe. Age inherits that blind" >&2
  echo "  spot from blame whole — it is the same reason a trailer-keyed gate was refused here." >&2
  echo "" >&2
  echo "  If any of those are a PEER's, your worktree is behind HEAD for a declared path —" >&2
  echo "  refresh it (git diff HEAD -- <path>) before re-running. If they are all yours, commit" >&2
  echo "  with safe-commit.sh, which gates a DECLARED deletion count." >&2
  echo "" >&2
  # ⛔ THE CIRCLE — added 2026-09-04 after the state was hit TWICE in one day by two seats.
  # The line above sends the operator to safe-commit.sh, and there is exactly one state where
  # that is a dead end: safe-commit's GATE 1 compares the WHOLE staged set (the index is
  # per-REPO) against your declared paths, so while ANY peer holds ANY path staged it refuses
  # in EVERY mode, `--staged` included. A deletion-bearing diff in that state has NO gated
  # route — this tool refuses on the deletion, that one refuses on the foreign path, both
  # correctly, and the operator who follows this message arrives back where they started.
  # Measured: one seat at 2026-09-04 00:37Z and another ~21h later, same corner, same
  # fallback reached independently. Naming the exit here is what stops the third seat
  # composing one under pressure.
  echo "  ⛔ IF safe-commit.sh ALSO REFUSED (GATE 1, a peer holds a path staged), the two gated" >&2
  echo "     routes have ZERO overlap on this diff shape and there is no third gate. The" >&2
  echo "     documented exit, in this order:" >&2
  echo "       1. git diff -U0 HEAD -- <your declared paths>   # READ IT — every changed line" >&2
  echo "          must be yours. This closes the foreign-CONTENT axis by hand, which is the" >&2
  echo "          axis no gate is left to close." >&2
  echo "       2. git commit -o <your declared paths> -F <msgfile>" >&2
  echo "       3. Say IN THE COMMIT BODY that no gate sanctioned it and that you read the" >&2
  echo "          diff instead. An ungated commit that says so is auditable; a silent one is" >&2
  echo "          indistinguishable from a swept one." >&2
  echo "     -o is correct on the foreign-PATHS axis ONLY. It re-reads the worktree for the" >&2
  echo "     paths you name, so step 1 is not optional — it IS the gate." >&2
  exit 8
fi

echo "── staged content (READ THIS: the foreign-CONTENT axis is NOT closed) ──"
git diff --cached -U0 "$HEAD0"

# ── PARSE GATE over the STAGED BLOBS — the only gate here that reads CONTENT ──
# Every other gate in this file is on the NAME plane (declared paths vs the staged
# set), and `tsc` (and the source project's pre-push hook) compiles the WORKTREE. So nothing
# in this repo reads the tree being COMMITTED, and a green tsc has twice coexisted
# with a broken blob in the commit: once a `const` spliced between a
# declaration and its initializer in a page component, and once a blob carrying
# 99 parse diagnostics, since repaired. Both arrived through hunk-isolated
# `git apply --cached`, where index and worktree legitimately differ and every
# existing gate reads the side that is fine.
# ⚠️ WHAT IT CLOSES *HERE*, precisely, because the two call sites differ: this
# tool `git add`s every declared path, so the blob it commits is the WORKTREE at
# add-time and the shared index's hunk-isolated state cannot survive into it.
# The gate therefore closes "the worktree moved since anyone last ran tsc" —
# the problem's second half. The index-vs-worktree divergence ITSELF is closed by
# the same helper wired into safe-commit.sh --staged, which commits the index as
# it stands. Claiming both here would be a coverage claim this call site cannot
# carry (self-test arms 25-27 say the same thing).
# BLOCK, not warn, and the FP rate is MEASURED rather than assumed: the predicate
# is the TypeScript parser's own `parseDiagnostics`, which carries no semantic
# diagnostics at all, and it returned 0 findings over all 2,871 tracked
# .ts/.tsx/.mts/.mjs files in 2.77 s (2026-09-05). Controls live in
# `staged-parse-check.mjs --self-test`: the broken blob must go RED, its
# repair and HEAD must not.
PARSE_PATHS=()
while IFS= read -r _pp; do
  case "$_pp" in *.ts|*.tsx|*.mts|*.mjs) PARSE_PATHS+=("$_pp") ;; esac
done < <(git diff --cached --name-only --diff-filter=ACMR "$HEAD0")
if [ "${#PARSE_PATHS[@]}" -eq 0 ]; then
  # SKIPPED is not CLEAN. Say which one this was, or a silent line reads as coverage.
  echo "parse gate: SKIPPED — no .ts/.tsx/.mts/.mjs path in the staged set."
else
  _PARSER="$(dirname "$SELF_PATH")/staged-parse-check.mjs"
  if [ ! -f "$_PARSER" ]; then
    echo "REFUSE: staged-parse-check.mjs is missing next to this script ($_PARSER)." >&2
    echo "        ${#PARSE_PATHS[@]} TypeScript path(s) are staged and the only gate that reads the" >&2
    echo "        COMMITTED bytes cannot run. Refusing rather than committing unread blobs." >&2
    exit 9
  fi
  _prc=0
  node "$_PARSER" --staged "${PARSE_PATHS[@]}" || _prc=$?
  if [ "$_prc" -ne 0 ]; then
    echo "REFUSE: parse gate failed (rc=$_prc) — nothing was committed, the branch did not move." >&2
    exit 9
  fi
fi

TREE="$(git write-tree)"
# Currently UNREACHABLE: the gate above passing implies a non-empty staged diff, which implies
# TREE != PARENT_TREE. Kept as defence in depth against a future gate change; do NOT cite it as
# evidence that the empty-delta case is tested, because nothing exercises this line.
if [ "$TREE" = "$PARENT_TREE" ]; then
  echo "REFUSE: tree identical to parent — empty delta." >&2
  exit 4
fi

SID8="${CLAUDE_CODE_SESSION_ID:-}"; SID8="${SID8%%-*}"   # read through :- first: bash 4+ aborts on the bare ${VAR%%-*} when VAR is unset
MSG_T="$(dirname "$IDX")/msg.trailered"
if [ -n "$SID8" ]; then
  # --if-exists doNothing: idempotent, so a message already carrying the trailer keeps one line.
  git interpret-trailers --if-exists doNothing --trailer "Claude-Session: $SID8" "$MSG" > "$MSG_T"
else
  # ⛔ SAY SO. An absent CLAUDE_CODE_SESSION_ID lands here SILENTLY. The bare `${VAR%%-*}` skips
  # `set -u`'s unbound check on bash 3.2 only; bash 4 and later abort on it (measured 2026-10-21:
  # 3.2.57 reads it as empty; on 5.2.15 this script exits 1, and a `set -euo pipefail` probe exits 1
  # on 4.3 and 4.4 too — 127 is what a bare `bash -c 'set -u; …'` returns, not this script), hence
  # the `:-` read above, so both unset and empty reach this
  # branch on every bash and fall through to a commit with NO `Claude-Session` trailer.
  # That trailer is the fleet's primary attribution instrument, and this tool is reached for
  # precisely on contended shared files, so dropping it quietly is worst exactly where it
  # costs most. Omitting it stays right — an empty trailer is worse than none — but it is now
  # loud. Not fatal: a commit with no trailer is still a correct commit.
  echo "NOTE: CLAUDE_CODE_SESSION_ID is unset or empty — committing with NO Claude-Session" >&2
  echo "      trailer. Attribution for this commit will rest on its message alone." >&2
  cp "$MSG" "$MSG_T"
fi

C="$(git commit-tree "$TREE" -p "$HEAD0" -F "$MSG_T")"
unset GIT_INDEX_FILE

# TEST SEAM — the only way to exercise the CAS deterministically. Unset in every real run.
# TEST SEAM — it `eval`s an environment variable inside a tool that moves branch refs, so it
# is gated STRUCTURALLY rather than by trust: it fires only when the repo under the cwd is NOT
# the repo this script lives in. The self-test drives throwaway fixtures under mktemp, which
# differ; a real invocation in this repo does not, so an exported variable cannot reach it.
if [ -n "${PRIVATE_INDEX_COMMIT_TEST_RACE:-}" ]; then
  # ⛔ $SELF_PATH, NOT $0 — and BOTH sides guarded for emptiness. As shipped this
  # read `dirname "$0"`, which runs AFTER the cd to the toplevel: with a relative $0 that is ".",
  # so ".." is the repo's PARENT, rev-parse fails, and _SELF_REPO becomes "". Only _CWD_REPO was
  # guarded, so "" compared as "a different repo" and the seam FIRED inside the tool's own repo.
  # Measured: relative $0 rc=0 payload EXECUTED and HEAD MOVED; absolute $0 rc=2 refused.
  # An unresolvable side now REFUSES — for a gate on arbitrary eval, undecidable must mean no.
  # ⛔ THE SCRIPT'S OWN DIRECTORY, NOT ITS PARENT. This read `dirname "$SELF_PATH"/..` until
  # 2026-09-02, which silently assumes the script sits EXACTLY ONE LEVEL DEEP. With the script
  # at a repo ROOT, `..` is the repo's PARENT: `rev-parse` fails there, `_SELF_REPO` becomes
  # empty, and the unguarded comparison against a non-empty `_CWD_REPO` reads "a different
  # repo" — so THE SEAM OPENS AND RUNS ARBITRARY SHELL IN THE TOOL'S OWN REPO.
  #
  # REPRODUCED, two fresh repos, one variable:
  #   script at repo ROOT        rc=0   payload RAN
  #   script in scripts/         rc=2   payload did not run   <- control
  #
  # ⚠️ AND WHY MY OWN CHECK MISSED IT, which is the reusable part: I varied the CWD (root vs a
  # subdirectory) and read `self == cwd` both times. `_SELF_REPO` does not depend on the cwd AT
  # ALL — it is computed from `$SELF_PATH`. I varied the one input the expression ignores, got a
  # clean result twice, and reported the finding as not reproducing. The variable is WHERE THE
  # SCRIPT SITS.
  #
  # Dropping `/..` is correct for every case rather than just this one: from INSIDE a repo,
  # `rev-parse --show-toplevel` returns the toplevel from any depth, so root and `scripts/` both
  # resolve to the repo. A copy under mktemp still resolves to empty (genuinely not in a repo),
  # which keeps the fixture case firing — that is ARM 8's requirement and the reason the
  # emptiness asymmetry below exists.
  _SELF_REPO="$(cd "$(dirname "$SELF_PATH")" && git rev-parse --path-format=absolute --show-toplevel 2>/dev/null || echo "")"
  _CWD_REPO="$(git rev-parse --path-format=absolute --show-toplevel 2>/dev/null || echo "")"
  # ⛔ ONLY _CWD_REPO IS GUARDED FOR EMPTINESS, AND THAT ASYMMETRY IS DELIBERATE — my first fix
  # guarded BOTH and mutation testing caught it breaking ARM 8. With $SELF_PATH resolved
  # before any cd, an empty _SELF_REPO no longer means "the resolution broke"; it means the script
  # genuinely does not live in a git repo (a copy under mktemp — which is exactly how the harness
  # runs it). Such a script CANNOT be "its own repo", so firing there is correct, and refusing
  # made the CAS arm unrunnable: baseline went 34/34 -> 32/34 the moment the suite ran from a copy.
  # Measured: with $SELF_PATH in place, removing this block changes nothing (mutation M3 GREEN
  # 34/34) — the real fix is the resolution, this is the undecidable-CWD case only.
  if [ -z "$_CWD_REPO" ]; then
    echo "REFUSE: PRIVATE_INDEX_COMMIT_TEST_RACE is set and the seam gate cannot resolve the CWD" >&2
    echo "        repo. The seam runs arbitrary shell; an undecidable gate on that must refuse." >&2
    exit 2
  fi
  if [ "$_CWD_REPO" != "$_SELF_REPO" ]; then
    echo "NOTE: PRIVATE_INDEX_COMMIT_TEST_RACE seam firing in fixture repo $_CWD_REPO" >&2
    eval "$PRIVATE_INDEX_COMMIT_TEST_RACE"
  else
    echo "REFUSE: PRIVATE_INDEX_COMMIT_TEST_RACE is set but this is the tool's OWN repo." >&2
    echo "        The seam runs arbitrary shell and is fixture-only. Unset it." >&2
    exit 2
  fi
fi

# ⛔ RE-DERIVE THE BRANCH RIGHT BEFORE THE WRITE (2026-09-08,
# measured in a throwaway repo): BRANCH was read at the top of this run, and a `git switch` in
# the shared checkout during the run — the dev cutover, or any checkout — makes the CAS below
# SUCCEED on the branch HEAD USED to point at. Readout: success; reality: a commit stranded on a
# branch nobody is on, reading UNCOMMITTED on the current one. A true lock collision fails loud
# in both directions; this whole-run window was the only silent loss. Refuse with its own code
# (10) so a self-test cannot mistake it for the CAS loss (7).
BRANCH_NOW="$(git symbolic-ref -q HEAD || true)"
if [ "$BRANCH_NOW" != "$BRANCH" ]; then
  echo "REFUSE: HEAD moved from '$BRANCH' to '${BRANCH_NOW:-<detached>}' while this run was building" >&2
  echo "        the commit. It was built for '$BRANCH' and would land on a branch you are no longer" >&2
  echo "        on. Nothing was written; the worktree is untouched — re-run on the branch you want." >&2
  exit 10
fi

# compare-and-swap on the DERIVED branch: FAILS rather than clobbers if a peer moved it.
if ! git update-ref -m "private-index-commit" "$BRANCH" "$C" "$HEAD0" 2>/tmp/pic-updateref.$$; then
  # ⛔ These four lines were ONE physical line until 2026-09-02, joined by literal backslash-n.
  # `>&2\n` is not a redirect to fd 2: the word `2n` is not all digits, so bash opened a FILE
  # named `2n` and the operator got NOTHING. `bash -n` cannot see it, the exit code stayed
  # correct, and the self-test was green because its arm read rc and never read the message.
  # The commit that set out to IMPROVE this diagnostic deleted it (a serious defect).
  echo "REFUSE: update-ref did not move the branch. TWO causes, and the message below" >&2
  echo "        discriminates them: the compare-and-swap lost (a peer committed while we" >&2
  echo "        worked), OR a stale/held '.lock' blocked the write. Read it before assuming" >&2
  echo "        a peer — the second fails safe and needs no rebuild, only the lock cleared." >&2
  sed 's/^/  /' /tmp/pic-updateref.$$ >&2 || true
  rm -f /tmp/pic-updateref.$$
  echo "  Your commit object $C exists but is on NO branch. Nothing was clobbered." >&2
  echo "  Re-run: it will rebuild against the new HEAD." >&2
  exit 7
fi
rm -f /tmp/pic-updateref.$$
REF_MOVED="$C"

# LAST step: the shared index still holds PRE-commit blobs for our paths, and until it is
# re-pointed at HEAD a peer's next bare commit would REVERT this change.
git reset -q -- "${PATHS[@]}"

git show --stat --oneline "$C" | cat
echo "branch: ${BRANCH#refs/heads/}   trailer: $(git log -1 --format='%(trailers:key=Claude-Session,valueonly)' | tr -d '\n')"
# LAST LINE, DELIBERATELY — the sha was already surfaced inside `git show --oneline` above, but
# the FINAL line was branch/trailer info, so the house `| tail -1` habit handed the reader the
# wrong thing here exactly as it did in safe-commit.sh. `$C` is the commit object THIS script
# built with `git commit-tree`, so it is race-free by construction: no ref is re-read, and a
# peer commit landing during this run cannot change it (that peer would fail the CAS above).
echo "private-index-commit: committed $C"
