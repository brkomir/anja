# Shell traps — delivered per Bash call, not carried per turn

The `## from` headers below name the `bash-environment.md` sections whose entries were moved into this file; where a named section is missing from this copy's `bash-environment.md`, its original is not in this copy.

⛔ **THIS FILE IS NOT ALWAYS-LOADED AND THAT IS THE POINT.** It is delivered by
`.claude/hooks/shell-trap-inject.sh` (PreToolUse, Bash) which matches the command you are about to
run against each entry's `TRAP keys` and injects only what matches.

**FORMAT, and the hook depends on it exactly.** Every entry is preceded by a header line holding nothing else: `<!--`, one space, `TRAP keys:`, one space, a comma-separated key list, one space, `-->` (no literal example here — the self-test's cap probe parses headers UNANCHORED, so an inline example would become a phantom entry). The injector's own parse is anchored and literal about those spaces, so a header missing one never fires on its own keys and its body is delivered glued to the PREVIOUS entry's (never, if it is the first); the self-test's header-parity arm is what catches it. Keys are `.strip()`ped, so none can begin or end with a space, and match as plain substrings of the command. A `main:` prefix fires the key on the MAIN session only (skipped when the payload carries a string `agent_id`); the prefix is reserved, so no key can literally begin with `main:`. A matched entry is ranked by the FIRST key in its list that the command contains — list order, not the longest match — and entries go longest-ranking-key first for the injector's cap, so list an entry's most specific key first: lengthening a key promotes its entry only on commands where no earlier-listed key of that entry also matches.

<!-- TRAP keys: s/=.*, cut -d=, awk -F=, redact, .env -->
## A `=`-KEYED REDACTION OVER `.env*` PRINTS WHOLE EVERY LINE WITH NO `=` BEFORE ITS SECRET — PRINT ONLY THE KEYS A PARSER RETURNS

`sed -E 's/=.*$/=<redacted>/'`, `cut -d= -f1` and `awk -F=` all key on the `=` a `KEY=value` line carries, so a line without one prints WHOLE under a probe labelled "names only, no values": a commented-out URL (`# db url <connection-string>`), an INDENTED comment, dotenv's `KEY: value` form, and the continuation lines of a multi-line quoted value (a PEM). Dropping `^#` lines fixes only the first — on a synthetic fixture `grep -v '^#' | sed …` still leaked 3 of 4 shapes. A `for f in $(grep -l …)` loop over env files word-splits a file whose name holds a space and never reads it. **Print what a PARSER returns, never a substitution on the value: `node -e 'const fs=require("fs"),d=require("dotenv");for(const f of process.argv.slice(1))console.log(f+": "+Object.keys(d.parse(fs.readFileSync(f))).join(" "))' -- "$f"` (dotenv is a direct dependency; 8 of 8 keys, 0 values on the fixture), and quote the file list (`while IFS= read -r f`).** ⛔ `grep -oE '^[A-Z_]+='` is NOT a safe stand-in: it drops `export X=`, digit-bearing names (`A2_*`) and `KEY = v`, prints an `ABC=` fragment from inside a multi-line value, and over TWO files the `file:` prefix makes it print NOTHING.

<!-- TRAP keys: timeout, gtimeout, ulimit -->
## `timeout` DOES NOT EXIST HERE — it exits 127, and a pipe hides that

No `timeout`, no `gtimeout`: `timeout 60 <cmd>` never runs `<cmd>` at all (rc **127**), and a downstream pipe stage then exits **0**, so the fabricated `0` carries forward as a measurement. Use the Bash tool's own `timeout` parameter (milliseconds), or `perl -e 'alarm <N>; exec @ARGV' -- <cmd>`.

⛔ **NEITHER OF THOSE IS A RESOURCE BOUND, AND THIS LINE ARMED A MEMORY CRASH BY READING LIKE ONE.** A timer bounds DURATION, not RATE — a short ceiling still reaches many GB (measured ~4000× the input, still climbing when killed; archive). **For a runaway-ALLOCATION hazard, bound the RESOURCE — and ⚠️ `ulimit -v` is INOPERATIVE on macOS (`setrlimit failed: invalid argument`, measured 2026-08-26; `-f` did not stop a 200 MB allocation either): on this box bound the INPUT you feed the engine, or run in a container/VM — and name which axis you capped.** ⚠️ Before any bound, ask whether the run should happen at all. Incident record (the ~28 `rc=142` misreads, arm-by-arm): the archive.



## from `bash-environment.md` § zsh does NOT word-split — an unquoted `$VAR` silently changes what runs

<!-- TRAP keys: git show $, git show ${, git show "$, playwright test $, vitest run $, xargs $ -->
- **Brace every ref — `git show ${sha}:${path}`.** ⛔ **THE LIVE SHAPE IS `$sha:` FOLLOWED BY A *LITERAL* PATH — this headline said *never `git show $sha:$path`* until 2026-09-21 and that form is INERT: the modifier needs a MODIFIER LETTER after the colon, and with a variable there the next character is `$`. Measured on one sha and one path, three spellings: literal → prints the COMMIT, `$sha:$path` → the FILE, braced → the FILE. A reader who tests the banned form finds it WORKS and discards the row.** It cost three successive probes of mine, each pre-expanding the thing under test (the FIFTH vacuous-control way). `$VAR:` is a history modifier, and `bad substitution` is the LUCKY half: a VALID modifier expands silently and hands git a DIFFERENT path, surfacing as an ordinary "does not exist". **At least 8 of 14 common repo paths mangle silently — a FLOOR since 2026-09-21, when `src/` and `scripts/` left the loud column; `tests/` and `todo.txt` among them.**

  | after `${sha}:` | result |
  |---|---|
  | `todo.txt` `tests/x.ts` `lib/x.ts` (`:t` `:l`) | first char eaten — `abc1234odo.txt` |
  | `hooks/x.sh` (`:h`) | sha becomes `.` — `.ooks/x.sh` |
  | `eval/x.json` (`:e`) | sha vanishes — `val/x.json` |
  | `app/x.tsx` (`:a`) | rebased onto CWD — `/private/tmp/abc1234pp/x.tsx` |
  | `src/…` `scripts/…` (`:s`) | ⛔ **FAILS BOTH WAYS, and it is LOUD only when the rest of the path supplies no delimiter pair — a REAL path usually does.** `src/x.ts` is loud; a deeper `src/components/…/<name>.tsx` path mangles SILENTLY; ⛔ `scripts/safe-commit.sh` loses the path ENTIRELY, and `git show <sha>` is a VALID command — **rc=0, no stderr, and it prints the COMMIT instead of the file**, so a grep over it answers a different question. ⛔ **BOTH SHAPES OCCUR UNDER BOTH PREFIXES — do NOT read the examples as a prefix partition.** Census of all 1,426 tracked `src/` + `scripts/` paths, each in its own shell, rc and stderr read apart: **629 mangled-path git error · 474 rc=0 PRINTS THE COMMIT · 323 loud** — so silence is **1,103 of 1,426 (77.3%)**, and the expensive rc=0 class is **a third of all real paths with 312 of its 474 under `src/`**, the prefix the examples assign to the merely-mangling case. Measured twice independently, unit-identical. Archive |
  | `plans/` `public/` `package.json` `messages/` `docs/` `.claude/` | ok |


<!-- TRAP keys: ${!, declare -A, typeset -A -->
- **If bracing does NOT fix a `bad substitution`, you are in the other class:** `${!ARR[@]}` is bash-only and `/bin/bash` here is 3.2.57 with no `declare -A` at all. zsh: `typeset -A M; M[a]=1`, keys via `${(k)M}`; cheapest escape is two parallel arrays.

<!-- TRAP keys: set -u, set -euo pipefail -->
- ⛔ **UNDER `set -u` ON BASH 3.2, EXPANDING AN *EMPTY* ARRAY IS AN UNBOUND-VARIABLE ERROR — AND 13 REPO SCRIPTS RUN `set -euo pipefail`.** `A=(); echo "${A[@]}"` aborts (`A[@]: unbound variable`); bash 4.4+ returns empty, which is where the habit comes from. **Guard every array expansion that can be empty: `${A[@]+"${A[@]}"}`.** The failure is total, not partial — the script dies before its first check, so a GATE built this way refuses everything rather than passing everything (measured at two fleet choke points; one blocked the entire push queue).

<!-- TRAP keys: local, readonly, declare -->
- ⛔ **ONE DECLARATION PER DEPENDENT ASSIGNMENT — A VARIABLE ASSIGNED EARLIER IN THE SAME `local` / `export` / `declare` / `readonly` STATEMENT IS UNBOUND TO THE ASSIGNMENTS AFTER IT, AND ONLY `set -u` MAKES THAT LOUD.** `local leg="$1" tee="$RUN/effect-$leg.txt"` died `leg: unbound variable` on the judge-effect launcher's first PAID launch (2026-09-13) after BOTH dry runs passed — the dry path never entered the function. Without `-u` the same line builds `effect-.txt` SILENTLY, and with a same-named global in scope a confidently WRONG path (five arms on bash 3.2.57, 2026-09-14). **TELL: a paid launch dies at $0 on a name your dry run never evaluated — and that tell exists only in the `-u` half.** One declaration per sibling-reading assignment, and route the dry run through the paid path's own function.

<!-- TRAP keys: python3 -c ', sh -c ', awk ' -->
- ⛔ **ONE APOSTROPHE IN PROSE CLOSES A SINGLE-QUOTED PAYLOAD — AND ENGLISH POSSESSIVES ARE WHERE IT COMES FROM, NOT SHELL SYNTAX.** `this fleet's corpus` in an embedded COMMENT inside `python3 -c '…'` / `sh -c '…'` / `awk '…'` terminates the payload; the failure surfaces as `unexpected EOF` at a line number in the WRAPPER, far from the word. **Before writing an embedded payload, grep your own text for `'` — and prefer `\x27` or a reworded phrase over escaping.** A guard-authoring session is the likeliest place to hit it.

<!-- TRAP keys: git commit -m -->
- **Use `-F <file>` (or a quoted heredoc) for any commit body with prose — never `-m`.** An embedded `"` ends the argument, `multios` makes a bare `> word` CREATE A FILE, and backticks are COMMAND-SUBSTITUTED into a plausible FALSE sentence. `git commit` exits 0 — read it back with `git log -1 --format=%b`.

<!-- TRAP keys: main:safe-commit.sh, main:commit-tree, main:git commit -->
- **The auto-mode classifier DENIED a commit carrying a production row id, a model name and a critique count as `[Excess Sensitive Detail]` (one denial, trigger unisolated).** 6 m 15 s lost to the retry. **TELL: your body quotes an id you read off production.** Describe the provenance in words instead.

<!-- TRAP keys: main:safe-commit.sh - -->
- **`fatal: cannot lock ref 'HEAD': is at <sha> but expected <sha>` from `safe-commit.sh` means a peer moved HEAD after the gates passed: your commit did NOT land and your declared files are STILL STAGED in the shared index.** Measured 2026-09-24 and 2026-09-30 (the second a peer's commit landing between the gates and the ref update). **TELL: git's `fatal:` line and no `safe-commit: committed <sha>` line after it** (the tool itself now prints NOT COMMITTED … STILL STAGED). Read `git diff --cached -U0 -- <your paths>`, then re-run with `--staged` added (same message, paths and `--del`/`--add`): it commits the blob the gates already passed and refuses if the worktree moved, where an identical default re-run re-`git add`s and takes any line a peer wrote since. Or unstage with `git reset -q -- <your paths>`; never leave them staged while you investigate, because the next seat's bare commit sweeps them.

<!-- TRAP keys: mail-send, session-mail -->
- **The same backticks in an UNQUOTED heredoc mail body are COMMAND-SUBSTITUTED and the mail SENDS SUCCESSFULLY with the names silently erased** — a well-formed sentence, the `Sent to …` ack present, key names gone. Compose backtick-bearing bodies with Write or a QUOTED heredoc, and READ THE BODY BACK from the store file (`sed -n '/^---$/,$p' .claude/state/session-mail/<file>`) before counting it sent — the ack cannot detect erasure.

<!-- TRAP keys: rm -f, NULL_GLOB, echo ==, " == " -->
- **`nomatch`: an unmatched glob ABORTS the command it sits in, `&&` chain included** (`zsh: no matches found`, rc=1), so an `rm -f <glob> && next-step` reports success for work that never ran. ⛔ **INSIDE `$(…)` THE ABORT IS SCOPED TO THE SUBSTITUTION — the enclosing command CONTINUES with an EMPTY result, so `$(ls <glob> 2>/dev/null | wc -l)` prints a clean `0` indistinguishable from an empty set**, the `2>/dev/null` never reaching an error the shell raises before `ls` runs. `setopt NULL_GLOB` or `find <dir> -name '<pat>' -delete`. **Never read "no matches" as an empty set** — `ls <sid>__*.md` read as an EMPTY INBOX when every message was suffixed `.md.read`. ⛔ **TWO SIBLING EXPANSION ERRORS BEHAVE THE SAME AND NEITHER IS A GLOB: an `=`-LEADING WORD (a `====LABEL====` separator) AND A `bad substitution`.** Measured 2026-09-14: at top level each kills the REST OF THE COMMAND LINE, `;`-separated statements included; inside `$(…)` each is scoped and the caller continues with **the output produced BEFORE the error — EMPTY only when the error is the FIRST statement** (5 B, not 0, for `$(echo FIRST; ====L====; echo SECOND)`). A truncated prefix is shaped exactly like a total. Archive. ⛔ **The same `=`-word error hits a bare `==` anywhere: `echo ==` and the `==` in `[ "$a" == "$b" ]` both fail `= not found`, rc=1 (measured 2026-09-26; `[[ … == … ]]` is fine). Quote the separator or write `=` / `[[ ]]`. Over three days of fleet transcripts (2026-09-23..26) it tripped 1,003 times, 996 of them an unquoted `echo ==…` separator; one session alone tripped 20 times before this entry was keyed to deliver on them.**

<!-- TRAP keys: read -r, for path, while read, && path=, ; path=, { path=, local path -->
- **NEVER name a variable `path` / `fpath` / `cdpath` / `manpath` — a loop variable OR a plain assignment (`path=$1` inside a function is the same break) — zsh TIES each to its uppercase array, so `read -r sym path` OVERWRITES `$PATH` and every command in the loop dies `rc=127`.** **TELL: 100% absent — and `2>/dev/null` eats the `command not found` that names it.**


<!-- TRAP keys: source, hooks/lib/ -->
## `source` / `.` IS A POSIX SPECIAL BUILTIN — ITS FAILURE IS FATAL UNDER `set -e`, AND `|| true` CANNOT RESCUE IT

A shared lib that fails to parse kills its consumer outright: measured four arms — corrupt lib under `set -e` **rc=2**, under `set -euo pipefail` **rc=2**, missing lib rc=1, `set -u` alone survives. **rc=2 IS THE PreToolUse BLOCK CODE**, so a corrupt `.claude/hooks/lib/*.sh` denies every Bash call fleet-wide with the hook's own `SKIP_*` escape unreachable — the fleet-lockout shape wearing the costume of a fleet-lockout FIX. Guard the source with `case $- in *e*) set +e;; esac` and restore, and keep the `*)` branch: it is load-bearing in the callers running `set -u` without `-e`, where deleting it as boilerplate re-arms the lockout.


<!-- TRAP keys: <<EOF, <<PY, <<' -->
## Use `<<'EOF'` (quoted) for every heredoc unless you specifically need interpolation

An unquoted heredoc silently rewrites `\`, `$` and backticks in your payload — it has produced a fixture where the attack under test never happened.



## from `bash-environment.md` § Use `<<'EOF'` (quoted) for every heredoc unless you specifically need interpolation

<!-- TRAP keys: python3 - -->
- ⛔ **A HEREDOC PLACED AFTER A PIPE BINDS TO THE *LAST* COMMAND IN THE PIPELINE, AND HANGS FOREVER.** `python3 - "$ARG" | head -20 <<'PY'` hands the heredoc to `head`, which does not want it, while `python3` waits on a stdin that never arrives: **no output, no error, no exit.** Distinct from the `payload | python3 -` trap, which COMPLETES and returns a false measurement — here nothing completes at all. **TELL: a payload-interpreter call produces nothing whatever.** Put the heredoc on the command that consumes it, or write the payload to a temp file. Archive.

<!-- TRAP keys: && \ -->
- ⛔ **AN `&&`-CHAINED HEREDOC HAS ITS FIRST BODY LINE EATEN AS THE SHELL CONTINUATION.** `python3 - <<'PY' && \` starts the interpreter one line in, so a `NameError` names a module that IS in your payload. **TELL: the shell error reads as a glob failure, not a heredoc one.** 2-line body: chained 1 of 2, control 2 of 2. Archive.


<!-- TRAP keys: sed -i, date -d, stat -c, head -n -, head -0, cat -A, xargs -a, split -n, --time-style -->
## This is BSD userland, not GNU — a long-flag you know from Linux is rejected, and `2>/dev/null` turns that into a clean-looking zero

Rejected here: `ls --time-style=long-iso`, `sed -i` (BSD needs an explicit suffix, `sed -i ''`), `date -d`, `stat -c`, `split -n l/N` (slice with `sed -n 'START,ENDp'`), `sed '1i text'` (BSD `i` demands `\`-newline — `sed $'1i\\\ntext'`; the GNU one-liner errors *"command i expects \ followed by text"*), `head -n -1` (`head: illegal line count -- -1`, rc=1, **empty stdout** — use `sed '$d'`), `head -0` (`head: illegal line count -- 0`, rc=1 — the call reports FAILED even when every earlier step in it printed its OK marker; to discard output use `> /dev/null`; tripped 3 times in one session, 2026-09-29/30) ⛔ **AND THE PRESCRIBED REPLACEMENT DOES NOT SCALE TO N LINES: `sed '$d;$d;$d'` DELETES *ONE* LINE — `$` IS RE-EVALUATED PER CYCLE, NOT PER COMMAND, SO ONLY THE LAST COMMAND CAN EVER MATCH.** Measured 2026-09-10: 5 lines in, **4** out (want 2); the piped form `sed '$d' | sed '$d' | sed '$d'` returns **2**. It fails SILENT — rc=0, no stderr, a file one line shorter than you asked for — and it is reached for precisely when `head -n -N` has just failed LOUD, so the loud error is replaced by a quiet wrong answer. **TELL: you are trimming a trailer block off a message file and the trailers are still there.** Pipe one `sed '$d'` per line — measured 2/2 at every N. ⛔ **The arithmetic form `sed -n "1,$(( $(grep -c '' f) - N ))p" f` shipped here UNVERIFIED for 40 minutes and is BROKEN at exactly one boundary: when N equals the line count the range becomes `1,0` and BSD sed prints LINE 1 instead of nothing — want 0, got 1** (measured N=3→2 ✓, N=4→1 ✓, **N=5→1 ✗**, N=6→0 ✓ on a 5-line file; N>count works by accident because a negative end matches nothing). That is the delete-everything case, i.e. the one a trailer-trim hits when the file is all trailers. Use it only with `N < $(grep -c '' f)` asserted, and note `grep -c ''` and `wc -l` disagree by one on a file with no trailing newline (3 vs 2), so the two counters are not interchangeable in that arithmetic. Also rejected: `cat -A` (BSD `cat` has no `-A` — use `cat -v`, or `od -c` for bytes), `xargs -a <file>` (GNU-only: rc=1, EMPTY stdout, usage to stderr — a 38-mail sweep read ZERO hex tokens for a true 133 with the error swallowed; use `xargs … < file` or `tr '\n' '\0' | xargs -0`, and note that § NEVER INTERPOLATE A POSSIBLY-EMPTY LIST prescribes `xargs` without saying which form). ⚠️ REMOVED from this list 2026-08-26, measured working here: `readlink -f` (rc=0) and `grep -P` (the ugrep shim accepts it; bare `/usr/bin/grep -P` still rc=2 — the function/binary split above decides which you get). A rejected flag writes usage to stderr and produces NO stdout, so `… 2>/dev/null | grep -c .` yields `0`, indistinguishable from a real no-match.



## from `bash-environment.md` § This is BSD userland, not GNU — a long-flag you know from Linux is rejected, and `2>/dev/null` turns that into a clean-looking zero

<!-- TRAP keys: mktemp -t -->
- **`mktemp -t` INVERTS and the damage lands on Linux CI: BSD reads the argument as a PREFIX, GNU as a TEMPLATE requiring trailing `XXXXXX`.** A `|| exit 0` on a portability-fragile call converts the wrong-platform crash into a **silently disabled guard**.

<!-- TRAP keys: mktemp -d, pwd -P -->
- ⛔ **`mktemp -d` RETURNS THE SYMLINKED SPELLING (`/var/folders/…` → `/private/var/…`), AND EVERY PATH-IDENTITY TEST RUN FROM A WORKTREE THERE GOES DARK** — an inode/firmlink deny, a protected-root check, a band-path arm. Measured: 20 suite arms red under the symlinked root, 0 under `$(cd "$(mktemp -d)" && pwd -P)`, same env; the mutation-matrix gate had refused at its own baseline on every run because of it. Canonicalise a temp root with `pwd -P` before anything compares paths.

<!-- TRAP keys: cut -c, LC_ALL=C -->
- ⛔ **BSD `cut -c` AND `sort` DIE `Illegal byte sequence` ON MULTIBYTE INPUT under the default locale** — data-dependent, so the identical command worked on the previous ASCII input and the failure reads as a one-off; one em-dash is enough (both measured 2026-08-27/28). `LC_ALL=C` for byte-level ops; absent from the rejected-flag list because they fail on DATA, not flags.

<!-- TRAP keys: uniq, sort -u -->
- ⛔ **DEFAULT-LOCALE `uniq` MERGES DISTINCT NON-ASCII LINES AT rc=0 — AND PINNING ONLY ONE OF `sort`/`uniq` MISCOUNTS TOO, IN EITHER DIRECTION.** A Japanese string set, true 3,989: both default 721, `uniq` pinned 4,535, both pinned 3,989; an English one loses 1 of 4,049. **TELL: a distinct count over localized (non-ASCII) text.** `LC_ALL=C` on BOTH, or count in Python.


<!-- TRAP keys: sed ', sed -n -->
## Use `[[:space:]]` in every `sed` BRE — `\s` is accepted, valid, and matches NOTHING

`/usr/bin/sed` is BSD sed and its BRE has no `\s` class, so the pattern is well-formed (a literal `s`), the substitution never fires, and you get exit 0, no output, no stderr — turning a MUTATION into a no-op whose green is indistinguishable from "the assertion is decorative". Content-key that any `sed` edit LANDED before reading a result that depends on it.

```
sed 's|^\(\s*\)alpha|\1MATCHED|'          ->  "        alpha beta"   unchanged
sed 's|^\([[:space:]]*\)alpha|\1MATCHED|' ->  "        MATCHED beta"
```

⚠️ **The fixture must carry leading whitespace** — unindented, `\(\s*\)` matches zero characters under BOTH hypotheses and the control certifies nothing. And `grep` here (ugrep) DOES accept `\s`: check `type sed` / `type grep`, never "the box".



## from `bash-environment.md` § False zeros — a clean, plausible, wrong `0`

<!-- TRAP keys: /usr/bin/grep, type grep, zsh -c, #!/ -->
- ⛔ **VERIFYING ANY `grep` RULE FROM A SCRIPT MEASURES THE WRONG BINARY — `grep` IS A SHELL FUNCTION AND DOES NOT CROSS A SHEBANG.** The zsh snapshot (`~/.claude/shell-snapshots/snapshot-zsh-*.sh`) defines `function grep` re-invoking the Claude Code binary with `ARGV0=ugrep`, and there is NO standalone ugrep here — so a probe script with its own `#!` silently measures BSD grep ⇒ clean pass ⇒ "the doctrine is false". **Source the snapshot explicitly (`zsh -c 'source <snap>; …'`) and prove the function live with a control that must return non-zero — a PLAIN LITERAL, never the two-sided pattern bullet 1 forbids.**

<!-- TRAP keys: tsc, error TS, FORCE_COLOR, --pretty -->
- ⛔ **`tsc` HAS TWO INDEPENDENT FALSE-ZERO MECHANISMS ON ONE COMMAND, AND FIXING EITHER ALONE STILL READS 0.** Pretty output writes ANSI colour BETWEEN the words `error` and `TS`, so `grep -c 'error TS'` reads **0** over a run that is reporting errors; and `"incremental": true` in `tsconfig.json` makes tsc answer a CLI-FLAG-ONLY change from the stale build cache. Both are needed: `--pretty false --incremental false`. ⛔ **THE COLOUR HALF'S SWITCH IS `FORCE_COLOR`, NOT `pretty`'s OWN `isTTY` DEFAULT — AND WHETHER IT IS SET VARIES BETWEEN SEATS OF THIS FLEET, SO MEASURE IT INSTEAD OF ASSUMING EITHER READING.** Measured 2026-09-13, two seats, controls both ways: the variable IS the switch and its presence is NOT predictable from the harness. ⛔ **DO NOT INFER A MECHANISM FOR THE DIVERGENCE — nobody has measured one, and both previous attempts here were invented.** **SETTLING PROBE, one command: `node -e 'console.log(process.env.FORCE_COLOR)'` before trusting any bare `grep 'error TS'`.** **Keep BOTH flags regardless: they are correct in BOTH environments, which is why the prescription never changed while the rationale was wrong twice.** ⛔ **AND THE POSITIVE CONTROL HAS ITS OWN TRAP — `TS5112` ("tsconfig is present but will not be loaded if files are specified on commandline") IS ITSELF FORMATTED `error TS`, so a probe that aborts on CONFIG reads `grep -c 'error TS'` = 1 while your planted error never typechecked at all.** Assert the planted error's OWN code (`TS2322`), never the bare `error TS` pair; pass `--ignoreConfig` when probing a single file. **TELL: a control with a deliberately-planted error reads 0 too** — which is what exposed the colour half, not suspicion. Measured 2026-09-12: read 0 against a true 36. ⚠️ **A recipe recorded WITHOUT the flags hands the next reader the same zero.** Archive.

<!-- TRAP keys: node -c -->
- ⛔ **A NO-ARG `node -c` READS STDIN AND HANGS, AND THE BACKGROUNDED TASK THEN REPORTS *FAILED* OVER WORK THAT FULLY SUCCEEDED.** `node -c ""` blocks; the Bash tool moves the call to the background at its timeout and the completion notice reads `failed with exit code 144`. Measured 2026-09-12: the edit had landed — `1885 lines` written — while the task said failed. **TELL: a FAILED verdict on a task whose artifact is already correct on disk.** The general half is the reusable one: **a backgrounded task's exit code describes the WRAPPER, not the work — read the artifact before re-running**, because a blind retry after a partial is how you double-apply.

<!-- TRAP keys: grep -Fxv, grep -f -->
- ⛔ **`grep -Fxv -f <pattern-file>` FALSE-ZEROS ON ugrep's COMPLEXITY LIMITER, AND BOTH DIRECTIONS OF THE SET DIFFERENCE GO SILENT TOGETHER.** The limiter error goes to STDERR, stdout reads a clean **`0`**, and the harness annotates the result *"No matches found"* — so the two-arm control is vacuous BY CONSTRUCTION: both arms are silenced by the same limiter, so their agreement carries zero bits. Measured over a 4.4 MB pattern file. **TELL: a set difference over thousands of terms reads 0 in BOTH directions.** Use `comm` on sorted input or a real set structure; assert a NON-ZERO positive control on the pattern file before trusting any `-f` read. Archive.

<!-- TRAP keys: git grep -->
- ⛔ **`\n` IN A BRACKET CLASS IS TOOL-DEPENDENT — `git grep` READS TWO LITERALS (`\` AND `n`), THE `grep` SHIM READS A NEWLINE.** Measured 2026-09-11: `a[^\n]*c` matches `abnc` under `grep` and **NOT** under `git grep`, so a ported pattern silently excludes every string containing an **n** — `handleUpgrade` has one, and a seller-discovery sentinel read a clean **0** over a population of 3. **TELL: a discovery predicate finds nothing in a set you can list by hand.** Both are line-oriented, so the class buys nothing: use `.`.

<!-- TRAP keys: awk -F, \x1f -->
- ⛔ **BSD awk TAKES `\x` LITERALLY, SO `-F'\x1f'` SPLITS NOTHING: `NF=1`, rc=0, no stderr.** `-F'\t'` is FINE — `\xHH` alone fails. Use octal: `-F'\037'`. ⛔ **PRECONDITION: THE *FORMAT* MUST EMIT THE BYTE** — the founding `--format='%H %(…)'` used a SPACE, so no `-F` repairs it. **TELL: a per-record loop prints its header then ZERO rows.** Working form: `wrap/SKILL.md`. Archive.

<!-- TRAP keys: || echo -->
- ⛔ **A `|| echo "<conclusion>"` ON A PIPELINE ENDING IN `head` CANNOT FIRE — `||` BINDS TO THE PIPELINE AND `head` EXITS 0 ON EMPTY INPUT — SO ITS SILENCE READS AS THE CONCLUSION.** **TELL: the only affirmative output is a message you wrote into an `||`.** Measured 2026-09-09: a citation check printed its heading and **0** further bytes, read as a pass. Assign, then TEST. Archive.

<!-- TRAP keys: wc -c -->
- ⛔ **A NEXT-HEADING LOOKAHEAD IS EMPTY ON THE *LAST* SECTION, SO THE `sed` RANGE ERRORS TO A CLEAN `wc -c` 0.** `sed -n "1100,-1p"` dies on stderr; the pipe prints **0**. **TELL: a largest-section check that exonerates the section you suspect** — it bites whichever is LAST, unrelated to where anyone edits. Read 0 against **77,255 B**. Bound with `$(grep -c '' f)`.


<!-- TRAP keys: grep -oE, .{0 -->
- ⛔ **NEVER RUN A BOUNDED CONTEXT WINDOW ON *BOTH* SIDES OF A LITERAL — including to check this rule.** `grep -oE '.{0,80}<lit>.{0,80}'` may HANG or FALSE-ZERO, and the symptom is UNRELIABLE (both from the identical command). **Forward-anchor — `'<lit>.{0,80}'` — and never `2>/dev/null` it.** `grep-blowup-warn.sh` does NOT catch this shape (no alternation), so the guard passing is not evidence it is cheap. ⛔ **Do not measure the threshold yourself** — you cannot characterise a resource-exhaustion failure by triggering it.


<!-- TRAP keys: cut -d_, sort -t_ -->
- ⛔ **`cut -d_ -fN` IS OFF BY ONE ON A `__`-DELIMITED NAME, AND THE EMPTY FIELD FAILS SILENT.** `cut` counts the EMPTY field between the doubled delimiters, so on the mail store's `<recipient>__<ts>__<sender>.md` the timestamp is **`-f3`, not `-f4`** (measured 2026-09-02; per-field reading in the archive). The empty capture then makes `[ "$V" -gt <n> ]` THROW, a `2>/dev/null` eats it, the loop body never runs, and the probe prints a clean empty block read as **the mail was never sent**. **TELL: a store enumeration you can see with `ls` returns nothing through your own probe.** Split on the full `__` (`awk -F'__'`) or use `-f3`, and assert the captured field is NON-EMPTY before comparing — **and the SAME off-by-one hits `sort`: `-t_ -k4` sorts by SENDER; `sort -t_ -k3` is the correct spelling, the same `3` the `cut` fix above prescribes**. Archive.

<!-- TRAP keys: ARG_MAX -->
- ⛔ **A SCANNING GLOB PAST `ARG_MAX` MAKES `ls` FAIL BEFORE IT RUNS, AND `2>/dev/null` MAKES `E2BIG` A CLEAN `0`.** **TELL: the wildcard sits at a DIRECTORY level — ONE subtree cannot reach it (largest 364,230 B vs `ARG_MAX` 1,048,576).** Measured: `ls … 2>/dev/null | wc -l` → **0**, `find` → **9,018**. `find` discriminates *none* from *too many*. Archive.

<!-- TRAP keys: pgrep -->
- ⛔ **`pgrep -x` FALSE-ZEROS ON A macOS APP BUNDLE — THE MAIN PROCESS REPORTS `comm` AS THE FULL PATH**, empty at rc=1, no stderr, while the app is on screen. `Finder` **930** and `WindowServer` **641** succeed on BARE names, so a control from them is the TWELFTH vacuous way. **TELL: an is-it-running check is empty for an app you can see.** `pgrep -f`, or walk your own ancestry. Archive.

<!-- TRAP keys: pgrep -f, pgrep -lf, pgrep -af, until ! pgrep -->
- ⛔ **`pgrep -f '<pattern>'` NEVER MATCHES ITS OWN SHELL — `/usr/bin/pgrep` EXCLUDES ITSELF AND EVERY ANCESTOR (`-a` turns that off) — BUT IT MATCHES EVERY *OTHER* SHELL WHOSE COMMAND LINE CARRIES THE PATTERN.** Every Bash call runs inside `/bin/zsh -c … eval '<the whole command>'`, so your own background wait loop from another call, a peer's wait loop and a peer's run all count: two plain-pattern waiters block each other forever, and a `pgrep -fl` check lists your own waiter as a live run. **TELL: a `/bin/zsh -c source …shell-snapshots…` line in the listing — a wrapper, not the target.** Key on the target's own argv with the first character bracketed (`pgrep -f '[b]ash ./scripts/e2e-local'`): the `bash ` prefix skips wrappers that only mention the script, the bracket keeps your text out of other seats' probes; a peer waiter written plainly still matches, so read the pids once. Measured 2026-10-05: a foreground and a background `until ! pgrep -f` loop each exited at once with nothing else running; with a plain-pattern sibling alive, the plain AND the bracketed loop both stuck. `ps | grep` differs — it DOES list your own wrapper (the `ps`/`grep` entry below).

<!-- TRAP keys: command-name, skill-invocations -->
- ⛔ **A `<command-name>` GREP UNDER-MATCHES: A SKILL-TOOL INVOCATION LEAVES NO SUCH RECORD, SO ITS ABSENCE IS NOT DID-NOT-RUN.** `wrap/SKILL.md`'s 5b gate ships with no instrument, so an improvised grep fired a full unit suite off a zero — in a turn that had already explained the marker was missing. **TELL: reading a `<command-name>` count as a did-it-run test.** Key on `.claude/logs/skill-invocations.jsonl`. Archive.

<!-- TRAP keys: git log --since -->
- ⛔ **A BARE `git log --since='<date>'` MEANS THAT DATE AT THE *CURRENT CLOCK TIME*, NOT MIDNIGHT — ON TODAY'S DATE IT RETURNS ZERO, AND THE ZERO READS AS "NEVER DONE".** Measured 2026-09-02: bare → **0**, `'2026-09-02 00:00'` → **539**. **Always pass a time.** `defer-trigger-scan.py` forwards a caller's bare date verbatim (`:234`,`:398`). **TELL: an empty result on work you know landed.** Archive.

<!-- TRAP keys: additionalContext, hookSpecificOutput -->
- ⛔ **A NON-ASCII BYTE INSIDE `hookSpecificOutput.additionalContext` IS A JSON `\uXXXX` ESCAPE, SO A LITERAL GREP FOR IT IS AN UNFALSIFIABLE ZERO — and every model-aimed hook now emits that way.** **TELL: a reading CHANGED without the code changing.** Decode the field; never grep the raw payload for a glyph.

<!-- TRAP keys: .jsonl, jq -->
- ⛔ **JSON ALWAYS WRITES `"` AS `\"` AND A NEWLINE AS `\n`, SO A `grep -F` TYPED FROM THE RENDERED TEXT FALSE-ZEROS ON A PHRASE YOU CAN SEE.** Non-ASCII is WRITER-DEPENDENT — one writer stores it literally, another as `\uXXXX` — so a glyph zero is a HYPOTHESIS, never an explanation. Decode the field (`jq -r` / `python3 -c`) and demand the positive control on a phrase you KNOW the window holds.

<!-- TRAP keys: sed -n "$ -->
- ⛔ **THE INVERTED MEMBER OF THIS SECTION: AN EMPTY VARIABLE MAKES `sed -n "${L}p"` PRINT THE WHOLE FILE.** A locate that finds nothing yields `L=""`, the command becomes `sed -n "p"`, which is VALID — no error, no stderr — so this one fails toward **the loudest possible output for the quietest possible failure**: a wall of correct-looking content that reads as a successful large read. **Guard the anchor, not the output: `[ -n "$L" ] || { echo "anchor not found" >&2; exit 1; }` before the `sed`.**

<!-- TRAP keys: grep -F, grep -cF -->
- ⛔ **INLINE MARKDOWN EMPHASIS INSIDE A PHRASE DEFEATS `grep -F` ON THE PLAIN WORDING — AND THIS FILE'S OWN "PREFER `-F`" GUIDANCE ARMS IT.** You read a sentence rendered, quote it back as words, and search for that; the source carries `*`/`**`/backticks MID-PHRASE, so the fixed string cannot match. **Quote from the SOURCE BYTES, never from the rendering, or key on a single word that carries no markup.** Fails in the EXPENSIVE direction — a landed fold reported MISSING. ⚠️ **A worked example written INTO the corpus it measures becomes a member of that corpus** — say so, or key the example to a token the text does not contain.

<!-- TRAP keys: MEMORY.md -->
- ⛔ **GREP A TWO-TIER `MEMORY.md`'s DIRECTORY, NEVER THE FILE — bodies live in shards beside it, so the router reads a clean ZERO for a live lesson.** Measured 2026-09-07: a lesson live and heavily cited reads **0** on the file and **13** on the DIR. **TELL: a zero on a corpus you know is large.** The Band-U row has carried the directive since 2026-08-28; what it lacks is the control, and two seats ran the file probe anyway. Archive.

<!-- TRAP keys: grep -rc, awk '{s+= -->
- ⛔ **`grep -rc` WITHOUT `-h` PRINTS `path:count`, SO `awk '{s+=$1}'` OVER IT SUMS THE *PATH* AND THE GATE CAN NEVER RETURN NON-ZERO.** It reads like a count and is a constant `0`. **For a novelty/duplicate gate do not sum at all — `grep -rniF` and READ the hits**; the question is *what exists*, not *how many*.

<!-- TRAP keys: -F '- [, -F "- [, rg -, rg ', rg ", grep -r, xargs grep -->

- **`grep -E '(^|[^A-Za-z])WORD'` false-zeros** — `grep` execs ugrep (`type grep`), and `^` ALTERNATED WITH A NEGATED CHARACTER CLASS is the one idiom it cannot evaluate; each half works alone and the reading is LOWER than either branch, so no partial result hints at it. **Use `\bWORD\b`.** ⚠️ NOT "an anchor inside an alternation" generally — the literal-alternative case WORKS, which is what stops this rule banning a working construct. Appending `\b` does NOT rescue the broken form.

  *Search-instrument third of the false-zero table. TWO sibling entries, not one — the split of 2026-09-21 made the vendor row its own entry so a `git log -S` command would stop dragging 1,817 B of Vercel doctrine: the GIT-PROBE half is keyed `git log -S` / `git ls-tree` / `git show`, the VENDOR half `vercel env`.*

  | instrument | false-zero mechanism | fix |
  |---|---|---|
  | `rg` rooted at `.` | skips hidden paths, never sees `.claude/` (rc=1, no stderr) | ⛔ **`rg --hidden --no-ignore` — BOTH, always.** Measured on one token: bare **1**, `--no-ignore` **1**, `--hidden` **4**, the pair **6**. So each flag alone is a false zero wearing a fix, and *"`--no-ignore` does NOT help"* was true of the flag ALONE and read as true of the pair |
  | `rg --hidden` rooted AT `.claude/` | INVERTS — the root ignore file's `.claude/*` rule blocks, so the child fails | ⛔ **add `--no-ignore` — it rescues the `.claude` ROOT outright (0 → 5 here, 0 → 9 on a second seat's token), so the grandchild question never has to be answered.** *That is why "root at the GRANDCHILD `.claude/rules/`" is retired: it required knowing which grandchild holds your target, which is the thing you are running the search to find out. Archive* |
  | `grep -r` | reads leftover agent worktrees — a false CONFIRMATION, AGE-GRADED (older rule ⇒ staler hit) | exclude `/worktrees/` `/session-mail/` `/logs/` |
  | grep over a file containing a **NUL** byte. ⛔ NUL SPECIFICALLY: SOH/ESC/DEL do NOT trigger binary detection, and **ESC is the commonest control byte in captured terminal output**, so a reader told "a control byte" finds an ESC and stops looking for the NUL that did it | prints NOTHING (not `0`), rc=1, no stderr, while `tail` still shows the text; `N=$(grep -c …)` is then the EMPTY STRING under the Bash tool's grep SHIM — `/usr/bin/grep -c`, what a bash shebang gets, returns the TRUE count — `[ "$N" -gt 0 ]` THROWS, and the documented `N=${N:-0}` repair silently reads a clean **0** from a file full of matches | `-a` — ⛔ **AND `-a` IS PATTERN-DEPENDENT: a MULTIBYTE pattern (`⛔`) still reads 0 on a NUL-bearing file under `/usr/bin/grep -a -F`; `LC_ALL=C grep -a -F` matches, an ASCII pattern under `-a` matches (controls both ways).** `LC_ALL=C` PER COMMAND, never `export`ed — an exported locale reaches every runner the script spawns |
  | pattern starting `-` | parsed as an OPTION, rc=2 — every `if` reads not-found; every `todo.txt` row begins `- [ ]` | `grep -F -- "<pattern>"` |
  | line-oriented grep | cannot see a phrase WRAPPING a line break | `rg -U` — ⛔ **and in a COMMENT corpus the `tr '\n' ' '` join READS 0 TOO, because the `//`/`*` marker lands BETWEEN the joined words**; the join must eat the marker (`rg -U 'a[[:space:]]*(//\|\*)?[[:space:]]*b'`) |
  | `grep -rl A \| xargs grep -l B` | answers ADJACENCY, not ABSENCE — a concept split across two files reads `0` and licenses the rule you hoped to justify | grep each token family SEPARATELY, read the hits |
  | literal grep | blind to a CONSTRUCTED regex (`new RegExp(base + suffix)`) — and to a CONSTRUCTED KEY: a doc or log quoting a runtime key value (`<prefix>:<segment>:<name>`) reads 0 in source that assembles it from a constant and a variable (`` `<prefix>:${SEGMENT}${name}` ``) (read as "missing from both branches") | sweep the CONSTRUCTOR |
  | anchored grep over tool output | is a claim about that tool's FORMAT — rg prints `./` so a `'^\.claude/'` anchor reads 0 | verify the prefix before anchoring |
  | a probe whose output you FILTER (`2>/dev/null`, `grep`, `head`) | deletes the evidence it never ran; a stdout filter as surely as stderr. | read it, THEN filter |

<!-- TRAP keys: mail-check --peek |, mail-check --peek 2>&1 |, mail-check --summary |, mail-check --summary 2>&1 | -->

- ⛔ **COUNT UNREAD MAIL FROM `mail-check`'s HEADER LINE, NEVER FROM ITS BULLETS: `(N message(s)` under `--peek`, `(N unread` under `--summary`.** The `  · ` bullets print only under `--summary`, so `mail-check --peek | grep -E '^\s*·|unread'` read **0** beside a SessionStart count of 22 unread (2026-10-02; a 2026-09-30 instance wrote `'^\s+·'` without `-E`, where `+` is literal, so its zero may be a regex false zero instead). And `--summary` is not a count either: it is capped at 1,400 B (3 bullets shown for 194 unread), and on a review-hub seat `--peek` reads 3 because the review-queue lines also start with `·`. **TELL: a zero, or a small number, from a grep over a tool whose output you never read unfiltered.** Kin: the search false-zero table's anchored-grep row (an anchor is a claim about the tool's format).

<!-- TRAP keys: git log -S, git ls-tree, git show -->

  *Git-probe half of the false-zero table. The SEARCH half is keyed `rg -` / `rg '` / `rg "` / `grep -r` / `xargs grep`; the VENDOR half is keyed `vercel env`. Split 2026-09-21: the Vercel row is 1,817 B of vendor doctrine that every `git log -S` command was dragging along for no reason — a WRONG-TOPIC delivery, not merely a large one.*

  | instrument | false-zero mechanism | fix |
  |---|---|---|
  | `git log -S` / `-G` | CASE-SENSITIVE BY DEFAULT, and this corpus writes headings in CAPS | add `-i` (it works on `-S`; see the git-probe section) |
  | `git show <ref>:<path>` piped to a counter, path GUESSED or MOVED | empty stdout ⇒ a clean `0`, and all three usual escapes fail (`2>&1` is a non-matching LINE — the FILTER row above is INERT here; rc is replaced by grep's in the pipe). **TELL: the filesystem sibling WARNS on the missing file while the git read is silent — a clean number beside a warning is the suspect one** | `git cat-file -e <ref>:<path>` first, or demand a NON-ZERO control from a ref you know has it. |
  | `git ls-tree <ref> <path>` run from a SUBDIRECTORY | its paths are CWD-RELATIVE, where `git show <ref>:<path>` is repo-root-relative, so a root-relative path prints NOTHING at **rc=0** and the empty listing reads as *absent from the tree* (measured 2026-09-14 from `scripts/`) | `--full-tree`, or run it from the repo root |

<!-- TRAP keys: vercel env -->

  **Source:** Vercel, CLI environment-variable documentation, as read 2026-10-08 (the type this entry calls sensitive is named Secret there)

  *Vendor third of the false-zero table; the git-probe half is keyed `git log -S` / `git ls-tree` / `git show` — `git show` was missing from this list while the entry it points at has always carried it, so a reader chasing a `git show <ref>:<path>` false zero was sent past the row that covers it. The SEARCH half is keyed `rg -` / `rg '` / `rg "` / `grep -r` / `xargs grep`.*

  | instrument | false-zero mechanism | fix |
  |---|---|---|
  | a grep over `.env*` FILES for a Vercel env var | Sensitive-typed vars are WRITE-ONLY — `vercel env pull` never fetches the value (it writes a placeholder, or keeps a real value the local file already held, which may be stale) and a dashboard-created var's value never enters any local file, so what an env file holds or lacks is evidence about the FILE, never PRODUCTION | `vercel env ls production --json` for EXISTENCE + `updatedAt` — the PLAIN listing prints the CREATION date (a `--force` overwrite preserves it) and labels both types `Encrypted`: two wrong columns in one instrument. ⛔ **TYPE-SPLIT FIRST — `encrypted` AND `sensitive` BEHAVE OPPOSITELY.** An `encrypted` var's value IS readable (dashboard, `pull`); a **`sensitive` var's value has NO live-value oracle anywhere** — the vendor's CLI environment-variable documentation (source line above this table) says that once a value is saved under that type, neither its web console nor the CLI's own listing will ever show it again. Not the dashboard, and NOT an app-side config view either — that is a per-DEPLOYMENT snapshot, never a live store read. Its only value observation is **the running app after a redeploy**; trust the WRITE via `--json`'s `updatedAt` plus the create-tool's own API read-back, and `pull` returns a literal `[SENSITIVE]`. A reading taken on an `encrypted` key is a different TYPE and cannot control the sensitive case. ⛔ **NEVER re-add a CREDENTIAL non-sensitive to make it readable** — the obvious move for a reader who has just found the value hidden, and a protection downgrade on live credentials. A value that grants nothing (a feature flag, a recipient address) may be re-saved readable; for a production var, say so and show the value grants nothing. NAMING a tool is not CHECKING it: read the vendor's line about THAT tool before you write it down. Value-correctness is answered by CONSUMPTION, not by reading the store: a check that resolves the configured price ids against the billing provider's live catalog is the shape to copy. Retraction chain (vendor-verified): archive |

*Paired entry, SAME KEY `vercel env`: the WRITE-side rule below — a `vercel env add` returning rc=0 with an error body. Any command that fires this one fires that one; correct or trim them TOGETHER.*

<!-- TRAP keys: --filter, --only, --grep, EVAL_FRAME_FILTER -->
- ⛔ **A RUN/TEST SELECTOR (`--filter` / `--only` / `-t` / `--grep` / `EVAL_FRAME_FILTER`) THAT NO-OPS ON AN UNMATCHED TERM SILENTLY REMOVES EXACTLY THE ARM YOU NAMED — worst on a CONTROL arm — and the run reports CLEAN.** **Require zero-match to fail loud, or paste the matched-set count beside the verdict.**

<!-- TRAP keys: && grep -->
- **A MULTI-LITERAL ABSENCE SWEEP CHAINED WITH `&&` FALSE-ZEROS EVERY LEG AFTER THE FIRST NO-MATCH** — the chain stops at the first `rc=1`, so later legs never run and their silence reads as absence. One literal family per command, or `;`-separate and read each count. Different mechanism from the `nomatch` glob entry above.

<!-- TRAP keys: | head -->
- **A `| head` CAP SIGPIPE-KILLS A LATER LEG OF THE SAME MULTI-STAGE PROBE** — the producer dies mid-write and every leg AFTER it silently never runs; the partial output is shaped exactly like a total. Cap at the END of a pipeline you will read, never mid-script above legs that still owe output.

<!-- TRAP keys: BACKLOG.md -->
- ⛔ **A `#N` CITATION GREP REACHES ONLY THE BULLET FORM, AND `^### <N>\.` ONLY THE HEADING FORM: `BACKLOG.md` HAS TWO ENTRY FORMS.** A `### N.` entry carries no `#` at all, so `#<N>` reads 0 on a live entry; the newer `- **#N ` bullet is the MAJORITY (81 bullets vs 65 `### N.` at 2026-09-05), so a bullet-only probe read a clean 0 on two live entries. Match BOTH: `grep -nE '(^### <N>\.|^- \*\*#<N> )' BACKLOG.md`. **TELL: a rule naming THE defining form of a corpus — this one manufactured the false zero it exists to prevent, twice (its own headline named only the older form until caught). Re-derive the form set before trusting a structural probe you did not write today.** **N zeros from N variants of ONE literal are ONE observation, never triangulation.** Archive.

<!-- TRAP keys: const -->
- ⛔ **`grep '<NAME> = '` FALSE-ZEROS ON A TYPED TS DECLARATION** — `const X: string[] = [` puts `: type` between identifier and `=`; the empty result then collapses the `$(…)` it feeds and surfaces as an error naming the WRONG tool (`sed: invalid command code ,`). Anchor on the identifier: `^[[:space:]]*(export )?(const|let) <NAME>\b`.

<!-- TRAP keys: grep -h -m1, grep -hm1, grep -m1, grep -m 1, -hm1, -m1 -->
- ⛔ **`grep -m1` OVER A GLOB CAPS MATCHES *PER FILE*, NOT IN TOTAL, SO `F=$(grep -h -m1 "$id" dir/*.tsv | cut -f1)` CAN HOLD SEVERAL PATHS.** Every downstream `grep -c … "$F"` then names one mangled filename: grep prints nothing on stdout, an error on stderr and exits 2, and the caller's own `2>/dev/null || echo 0` turns that into a clean 0 that reads as *"the file doesn't exist"*. Measured 2026-08-01: the zeros were first blamed on the data and then traced to the probe. Cap the STREAM (`| head -1`) and assert `[ -f "$F" ]` before counting. **TELL: every count from a loop reads 0 while `ls` shows the files.** Not keyed on `--max-count`: over 14 days 55 of its 62 deliveries were `git log` / `git rev-list --max-count`, a total cap where this trap does not apply, so about 5 real grep uses go undelivered by choice.


## from `bash-environment.md` § False non-zeros — a plausible number is a better disguise than a zero

<!-- TRAP keys: %(trailers, --format= -->
- ⛔ **`%(trailers:…,valueonly)` EMITS A BLANK LINE AFTER EVERY RECORD, SO COUNTING BLANKS COUNTS *COMMITS*.** Over 181: blanks 181, and `%H | grep -c` reads 181 too: the denominator, so that fix IS the defect. **Use `separator=`**: `%H%x1f%(…,separator=)` + `awk -F'\037' '$2==""'` → 0. **TELL: a no-trailer count NEAR your commit count — 180 of 181 slips equality.** Archive.

<!-- TRAP keys: \x00, tr -cd -->
- ⛔ **A NUL IN A grep PATTERN TRUNCATES THE PATTERN AT THE NUL — argv is a C string, so grep sees only the PREFIX: a bare `$'\x00'` becomes the EMPTY pattern and matches every line, and `$'foo\x00bar'` becomes `foo`, a WIDER pattern that silently over-matches.** `grep -c $'\x00'` read **29,259** NUL-bearing lines = the file's own line count, and the truncated-prefix form over-matches in both shells (zsh keeps the byte, bash strips it at assignment; grep sees the prefix either way). Archive. **TELL: the count equals `grep -c ''`** — not `wc -l`, which is one short on a file with no trailing newline. Two remedies for two DIFFERENT questions: `grep -acP '\x00'` counts LINES — the `-a` is load-bearing (without it a NUL-bearing file reads EMPTY at rc=1, the `-a` false zero above, and the documented `N=${N:-0}` repair turns that into a confident clean 0), and `-P` exists only under the ugrep shim (`/usr/bin/grep -P` under a `#!/usr/bin/env bash` script is rc=2 with no stdout, a clean 0 after `2>/dev/null`); `tr -cd '\000' | wc -c` counts BYTES. The inverse of the `-a` false zero (a NUL in the FILE hides matches).

<!-- TRAP keys: grep -E, grep -nE -->
- ⛔ **AN ALTERNATION BRANCH OMITTING THE INTERPOLATED KEY MATCHES EVERY INPUT, NONEXISTENT ONES INCLUDED.** `### [0-9]+–[0-9]+\.` beside `### $N\.` carries no `$N`, so it returns the file's first batch heading for every item. **TELL: two different inputs resolve to ONE line.** Measured `#6` `#156` `#999` all → 1288. A RANGE needs arithmetic, not a branch; control with a nonexistent key. Archive.


<!-- TRAP keys: date -r, %TZ, stat -f -->
- ⛔ **`date -r` PRINTS LOCAL TIME, AND A LITERAL `Z` IN THE FORMAT STRING MANUFACTURES A UTC LABEL THE READING DOES NOT CARRY.** **TELL: your own enumeration disagrees with a `created:` header you pasted in the same turn** — nothing about the number looks wrong alone. Bites hardest converting mail-store nanosecond filenames, where every row is off by the offset and consistently so. **Use `date -u -r`, or drop the `Z` — never hand-write a timezone a format string is not computing.** ⛔ **AND THE BIGGER HALF IS THE ROW YOU NEVER CONVERTED AT ALL: a `Z` time TYPED from wall-clock impression is invisible to this rule, which fires on CONVERTING.** Measured on a review ledger: 15 rows, **3 agreed and 12 were wrong**, and only 3 of the 12 were the offset — the rest were TYPED, which is the larger half. **DERIVE every durable `Z` from the artifact's own epoch; a per-row `--check` is ~20 lines.** Archive. ⛔ **`stat -f … %FT%TZ` IS THE SAME DEFECT** — BSD `stat` prints the LOCAL mtime and the `Z` is typed by hand (2026-09-24; promoted from the watch register 2026-09-29 at occurrence 2, and moved onto THIS entry because the `--date=format` entry's keys never fire for a `stat` command). `TZ=UTC stat …` or `date -u -r <epoch>`.

<!-- TRAP keys: time.timezone, mktime -->
- ⛔ **`time.mktime(...) - time.timezone` IS WRONG UNDER DST, AND THE HOUR IT SILENTLY DROPS IS THE *OLDEST*.** `time.timezone` is the NON-DST offset while `mktime` assumes DST, so an epoch window built that way is short by one hour at its FAR edge — a 12 h recovery bound was effectively **11 h**, and the lost hour sat exactly at the oldest edge anyone was trying to recover. **It fails toward a clean "nothing of yours is missing"** — the one direction nobody re-checks. Use `calendar.timegm` on a UTC struct — **on the CUTOFF, not on the record: converting the record side LENGTHENS the window instead of shortening it, which INVERTS the tell below and hides the defect** (summer delta −3600 s, winter 0 s, measured on this box). **TELL: a recovery tool reports a smaller loss than the incident's own timeline implies.**

<!-- TRAP keys: $1, $2, $3, $4, $5, $6, $7, $8, $9, $0 -->
- ⛔ **A DOLLAR FIGURE IN A DOUBLE-QUOTED SHELL ARGUMENT IS A PARAMETER EXPANSION, AND `$<digit>` FAILS SILENT AT ANY WIDTH.** `"cap $2.00"` → `cap .00`; multi-digit eats WHOLE in zsh but leaves a plausible remainder in bash — `"the fee is $45/mo"` → zsh `the fee is /mo`, bash `the fee is 5/mo`, a WRONG PRICE rather than a blank, and every price string a command composes is in the blast radius. **Single-quote any argument carrying `$<digit>`, or compose via a file.**

<!-- TRAP keys: --date=format, TZ=UTC, %ct -->
- ⛔ **`TZ=UTC` DOES NOT REACH `git --date=format:`, AND A LITERAL `Z` THERE FABRICATES A UTC LABEL ON A LOCAL READING.** The bullet above names `date`; git is a SECOND tool with the same defect and the OBVIOUS remedy fails silently on it — `--date=format:` honours the commit's RECORDED offset, so the env var is ignored rather than refused. Measured 2026-09-02 on one commit: the literal-`Z` form read two hours off while `--date=format-local:` and `%ct | date -u -r` agreed (archive). **TELL: a git time and a mail-store/API `Z` time disagree by exactly your UTC offset, which reads as a causal inversion.** **Use `--date=format-local:` under `TZ=UTC`, or `%ct` piped to `date -u -r`; never hand-write `Z` into a git format string.**

<!-- TRAP keys: --until=, --after=, --before= -->
- ⛔ **`git log --since=`/`--until`/`--after`/`--before` PARSE A BARE TIMESTAMP AS **LOCAL**.** East of Greenwich a UTC-derived window INFLATES (UTC+2: **63** vs **14**); west it reads a clean **0**. ⛔ **A LOCAL `date` IS NOT THE FIX — the `TZ=UTC` habit the bullet ABOVE teaches re-breaks it, 28 → 0: two adjacent bullets composing into a false zero.** Pass an instant no TZ can move — `--since="@$(( $(date +%s) - 3600 ))"` or `--since='60 minutes ago'` (git takes relative forms; the `find`-is-`bfs` refusal does NOT generalise). **TELL: `git log --since=<X> --format=%cI | tail -1` returns a commit OLDER than the window.** Archive.

<!-- TRAP keys: rg -r, rg -o, rg -oE -->
- **Two `rg` flag traps, with OPPOSITE symptoms:** `rg -rn "pat"` treats `-r` as REPLACEMENT — every match prints as the literal `n`, well-formed wrong output; `rg -oE '<pat>'` parses `E` as an ENCODING arg and fails LOUD (rc=2 on stderr) — a clean zero only when stderr is redirected. Use `grep -oE` for extraction; never port the `-rn` habit from grep.

<!-- TRAP keys: rg -U -->
- ⛔ **A NEGATED CHARACTER CLASS MATCHES NEWLINES, so a `[^X]*` span over a LINE-STRUCTURED file reaches into rows below it** — a `filed:[^|]*by` span matched a `by <sid>` many lines down, a false ATTRIBUTION. **Add `\n` to the class: `[^|\n]*`.** ⚠️ **PRECONDITION: a LINE-ORIENTED grep CANNOT exhibit this — measured empty.** It binds multiline buffers only (python/node over a whole file, `rg -U`, an `awk` range); without the precondition a reader may "fix" working grep patterns. ⚠️ OPPOSITE direction from the ugrep anchor-alternation entry above (a false ZERO). Binds every `todo.txt` / table / frontmatter predicate.

<!-- TRAP keys: PIPESTATUS, pipestatus -->
- ⛔ **PICK THE `PIPESTATUS` SPELLING BY THE TARGET'S SHEBANG, NOT THE SHELL YOU TYPE IN — each form expands EMPTY under the other shell.** The Bash TOOL is `/bin/zsh` → `$pipestatus[1]` (lowercase, 1-indexed); every hook and `scripts/*.sh` is `#!/usr/bin/env bash` → `${PIPESTATUS[0]}`. ⚠️ **"The Bash tool" READS AS THE ONLY zsh SURFACE AND IS NOT — a Monitor command shares the same shell.** A pasted wrong form yields an EMPTY operand — which THROWS under `[ ]` and reads as a clean pass under the tempting `${rc:-0}` repair.

<!-- TRAP keys: 2>&1 -->
- ⛔ **A PROBE THAT CAPTURES `2>&1` READS A CRASH AS A VERDICT — on a deny-shaped gate the crash is INDISTINGUISHABLE FROM A DENIAL.** `r=$(payload | bash "$HOOK" 2>&1); [ -n "$r" ] && echo DENY` treats ANY output as the affirmative, so a broken hook reads DENY on every arm including the negative controls — which looks like an over-blocking predicate rather than a dead script, the wrong diagnosis in the direction that edits the predicate. **TELL: the control arm flips too.** A verdict probe reads **stdout only** (`2>/dev/null`); read stderr in a SEPARATE call. ⛔ **AND STDOUT-ONLY FAILS THE OTHER WAY: A MISSING OR CRASHED SCRIPT PRINTS NOTHING, SO IT READS AS *ALLOW* (rc=127, deny=0)** — and on any arm whose expected verdict is ALLOW, a dead script matches the expected table exactly: a hook file that was never written, or a relative hook path that does not resolve in a scratch repo, reads as a pass. **A verdict needs rc AND stdout to agree: DENY = the hook's documented deny rc (2 for a block-mode PreToolUse hook, e.g. the push guard's `exit 2`) WITH exactly one deny JSON document on stdout; ALLOW = rc 0 with empty stdout; anything else (126/127, a deny rc with empty stdout, rc 0 carrying a deny document, any other rc) = INSTRUMENT FAILURE, never a verdict.** *(Never list 2 among the instrument-failure codes: it is a block-mode hook's own deny code.)*

<!-- TRAP keys: --numstat -->
- ⛔ **`git diff --numstat` DROPS A NONEXISTENT DECLARED PATH AT rc=0 WITH NO STDERR, AND AN UNCHANGED PATH READS IDENTICALLY — so neither `rows < paths` nor `rows == paths` is a tell.** ⛔ **NO VALIDATOR IS PRESCRIBED: a diff matches TREES, `add`/`ls-files` match WORKTREE/INDEX, and `add --dry-run` TAKES the index lock. Pick by plane.** Archive. ⛔ **AND IT HAS NO MOVE DETECTION: a moved block reads as N deleted + N added, near 1:1, so never call lines lost or offer a re-insert from a numstat whose two columns are nearly equal — run an exact-line multiset against HEAD first.** Measured twice on a shared tracker file: both times most of the "deleted" lines were present elsewhere.



## from `bash-environment.md` § Verifying your own edits — the roles reverse

<!-- TRAP keys: mkstemp, NamedTemporaryFile, "w"), 'w') -->
- ⛔ **A ZERO-BYTE FILE SATISFIES EVERY ABSENCE CHECK YOU WOULD RUN TO REASSURE YOURSELF.** `open(p,"w")` truncates BEFORE writing, so a write that then THROWS (an encode error — lone surrogates from a hand-written `\ud83d\udfe1` pair) leaves **0 bytes**, and the natural did-it-land probe `grep -c '<token>'` reads **0** — byte-identical to *the edit never applied*, which is the reassuring reading. Measured 2026-09-12: an 868-line script emptied, read as a no-op for two tool calls. **After ANY failed write, check SIZE (`wc -l`), never absence** — and write via a temp file + `os.replace` so a throw cannot reach the original.
- ⛔ **AND THAT TEMP-FILE REMEDY DESTROYS THE FILE MODE — `mkstemp` CREATES 0600 WITH NO EXECUTE BIT.** A git hook rewritten this way becomes NON-EXECUTABLE — silently disarmed — and any other file rewritten this way is left 0600. ⛔ **Git tracks only the execute bit, so most of that is INVISIBLE to `git diff` and to `--summary`.** `os.chmod(tmp, os.stat(p).st_mode & 0o777)` before the replace; `stat -f '%OLp'` to verify. Same class as the `--cacheinfo` mode trap, reached from the opposite direction — a SAFETY fix, not a staging one.

<!-- TRAP keys: run-changed-e2e, e2e-local -->
- ⛔ **IN THE SHARED TREE UNDER PEER WIP, A CHANGED-FILES E2E RUN IS VOID — AND A SYMLINKED `node_modules` IS NOT THE WAY OUT.** The build compiles every peer's uncommitted TS error and ends with no `N passed` line; a worktree with `ln -s` node_modules dies at build (`Symlink [project]/node_modules is invalid`). **TELL: no `N passed` line, or death in seconds on package resolution.** Run at a clean HEAD in a detached worktree with a HARD-LINKED `node_modules` (`pax -rwl`), and never `npm install` inside it; ⛔ run `pax -rwl node_modules "$W/"` FROM THE REPO ROOT with the RELATIVE operand — pax copies the path as typed, so an absolute `/Users/…/node_modules` lands at `$W/Users/…/node_modules` and `$W/node_modules` is missing (measured 2026-10-17; TELL: `$W/Users/` exists): recipe, env handling and teardown in `.claude/rules/tests-e2e.md` § RUN E2E AT A CLEAN HEAD, which is path-scoped to `tests/e2e/**` and so never reaches a runner who did not open a spec.

<!-- TRAP keys: worktree add -->
- **THIRTEENTH: the mutation LANDED and the RUNNER never started — landing is not running.** A detached worktree without `node_modules` dies at config load: rc=1 with NO counts line, exactly the RED being hunted, while the codified landed-check passes. TELL: rc=1 with no `Tests N failed | M passed` line is a VOID reading, never a RED. ⛔ **A SECOND CAUSE, COSTLIER THAN THE FIRST: A GUESSED OR NONEXISTENT PATH** — an invented spec filename returns an empty candidate list and rc=1, one step from a false RED-main broadcast. Confirm the path exists before reading any verdict off it. ⛔ **AND IT IS NEVER A GREEN EITHER — THE DIRECTION THAT BANKS.** In a matrix with arms EXPECTED to pass (a control that must tolerate a legitimate edit; a mutation that must NOT fire), the same void reads as CONFIRMATION and nothing questions it. **A matrix where 3 of 4 rows are void is indistinguishable from a clean one at a glance.** ⇒ **After ANY mutation, assert TWO things before reading anything: the mutation IS THERE (line-verified, not assumed — print LANDED), and the runner ACTUALLY RAN (a counts line exists). `no tests` is not a pass.** ⚠️ **A FIXTURE tsconfig KILLS THE COMPILER LIKE A MISSING `node_modules` KILLS THE RUNNER** — a `process`-using probe dies `TS2591` before any arm runs. All arms agreeing stays the tell. ⛔ **AND THE INVERSE LICENSES A VOID RUN: A COMPLETE COUNTS LINE DOES NOT MAKE ONE VALID.** A peer rewriting `node_modules` mid-run gave **28 failed files of which 25 were install churn**; the re-run read 3. **TELL: a dominant module-resolution error class plus `stat node_modules` mtime inside the run window.** ⛔ And an identical failed-TEST count across two runs is NOT reproduction — **14 both times, different causes**: compare failed FILES. Archive.

<!-- TRAP keys: set -e, setopt -->
- ⛔ **`set -e` IS INERT IN THE BASH TOOL SHELL, AND `setopt` REPORTS `errexit` ON ANYWAY.** An assert that refuses correctly does not stop the next line — and a seat CHECKING whether its guard took gets a confirming reading from a dead option, worse than silence. **TELL: an abort message and a successful mutation in the same call.** `&&`-chain every mutation to its guard — **AND the PROOF legs after it: a refused write followed by unchained verification legs certifies the UNEDITED file (93/93 green over a file the assert had just refused to touch, 2026-09-07).** ⚠️ Chain only legs whose PASS is rc=0 — a proof leg that legitimately exits 1 (an assert-ZERO `grep`) kills every leg after it under `&&`, the multi-literal-sweep false zero in § False zeros; `;`-separate those and read each count. Archive.


<!-- TRAP keys: perl -pi, perl -0pi -->
- **⛔ AN IN-PLACE EDITOR EXITS 0 ON ZERO MATCHES, so `perl -0pi -e '…' || python3 …` is a mutation fallback that CANNOT FIRE.** Three arms, pasted: no-match `rc=0` file UNCHANGED fallback did NOT run · positive control `rc=0` file CHANGED · `false || echo` fallback RAN. **rc is identical either way, so it carries no information** — the mirror of the `stat -f %m` trap in `session-cadence.md` at the opposite polarity. Assert the mutation LANDED (`assert new != old`) in the same call; a mutation arm whose mutation never applied is a vacuous control that passes. ⛔ **ASSERT THE *RESTORE* LANDED — it fails the OPPOSITE way: not a false PASS, a corrupted TREE.** An inverse REGEX is not an inverse EDIT — it cannot address POSITION, so a restore that LANDS can be wrong. Recipe + the 6 breakers + the many-writer carve (a mismatch on a shared file may be a peer's write, not yours): `tests-unit.md` § MUTATION TESTING — RESTORE-HALF BREAKERS, path-scoped to `tests/**`.

<!-- TRAP keys: git status, --porcelain -->
## READ THE PORCELAIN COLUMN BEFORE PICKING A DIFF — a bare `git diff` is BLIND to a staged change

Column 1 of `git status --porcelain` is INDEX-vs-HEAD, column 2 is WORKTREE-vs-index, and `git diff -- <file>` reads only the second — a rewritten staged file returns a clean, plausible ZERO.

```
M  file     <- column 1: STAGED. `git diff` is blind to it; use `git diff --cached`.
 M file     <- column 2: worktree-only. `git diff` sees it.
MM file     <- both planes differ; you need BOTH commands to see the whole change.
```

⛔ **AND THE OBVIOUS WAY TO READ COLUMN 1 DESTROYS IT — `awk '$1 ~ /^[MADRC]/'` EATS THE LEADING SPACE, SO EVERY WORKTREE-MODIFIED PATH READS AS STAGED.** awk splits on whitespace, so for `" M file"` `$1` is the *column 2* marker tested against a column-1 pattern. **TELL: your gate reports staged paths while `git diff --cached --name-only` returns nothing** — a gate contradicting itself in one output block. Measured 2026-09-08 in a hand-built `safe-commit` pre-stage probe — both shapes are PROPHYLACTIC, neither ships here (`MADRC` returns 0 files across `scripts/`, `.githooks/`, `.claude/hooks/`): ten ` M …` rows printed directly above the caption `(empty above = index clean)`; the index was genuinely clean. **It fails toward a FALSE BLOCK** — every peer's ordinary dirty file reads as a staged foreign path, which is exactly the signature the commit doctrine tells you to investigate as a collision. Read it positionally: `while IFS= read -r l; do c1=$(printf '%s' "$l" | cut -c1); …`. ⛔ **AND THE SIBLING `$2` SHAPE FAILS THE OPPOSITE WAY — A FALSE *CLEAR* — SO THE NATURAL NEXT INFERENCE FROM THE LINE ABOVE IS ALSO WRONG.** Reading *"for ` M file`, `$1` is the column-2 marker"* invites `$2 ~ /^[MADRC]/` for column 2; on ` M worktree-only.txt` awk gives `$2` the FILENAME, so a genuinely worktree-dirty file reads clean, silently — and it false-POSITIVES on the filename's first letter: measured **4 of 6** worktree-only rows built from this repo's real top-level files, the hits being `CLAUDE.md`, `AGENTS.md`, `README.md` and one more, all real top-level files of this repo rather than a synthetic fixture (2026-09-08). **The statement that kills both shapes at once: awk has no consistent field-to-column mapping here at all — `$1` is column 1 when column 1 is a letter and column 2 when column 1 is a space, so it is ROW-DEPENDENT.** The positional `cut -c1` remedy follows from that, not from the leading-space account.


<!-- TRAP keys: MEMORY*, ARCHIVE-*, SHARD-*, CHANGELOG* -->
- ⛔ **THE SHELL EXPANDS AN UNQUOTED GLOB PATHSPEC AGAINST THE DISK, SO `git status -- dir/MEMORY*.md` NEVER LISTS A DELETED FILE AND `git add -A --` NEVER STAGES IT.** Measured: unquoted **2** lines, quoted **3** (the ` D` row). It hid a roll's own shard deletion and a production push was refused hours later. **TELL: a glob pathspec after a roll, rename or delete.** Quote it (`'dir/MEMORY*.md'`) or pass the directory.

<!-- TRAP keys: SKIP_, test:integration -->
## `unset` EVERY `SKIP_*` BEFORE ANY SUITE OR GATE YOU INTEND TO BELIEVE — and know WHICH CLASS each escape is

An exported bypass reaches every child **within that ONE Bash call** (each tool call is a fresh shell — measured), so a suite invoked in the same call as the export manufactures a RED on a healthy gate. **TELL: every failure is a `FIRE:` arm of one hook.** ⛔ **TWO ESCAPE CLASSES BEHAVE OPPOSITELY:** an inline `SKIP_X=1 cmd` works for a SCRIPT gate whose env it genuinely sets (a check's own `SKIP_*` variable, read by a git hook script) and CANNOT work for a harness-spawned `PreToolUse` hook (`grep-blowup-warn.sh`, `help-arg-intercept.sh`) — the hook process is spawned BEFORE your command with the SESSION env, so the prefix is just text to it. For those the ONLY reaching channel is `.claude/settings.json`'s `"env"` block, applied at launch — NOT a session `export`, which does not survive to the next tool call. ⚠️ `SKIP_WRAP_COMPLETENESS=1` is prose-only, zero code consumers. Suite arms build their own env (`env -i PATH=... HOME=...` in `scripts/smoke-test-hooks.sh` — grep `env -i`). Full text: archive, 2026-08-25 displacement entry.

<!-- TRAP keys: -newermt -->
### `find` IS `bfs` HERE — IT REJECTS GNU RELATIVE TIMESTAMPS

`find … -newermt "90 minutes ago"` fails — and since 2026-08-26 it fails LOUD on this box (measured: rc=1 + stderr; the silent-rc=0 behavior this entry was filed for no longer reproduces). The trap that REMAINS: `find … 2>/dev/null | wc -l` still manufactures a clean `0`, and a pipe still eats the rc — ⛔ **and the `2>&1` form is WORSE: `… 2>&1 | wc -l` returns a CONSTANT 10 on every directory, a nonexistent one included — bfs's usage error is 10 lines, so the "count" is the error text (measured 2026-08-28).** Use `-newermt "$(date -v-90M '+%Y-%m-%d %H:%M')"`. Neither BSD nor GNU `findutils`, so the BSD-offender list above is a FLOOR.


<!-- TRAP keys: $(cd, cd .. -->
## USE ABSOLUTE PATHS — NEVER PUT A `cd` ON THE LEFT OF AN `&&` THAT GUARDS REAL WORK

Cwd RESETS between agent-thread calls, and between main-session calls too while `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` sits in `.claude/settings.json` (silently; the main-session `cd` entry below), so a relative `cd` breaks in call N+1 either way. **TELL: a stage that emits nothing while the surrounding output looks well-formed** — in `cd <relative> && <cmd>` the failed `cd` short-circuits the command that mattered. `cd` into a subdirectory also breaks the `@/lib/...` TS alias (tsconfig resolves from CWD) and the error names the MODULE, not the directory: run `npx tsx` probes from the repo root.

⛔ **A COMPOUND COMMAND MIXING A `cd` STAGE WITH A REPO-ROOT-RELATIVE PATH LATER HAS TWO ROOTS — AND `rm -f`'s MISSING-FILE EXIT 0 MAKES THE `&&` CONFIRMATION LIE.** N=3 in one session, all in the mail-store sweep (hard-code its paths absolute): a marker `rm -f` resolved under the mail dir, printed "cleared", and the marker's hook re-fired. Verify a deletion by COUNT, never the chain's echo.

⛔ **A `cd` INSIDE `$(...)` NEVER REACHES THE CALLER, SO A FIXTURE HELPER THAT `cd`s TO ITS OWN SCRATCH REPO SILENTLY AIMS EVERY LATER GIT VERB AT THE REAL ONE.** `D="$(newrepo x)"` runs it in a SUBSHELL and agent Bash calls reset cwd to the project root. **TELL: none — and the same session's FIRST harness was correct, because it kept an explicit `cd "$D"` after the substitution.** Measured 2026-08-30: 11 commits, 9 files on shared `main`, `tsc` red fleet-wide, the deploy pipeline closed behind 445 queued commits. **Assert it, never watch for it: a rig confirms `pwd -P` is the intended root and ABORTS if it resolves under the real repo, before any git verb.** Archive.

<!-- TRAP keys: main:cd "$, main:cd $, main:cd /private/tmp/ -->
## IN THE MAIN SESSION A `cd` DOES NOT OUTLIVE ITS CALL — THE RESET IS SILENT AND THE BASH TOOL DESCRIPTION SAYS THE OPPOSITE

With `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` in `.claude/settings.json` `env` (2026-09-23), the harness returns the main session's cwd to its launch directory after EVERY Bash call and prints no notice (2.1.280 binary: the flag suppresses the "Shell cwd was reset" line), while the Bash tool description still says the working directory persists. So `cd "$WT"` in one call and `git diff` / `git status` / `git add` in the next run against the SHARED main tree. In the 7 days before the flag, 35 cwd-sensitive git reads relied on a worktree cwd left by the previous main call. **Put `cd "$WT" &&` or `git -C "$WT"` in the SAME call as every command that depends on it.**

<!-- TRAP keys: .md /dev/null, .read /dev/null, .json /dev/null, .txt /dev/null, " /dev/null, mv all__ -->
## `mv <file> /dev/null` TREATS `/dev/null` AS A DESTINATION — ON THIS BOX IT FAILS AND THE FILE SURVIVES; ELSEWHERE IT CAN DESTROY THE FILE

`mv` falls back to copy-then-unlink across devices; on this box that failed because macOS refused the write (`mv: fastcopy: open() failed (to): /dev/null: Operation not permitted`) and the source survived — elsewhere is unmeasured. Measured 2026-09-23: an attempt to MARK a mail read as `mv <mail>.md /dev/null`, whose own recap then called it "missed its target, the mail is unaffected" — the understatement is the dangerous half. **To mark a mail read, use the verb: `python3 scripts/session-manifest.py mail-read <bare filename>`** — a hand `mv` on an `all__*` broadcast consumes it for every peer (the verb gives a broadcast a receipt instead; `mail-read`'s own docstring). Anything meant to silence OUTPUT goes after `>`, never as an `mv` operand.


<!-- TRAP keys: rm -rf "$, rm -rf $, rm -rf "${, rm -r "$ -->
## `rm -rf "$VAR"` IS REFUSED BY CLAUDE CODE'S OWN REMOVAL SAFETY CHECK — AND THE REFUSAL VOIDS THE WHOLE CALL, NOT JUST THE `rm`

The harness refuses a removal whose target it cannot resolve before running, such as a shell variable (`D=$(cd "$(mktemp -d)" && pwd -P); …; rm -rf "$D"`), and a refused call runs NONE of its commands. Measured 2026-09-25: a mutation-check call ended in that cleanup and its five mutation arms never ran; the retry wrote to a fixed scratchpad file and removed no directory. Same whole-call semantics as a block-mode hook deny (`bash-environment.md`), from a different source. **TELL: a measurement call that ends in cleanup came back with only a refusal.** Write to a literal scratchpad path, or delete in a SEPARATE call after reading the result.


<!-- TRAP keys: | bc, bc -l, scale= -->
## IN `bc`, MULTIPLY BEFORE DIVIDING **AND** SET `scale` — READ THE VALUE, NEVER THE EXIT CODE

```
echo "24689/24985*100"          | bc  -> 0     (default scale=0 truncates the DIVISION first; rc=0, no stderr)
echo "scale=1; 24689/24985*100" | bc  -> 90.0  (scale set and STILL wrong — divide-first loses 8.8 points)
echo "scale=1; 24689*100/24985" | bc  -> 98.8  <- correct: MULTIPLY BEFORE DIVIDING
printf 'x=3\ny=0\nx/y\n'        | bc  -> "Math error: divide by 0" on STDERR, empty stdout, rc=1
```

**The middle shape is the dangerous one — `90.0` is plausible and setting `scale` *feels* like the fix.** Never `2>/dev/null` a `bc` whose value you will use.


<!-- TRAP keys: python3 -, <<'PY' -->
## A PAYLOAD TO A CHILD INTERPRETER GOES IN A TEMP FILE — never an env var, never a pipe into `python3 -`

`payload | python3 - <<'PY'` takes the PROGRAM from stdin, so `sys.stdin.read()` is empty — which reads as a *measurement*, not a break. `FOO="$payload" python3 - …` hits the macOS ~1 MB env+args cap (1,019 KB ok / 1,024 KB E2BIG): `execve` fails, a trailing `|| true` swallows it, and the loss is SIZE-SELECTIVE, so the log looks healthy while missing its biggest rows. Use `PF="$(mktemp)"; printf '%s' "$payload" > "$PF"; python3 - "$LOG" "$PF" <<'PY' … ; rm -f "$PF"`.


<!-- TRAP keys: bash -c, --dry-run, --help, --check -->
## RUN ANY PROBE OF A SCRIPT'S BEHAVIOUR UNDER THAT SCRIPT'S OWN SHEBANG — the Bash tool is `/bin/zsh`, every hook is `#!/usr/bin/env bash`

`head -1 <script>` first, then `bash -c '…'` explicitly or invoke the script — derive the interpreter from the TARGET, never from habit, or the same reflex misreads a `#!/bin/sh` or `#!/usr/bin/env zsh` script. They disagree on NUL in command substitution, so a probe run here can REFUTE a true finding about a hook; the loss belongs to the CAPTURE line (`INPUT="$(cat)"`), not to the recent adjacent edit that merely reads it.

```
fixture on disk                                16 bytes (one NUL)
bash -c 'V="$(cat f)"; printf "%s" "$V"'  ->   15 bytes   <- NUL STRIPPED
zsh  -c 'V="$(cat f)"; printf "%s" "$V"'  ->   16 bytes   <- NUL PRESERVED
```

⛔ **A READ-SHAPED FLAG ON AN UNFAMILIAR SCRIPT IS A *WRITE* UNTIL YOU HAVE READ ITS ARGV PARSING (promoted here 2026-09-06 after sitting archive-only for four days).** `--help` / `--check` / `--dry-run` / `--list` are conventions, not guarantees: a script with no guard for the flag falls through to its default action. **TELL: you are probing a script you did not write, to find out what it does.** Measured 2026-09-06: an alias-blindness sweep ran `--help` against **117 scripts**; one had no guard and applied its annotation pass across **241 files, 11 of them always-loaded rules files** — and the seat then spent ~6 h attributing the dirt to a peer. `head -40` the argv block first, or run it in a throwaway worktree.


<!-- TRAP keys: find /tmp, $TMPDIR -->
## PROBE `"$TMPDIR"`, NOT `/tmp` — AND PLANT A NEEDLE BEFORE TRUSTING ANY ZERO

Two independent causes, either alone fatal: macOS `mktemp -t` writes to `$TMPDIR` (`/var/folders/…/T/`), and `/tmp` is a SYMLINK to `private/tmp` which `find` does not follow by default. A planted needle gives `find /tmp -maxdepth 1 …` → **0** against `find "$TMPDIR" -maxdepth 1 …` → **1**; fixing one cause still leaves a blind instrument.


<!-- TRAP keys: curl "$( -->
## SPLIT NESTED COMMAND-SUBSTITUTION INTO FILE-BASED STEPS — it can fail inside the sandbox

`X=$(cmd)` and `curl "$(grep …)"` can fail with `failed to change group ID`. Split into file-based steps rather than inlining substitution.


<!-- TRAP keys: while read, read -r -->
## TERMINATE A GENERATED LIST WITH A TRAILING NEWLINE, OR `while read` SILENTLY DROPS THE LAST RECORD

POSIX `read` returns non-zero on an unterminated last line — exit 0, nothing on stderr — and a byte-capped splitter puts the remainder LAST, so the dropped record is the one you can least afford. Use `"\n".join(xs) + "\n"` or `while read -r … || [ -n "$n" ]`, then verify the set by COUNT (`ls | wc -l` vs `wc -l plan.txt`). ⚠️ A capped listing whose cap equals the returned count (`ls -la "$OUT" | tail -6` returning six) cannot be told from a truncated one.


<!-- TRAP keys: -F -e, -F '\t, -F "\t -->
## `-F` IS FOR **ONE** FIXED STRING — `\|` INSIDE `grep -F` IS TWO LITERAL CHARACTERS AND MATCHES NOTHING

`grep -cF 'alpha\|beta' f` → **0** where `grep -cE 'alpha|beta' f` → **2**: a clean, plausible zero, exit 1 exactly like a real no-match — and because every guard here says PREFER `grep -F`, that remedy arms this bug on exactly the multi-token probes (vocabulary sweeps, dedup across spellings). **For N terms: loop `grep -F` per term, or `-E` with a FORWARD-ANCHORED pattern. Control: the term must be one the BROKEN form would MISS — ⛔ NOT merely one you know is present, which is the REFUTED shape (the TWELFTH vacuous-control way above) and stood here 87 lines below its own refutation.**

- ⛔ **`\t` IS TWO LITERAL CHARACTERS UNDER `grep -F` TOO, AND SINGLE QUOTES DO NOT MAKE IT A TAB (2026-09-29).** `grep -F '\turl'` over `vercel inspect` output matched nothing; `$(… | awk …)` then held an empty deployment id, `vercel redeploy "$D"` failed, and the background task still reported `exited with code 0` — the TOOL's exit code, taken from the call's last command (`echo rc=$?; tail`), not from `vercel redeploy` (see the trailing-`; echo` bullet under § READ A BACKGROUND RUN'S VERDICT). **TELL: a field extracted from human CLI output comes back empty.** Use `grep -E $'\t'url` (ANSI-C quote) or, better, the CLI's JSON output, and guard the variable non-empty before the command that consumes it.

⛔ **A HOOK-FORCED `-E` → `-F -e` REWRITE CAN DROP THE ANCHOR AND THE KEY NAMES, AND THE THIN RESULT THEN GETS FILLED FROM RECALL.** `grep -n -E '^\s+(fieldA|fieldB)[A-Za-z]*:'` became `grep -n -F -e 'FieldA:' -e 'fieldA:'` to satisfy `grep-blowup-warn`; the plan-allowance value being sought never appeared, and a number read off a SIBLING string in the same bundle was reported in its place (2026-09-03). After a forced rewrite, re-read what the anchor was doing; an empty or thin result after it is an instrument failure, not a finding.


<!-- TRAP keys: grep -c, || echo 0 -->
## NEVER `|| echo 0` ON `grep -c` — IT PRINTS `0` **AND** EXITS 1, SO THE `||` FIRES TOO

`N=$(grep -c pattern file || echo 0)` makes `$N` the two-line string `"0\n0"`, and every downstream comparison then behaves unpredictably. Use `N=$(grep -c pattern file); N=${N:-0}` — or just accept grep's exit code as the signal it is. ⛔ **THE COMPOSITE WITH A NUL-BEARING FILE HAS NO TELL AT ALL:** on a binary-detected file grep prints NOTHING and exits 1, so the `||` fires and manufactures a SINGLE clean `0` — not the two-line string — indistinguishable from a true zero. Four fabricated zeros were read as proof of absence and used to overrule a correct finding; with `-a` the same file returned 4. Both halves are codified separately above; the composite converts silence into a confident measurement.



## from `bash-environment.md` § READ A BACKGROUND RUN'S VERDICT FROM THE ARTIFACT, NEVER FROM THE HARNESS'S REPORTED STATUS

<!-- TRAP keys: nohup, setsid -->
- ⛔ **A `setsid`/`nohup` DETACH FROM A *FOREGROUND* BASH CALL DOES NOT PERSIST, AND THE LAUNCH LINE FABRICATES A CONFIRMATION.** `nohup setsid bash -c '…' & sleep 2; echo "launched; pid $!"` printed a pid for a process that was already gone (rc=1 on the line, unremarked); the job never ran and a file-watcher waited on output that could never arrive. **Use the Monitor tool with `timeout_ms: 1800000`** — that is what worked (it read `persistent: true` until 2026-09-26; the tool has no such parameter and caps every watch at 30 minutes, so re-arm on expiry). ⚠️ And the liveness check that hid it: `ps -p $P -o pid= 2>/dev/null | cut -c1-100 || echo "(pid gone)"` — the `||` binds to **`cut`**, which always exits 0, so the fallback can never fire and a dead process reads as a formatting quirk.

<!-- TRAP keys: ; echo, rc=$? -->
- **A trailing `; echo` reports the TAIL's status.** `cmd > log 2>&1; echo "rc=$?"` shows `exit code 0` when `cmd` exited 1. Read the verdict from the run's own sentinels (status file, `CERT-VERDICT` line).

<!-- TRAP keys: kill -TERM, kill -15, kill -KILL, kill -9, kill -s, kill "$, kill $, kill 1, kill 2, kill 3, kill 4, kill 5, kill 6, kill 7, kill 8, kill 9, pkill -->
- **A `ps` right after `kill` (TERM by default) can list a process TERM has already killed.** A large one stays in STAT `E` (exit teardown) for about 20 ms per GB, and an unreaped child shows `Z`, so "TERM didn't take, escalating to SIGKILL" is a misreading. Read STAT: `E` or `Z` means it is already dying. Measured 2026-08-01: the harness had recorded the task `failed with exit code 143` while the report said TERM failed, and the compaction summary carried that version forward. Poll with a real wait, then read the reaped code: **143 = SIGTERM, 137 = SIGKILL**. Keyed on a literal pid via `kill 1` … `kill 9` (a pid never starts with 0); not on `; kill` / `&& kill`, which over 14 days fired 720 times out of 849 on `kill -0` liveness probes.

<!-- TRAP keys: pkill -f, pkill, killall -->
- ⛔ **`pkill -f <pattern>` MATCHES ANYWHERE IN THE FULL COMMAND LINE OF EVERY PROCESS YOU OWN, AND ON macOS EVERY OPTION AFTER THE PATTERN BECOMES ONE MORE PATTERN.** 2026-10-05, a sub-agent meaning "my newest `cat`": `pkill -f 'cat' -U $(id -u) -n` read `-U`, `501` and `-n` as patterns, and `cat` sits inside `/Applications/` while `501` sits inside every `/private/tmp/claude-501/` path, so it SIGTERMed 36 logged launchd jobs in one second (Chrome, Outlook, every other iTerm tab, four Claude sessions). Only its own ancestors survived (`man pkill`, `-a`). `block-dangerous.sh` (arm `kill-option-order`) now refuses the option order; **nothing refuses a short pattern in the right order, and that half is still a lottery. Kill by pid: `pgrep -lf -- '<long specific pattern>'`, read the list, then `kill <pid>` of a process you started.**

<!-- TRAP keys: log show, log stream, log collect -->
- **`log show …` IN THE BASH TOOL RUNS zsh'S `log` BUILTIN, NOT macOS's unified-log tool: it prints `log:1: too many arguments` and exits 1, and a `2>/dev/null` turns that into an empty file that reads like a quiet log.** Call `/usr/bin/log show --style compact --start '<local time>' --end '<local time>'`. Measured 2026-10-05: a filtered probe wrote 0 lines; an unfiltered control showed the builtin's error; `/usr/bin/log` returned 51,050 lines for 15 seconds. **TELL: a system-log probe returns nothing for a window in which you know something happened.** To find who sent a signal, grep the window for `sent by` (launchd records `exited due to SIGTERM | sent by <proc>[pid]`).

<!-- TRAP keys: ps -p -->
- **A `ps`/`grep` liveness check self-matches its own shell wrapper** — the `[p]attern` trick does not stop the parent `/bin/zsh -c source…` matching. **TELL: a count of 2 where you expect 1.** Match the CHILD's command line, confirm against a GROWING output file, run it unpiped.

<!-- TRAP keys: | tee -->
- **The task's `<output-file>` holds only the TAIL of a long run.** `| tee /tmp/<descriptor>.log` INSIDE the command is the complete record.

<!-- TRAP keys: $(grep -->
## DO NOT NEST QUOTES THROUGH `$(...)` — the escape written for the OUTER context becomes a literal backslash

The quoting context inside a substitution is FRESH, so `\"` stops being an escape and matches nothing: `echo "count: $(grep -cF '?? \"TOKEN\"' file)"` returns **0** where `grep -nF '?? "TOKEN"' file` returns 3. Run the grep on its own line, or assign a variable outside the substitution. **TELL: one command's count contradicts another's listing over the SAME file, so the instrument is wrong, not the file.**


<!-- TRAP keys: grep -c ', ${ -->
## USE `grep -F` FOR EVERY CONTENT-KEY, LANDED-CHECK AND RESTORE-CHECK — `$` IS A BRE ANCHOR

`grep -c '${TOKEN}' file` returns **0 / rc=1** on a file that literally contains `${TOKEN}`; `grep -cF` returns 1. **Any token carrying `$`, backtick, `(`, `[`, `.`, `*` or `|` takes `-F`.** This false zero EXONERATES (you read *"the mutation never landed"* and walk away from a decorative arm), so run the same pattern with `-F` alongside as a free positive control: a plain `0` beside a non-zero `-F` IS the trap.


<!-- TRAP keys: $(cat, xargs -->
## NEVER INTERPOLATE A POSSIBLY-EMPTY LIST INTO A SCANNING COMMAND

An empty `$(...)` leaves NO file operand, so `grep -r` / `du` fall back to the CWD: `grep -rl -F 'sk-' $(cat empty.txt)` silently scans everything at rc=0. It fails to a LOUD FALSE ALARM whose only tell is an implausible file count. ⛔ **The NON-recursive form fails the OPPOSITE way: no operand ⇒ plain `grep` reads STDIN and HANGS to the tool timeout** — a stall that reads as "the scan was big", never as an alarm (measured 2026-09-03: exit 143 at the full 2-min cap, on a wrap sweep). **Gate on the count first (`[ -s list ] || { echo "EMPTY — scan skipped"; exit 1; }`) or drive the scan with `xargs`, and treat any alarm from a substitution-scoped scan as UN-READ until you confirm the list was non-empty.**


<!-- TRAP keys: | tail -->
## READ COUNTS, NEVER A PIPED EXIT CODE — AND NEVER CAP A WORKLIST, A RECENCY ANSWER, A REFUSAL, A LINT REPORT, A TOOL'S OWN SIDE-EFFECT NOTICE, OR A DEDUP/PRIOR-ART SWEEP

A pipeline's exit code is the LAST stage's (`ls /nonexistent | head` exits **0**) — read the `Tests N failed | M passed` line, or run unpiped (`cmd > /tmp/out 2>&1; echo $?`). **These output kinds must never be capped:** a WORKLIST (a `| tail -5` makes it a PARTIAL instruction nothing downstream disputes — ask what the last line is FOR: a summary you interpret, or an item you must act on); a RECENCY question (*latest / still / already* — **in a tracker or a decisions log kept in FILING order, `grep | head` returns the OLDEST and drops the NEWEST, where the live gate or the governing CUT entry sits** — a capped dedup/prior-art sweep argues for whatever you already believed, because the hits you have not seen decide the answer); a REFUSAL (diagnostic and boilerplate sit at OPPOSITE ends of the merged stream — a `tail -8` cut the one line naming the missing `--`); a LINT REPORT (the file-path header prints ABOVE its errors, so a `tail -N` attributes them to the FOLLOWING file — TELL: a zero-hit grep for the offending token in the blamed file; re-run scoped, `npx eslint <file>`); and **A TOOL'S OWN SIDE-EFFECT NOTICE** — a repair tool names what it MUTATED on its LAST line (`architecture-counts.mjs fix` → *"Mutated files — now DIRTY"*, which `/wrap` 7d requires you to stage), so a `tail -5` cuts precisely it and you believe a file is clean that you left dirty. **TELL: you capped a command that WRITES.** ⛔ **AND A RECENCY CAP OVER AN INBOX FAILS INVERTED: a hold's CLEAR is time-adjacent to its HOLD, not to now** — and a lift can live only in a fold COMMIT body, a plane no mail sweep reads. Walk the chain forward from the HOLD, and `git log --grep=<held-sha>` before calling it live. Instances (three capped reads in one checkpoint, all caught by re-running uncapped and none by care; a hold reported LIVE 35 min after its lift): archive.

<!-- TRAP keys: git diff -U0, ^-[^-] -->
## NEVER `grep '^-[^-]'` TO FIND DELETED LINES, AND NEVER STRIP DIFF HEADERS WITH A TWO-CHARACTER CLASS

The diff marker is the FIRST character and the second belongs to the content, so on any file whose content lines begin `- ` both idioms fail silently: `'^-[^-]'` is an unfalsifiable ZERO, and `git diff -U0 <f> | grep -E '^[-+]' | grep -v '^[-+][-+]'` eats the hunk and prints a false EMPTY. **Use `git diff -U0 <f> | grep '^-' | grep -v '^---'`** — ⛔ **EXCEPT on a `--`-commented corpus (SQL, Lua, Haskell), where the `'^---'` strip eats every deleted COMMENT line too: measured on a SQL migration, the recipe read 27 deletions against a numstat 76, and the tell was `comment: 0` on a file that is mostly comments. There, drop the diff headers POSITIONALLY (`diff --git` / `index ` / `--- a/` / `+++ b/` / `@@`), never by pattern** — and gate deletions on `git diff --numstat`'s delete column. **TELL for the empty form: `git status` reads the file as changed while `git diff` reads it as unchanged.** Reach is every `todo.txt` row, every markdown bullet, and a prompt bullet inside a `.ts` template literal.


<!-- TRAP keys: todo.txt, BACKLOG.md, messages/ -->
## BULK-EDIT A MANY-WRITER FILE WITH `Edit` CALLS, NEVER A READ-MODIFY-WRITE SCRIPT

On `todo.txt`, `BACKLOG.md`, `messages/*.json` or any `MEMORY.md`, a script that reads the file, computes N edits and writes it back has a lost-update window spanning **everything between the read and the write**; `Edit` is *n* calls that each fail loudly when the anchor moved. **The shape that pulls you off it is the MULTI-ANCHOR edit**, where three changes read as "a small script". Same prescription for JSON, where a `json.load → json.dump` round-trip irreversibly reformats the whole file — if a DELETE column explodes on a JSON file you scripted, the discriminator is an OBJECT-GRAPH compare against `HEAD~1`, never the line diff.


<!-- TRAP keys: git checkout, git show HEAD: -->
## RESTORE FROM A FRESH IMAGE (`git show HEAD:<file>`), NEVER A SNAPSHOT YOU TOOK MINUTES AGO

The codified *"restore by the INVERSE, never an image"* rule is about STALENESS, not images: `git show HEAD:<file>` already contains the peer's commit, so rebuilding from it and re-applying your own anchors cannot lose them. A `cp f /tmp/bak` → mutate → `cp /tmp/bak f` ritual is correct on a private file; on a shared one it reverts **every peer commit landed during the whole experiment** while restoring your own mutation byte-perfectly, which is what makes it read as clean. Hold a snapshot only to DIFF against, and not `git checkout` (it discards co-located edits, and is a silent no-op on an untracked file). ⛔ **A worktree deletion may be DELIBERATE** and no diff distinguishes it from a line you destroyed — **grep the worktree for the row-name STEM before restoring: a deliberate replacement leaves a RENAMED SUCCESSOR, and a restore then creates a duplicate** (measured 2026-09-01: an 11-line "lost" row was a peer's uncommitted rewrite under a new name two rows down; the restore was spliced and un-spliced in one turn — a successor renamed OFF the stem still escapes). ⛔ **AND THE SUCCESSOR CAN BE A PROVENANCE NOTE INSIDE THE SAME ROW, WHICH A STEM GREP *AND* A WHOLE-FILE PRESENCE TEST BOTH READ AS UNCHANGED.** Measured 2026-09-11 on one figure corrected THREE times, each in the same direction: 61 broadcast, 11 by multiset compare, **3 of those 11 deliberate supersessions** whose row quotes the line it removed. **A presence test cannot tell a destroyed line from a replaced one — read the row for a note claiming the removal before restoring into it.** The over-count is the ALARMING reading and it reached broadcast twice. Archive. No successor and no such note ⇒ restore to stop the bleeding, then say what you restored on the mail bus.



## from `bash-environment.md` § RESTORE FROM A FRESH IMAGE (`git show HEAD:<file>`), NEVER A SNAPSHOT YOU TOOK MINUTES AGO

<!-- TRAP keys: worktrees/, hash-object -->
- ⛔ **AN AGENT WORKTREE'S FILE IS A DISPATCH-TIME SNAPSHOT — STAGING ITS BYTES REVERTS EVERY PEER COMMIT SINCE.** Measured 2026-09-15: 12 bundles hash-objected from a worktree read **29/63** vs HEAD for an agent diff of 29/61; the 2 extra deletions were a peer's mid-merge commit. **TELL: the cached diff names a token the agent never touched.** Apply the agent's PATCH to the main tree; stage from the main tree. Archive.


<!-- TRAP keys: hdiutil, gpg, ssh-keygen, sudo -S, openssl -->
## NEVER OPERATE ON A CREDENTIAL-PROTECTED ARTIFACT FROM THIS SHELL — hand it to the owner

`tty` returns **"not a tty"**, so nothing can prompt for a secret (`hdiutil -encryption`, `ssh-keygen` without `-N`, `gpg`, `sudo -S`, `openssl`). **TELL, and you cannot predict which you get: an errno that reads as a broken tool (`Inappropriate ioctl for device`), or an unrequested password dialog on the OWNER'S DESKTOP** (`hdiutil attach`, and `imageinfo` too — "metadata needs no key" is FALSE). No flag fixes it: `-stdinpass` / `--passphrase-fd` are BANNED (secret on argv), `-agentpass` gives the identical ENOTTY, `!`-prefixed commands share this shell. `ls -la` gives size and mtime; if a check requires the key it is not your check to run. **Generalizes: when a failure is in a class your environment structurally CANNOT exercise, stop proposing fixes and hand it to the environment that can** — two rounds of the owner re-running a failing command buys nothing.


<!-- TRAP keys: shasum -->
## ASSERT BOTH SIDES NON-EMPTY BEFORE BRANCHING ON A HASH COMPARE

`shasum` on a DIRECTORY prints `Is a directory` to stderr and NOTHING to stdout, so `s2=$(shasum <path> | awk '{print $1}')` captures `""` and `[ "$s1" != "$s2" ]` reports DIFFERS for two identical artifacts. Gate on `[ -n "$s1" ] && [ -n "$s2" ]`, and never `2>/dev/null` a hash whose output feeds a verdict.


<!-- TRAP keys: vercel env -->
## PARSE A WRITE-SIDE VENDOR CLI'S BODY — `rc=0` COEXISTS WITH `{"status":"error"}`

`vercel env add` returned rc=0 with `"status":"error"` in the body: four green checkmarks, four EMPTY prod env flags. **Parse the body's error/status field or re-read the resource after writing; `rc` certifies only that the CLI process exited.** ⛔ **AND IT SAVES AS *SENSITIVE* BY DEFAULT on Production, Preview and custom targets (Development and `NEXT_PUBLIC_*` default to Config; vendor `/docs/cli/env` § Type, read 2026-10-16), so a feature flag nobody can ever read back (not the CLI, not the dashboard) is the default outcome: pass `--no-sensitive` when you ADD a non-secret value (never re-add a credential that way; the read-side row governs that).** Measured twice: 2026-09-03 on a set of production vars, and 2026-10-16 on one of the product's feature-flag env vars, added to staging Sensitive and re-saved readable.

*Paired entry, SAME KEY `vercel env`: the READ-side row above — sensitive vars have no live-value oracle. Any command that fires this one fires that one; correct or trim them TOGETHER.*


<!-- TRAP keys: :(literal) -->
### PASS `:(literal)` TO THE READ-SIDE GIT VERBS AND QUOTE THE PATH — AND A BAD REV WITH A BRACKETED PATH EXITS 0, SILENT

A pathspec into a bracketed route directory (`src/app/[slug]/…`) matching nothing is caused by **zsh not word-splitting the path variable**, and fixing that alone is sufficient: git's own `[...]` globbing did NOT reproduce for `git show` / `git diff` with an exact path **and a VALID rev**, and `git add` / `git status -- <path>` are UNTESTED — **never cite the bracket hazard as established for all five verbs.** Quoting stops only the SHELL, so pass the prefix anyway: `git diff -- ':(literal)src/app/[slug]/page.tsx'`.

⛔ **THE BAD-REV ARM IS MEASURED AND IT FAILS SILENT ON ALL THREE CHANNELS AT ONCE.** Unresolvable rev + a BRACKETED path → **rc=0, 0 stdout, 0 stderr**; the same bad rev on a plain, unbracketed path → **rc=128 + stderr**. **There is no channel left to check** — so a typo'd sha and an empty file are indistinguishable by every means, and any control keyed on `git show <rev>:<route-file>` is vacuous for **every path through a bracketed dynamic segment** — *not "every App Router path", which this line once claimed: in the measured app most page/route files are NOT bracketed, and an unbracketed path is the working control.* A VALID rev on a bracketed path returns the file normally (4 arms, 2 seats). `git cat-file -e <rev>:<path>` first. Archive.



## from `bash-environment.md` § FOUR GIT PROBES THAT SILENTLY ANSWER A DIFFERENT QUESTION — a well-formed WRONG answer, not an error

<!-- TRAP keys: git reflog -->
- ⛔ **`git reflog show origin/main --date=iso` ANSWERS "DID *I* PUSH", NOT "DID A PUSH HAPPEN" — THIS ROW HAD IT BACKWARDS UNTIL 2026-09-06** (it read *"separates the remote moved from I fetched"*). It records how THIS CLONE's ref moved, so `update by push` = pushed from here and **a PEER's push arrives as `fetch origin: fast-forward`** — measured, 4 consecutive push/fetch pairs, and `origin/main` sits at a sha that landed as a FETCH. Strong for ATTRIBUTION, useless for *did a push happen*. **TELL: you read only the top line** — 30 s after your own push the newest entry is routinely a peer's fetch; find the entry whose NEW VALUE is your sha. An unpushed COUNT still cannot discriminate *no push* from *a push, then peers kept committing*. Archive.


<!-- TRAP keys: merge-base, --is-ancestor -->
- **`git merge-base --is-ancestor` and `origin/main`'s position answer "what is reachable NOW", never "what did MY push move".** On a shared branch both are equally true of your tip and of a peer's that landed on top. Only git's own `<old>..<new> ref -> ref` line settles it, and it sits in the `tee`'d push log (measured: it inverted a TRUE owner-facing claim two days later).

<!-- TRAP keys: git log --all -->
- **`git log --all -1 <SHA>` returns HEAD, not `<SHA>`** — `--all` adds every ref as a start point and `-1` takes the newest overall, so it "confirms" any sha you pass, with HEAD's subject as corroboration. **Drop `--all` when pinning a commit.**

<!-- TRAP keys: git log --format=, git log --name-only, git log --stat, git diff-tree, git show -s -->
- **`git log <A> <B> <C>` WALKS FULL ANCESTRY — it does not list those commits.** Use `git show -s` (or `--no-walk`) when the shas ARE the set; `git log` is for ranges (`A..B`). Its neighbour `git show --numstat A -- <path>` is correct and reads as the same kind of verb. ⛔ **AND `git diff-tree -r` IS THAT TRAP ONE VERB OVER, REPAIR WORSE THAN BREAK:** four shas DIFF TREES — rc=0, **0 stdout, 0 stderr**, silent on every channel, reading as *checked, all clean*; the two-sha retry returns a PLAUSIBLE WRONG LIST (measured: 4 files, one in NONE of the four; true set 8 via `git show --name-only`). **TELL: N shas to a verb whose 2nd arg is a tree.** Archive.

<!-- TRAP keys: git log -S, git log -G -->
- **`git log -S <TOKEN>` is blind to a version bump** — `-S` reports COUNT changes, so `v2.16` → `v2.17` is 1 before, 1 after; **use `-G` for edits.** Both are CASE-SENSITIVE BY DEFAULT and **both DO honor `-i`** (git 2.50.1; `--pickaxe-regex` NOT required), so the fix for a suspicious zero is `-i`, not a `grep -c` cross-check. ⛔ **BUT `-S` IS A FIXED STRING AND `-G` IS A REGEX — a PROSE payload false-zeros under `-G` on any `(`, `.`, `*`, `[` or `|` in it** (`-G 'REFUTED 2026-08-27 (both halves)'` → EMPTY on the very commit `-G 'There is NO floor'` finds). **Escape the payload, or keep a paren-free sub-phrase** — a `-G` zero over prose is a HYPOTHESIS until re-run on a punctuation-free fragment; `tests-unit.md` prescribes `-G` the same way and inherits the trap. ⛔ **AND BOTH MATCH SUBSTRINGS — on an inflected corpus `-S 'stanete'` counts `prestanete`** (all 8 "confirming" hits were a different verb; two seats drew the same wrong causation, exculpatory direction, in outbound mail). READ the matched diffs before any causation claim — or ask the domain checker. Archive.


<!-- TRAP keys: todo.txt, sed -n -->
## READ A `todo.txt` ROW BY RANGE — rows average ~9 lines (2026-08-26; derive: total lines / `^- \[` rows), `grep -n` returns the FIRST line, and state lives at the END

A one-line read drops `done-when:`/`trigger:`/`filed:` and **a truncated row reads as a complete one**. ⛔ The obvious range recipe `awk '/^- \[[ x]\] ROW/,/^- \[/'` **collapses to ONE line every time** — the start line itself matches the end pattern. **Two-step form:** `N=$(grep -nE '^- \[[^\]]*\] <ROW-NAME>' todo.txt | head -1 | cut -d: -f1)` then `awk -v s="$N" 'NR>s && /^- \[/ {print NR-1; exit}'` then `sed -n "${N},${END}p"` — ⛔ **when the row is the file's LAST, the awk prints nothing and `END` is empty (`sed: "43146,p": expected context address`); new rows are appended last, so this hits the row you just filed: `END=${END:-\$}`** (measured 2026-09-29) — `^- \[` alone is the whole row-start set (18 rows are not `[ ]`/`[x]` and most names are not ALLCAPS, so a `[ x]`/`[A-Z]` END-finder over-runs into the next row) — re-locate by NAME (line numbers shift in minutes), and the `^- \[[^\]]*\] ` anchor is load-bearing: a bare name-grep lands on a cross-row MENTION silently (house style cites rows by name). ⛔ **Read to the row's END before acting on its state — closures and owner rulings are APPENDED.** ⛔ **INVERTED by a MID-ROW insertion: a fold note spliced into the middle leaves the TAIL as the OLDEST text** (a row's last 700 bytes read pre-fold and false, the fold sha 3,000 bytes above them). **Locate the newest DATE in the row, not the last line.** ⛔ **And never read BACKWARD from a row's END (`sed -n "$((END-8)),${END}p"`)** — a row shorter than the window serves the PREVIOUS row's tail, `status:` line included, under your row's name; the ~9-line average is what makes a fixed backward window feel safe. Instances + full text: archive.
⛔ **AND NEVER CAP THE ROW'S *WIDTH* — A CORRECT RANGE READ STILL DISCARDS THE ROW.** A `%.Ns` inside an otherwise-right range read showed **7.7%** of an 1,829-char row. **TELL: you obeyed THIS section, so the width cap reads as already-governed** — that ban sits in a different section, keyed to a different act and no longer delivered, so this bullet is the ban's only per-command carrier — permanently, the experiment having closed with the park kept. 1 of 3 capped reads that night — the others were LINE caps. Archive.

<!-- TRAP keys: writelines, os.replace -->
## NEVER `find()` IN A SLICE BOUND, NEVER WRITE A FILE OVER A LAZY READ OF ITSELF, AND SIZE-CHECK EVERY SCRIPTED REPAIR
**TELL: both exit 0 with a success line printed and the file wrong by thousands of lines** — and a repair lands on a file you already believe damaged, so the wrong result looks like it. Compare line count before vs after against what your edit can produce.

**(c)** A SINGLE-PASS `awk` CANNOT MOVE A BLOCK **BACKWARD** — the destination line fires before the source has been collected, so the block is deleted and never re-inserted. Measured on a many-writer markdown file: declared `15 15`, numstat read **`1 15`**, and a content-key on the moved anchor read **0**. **Direction is the whole trap: a FORWARD move works in one pass, which is why the habit survives.** Name the file TWICE and gate on `NR==FNR`. Two free tells, both present: the add/del columns do not balance on a pure move, and the anchor content-keys to zero.
**(a)** `str.find()` returns `-1` on a miss and `-1` is a legal slice index, so `head[k:-1]` runs to end-of-file — it replaced one sentence with the rest of the file while printing `restored 2 of 3 hunks`. Use `index()`, which raises; a `find`-bounded slice has no landed-check.
**(b)** `open(p,'w')` TRUNCATES AT OPEN, so ANY read of the same path that has not already RUN is reading an empty file. ⛔ **LAZINESS IS NOT THE MECHANISM AND THIS BULLET SAID IT WAS UNTIL 2026-09-16 — ARGUMENT-EVALUATION ORDER IS ENOUGH, AND IT EXONERATES THE EAGER FORM THAT ACTUALLY FIRES.** Two shapes, one cause: the lazy generator `io.open(p,'w').writelines([l for l in io.open(p) if TOKEN not in l])`, and — measured on a SHARED tracker file, **emptied to 0 lines** — `io.open(p,'w').write(f(io.open(p).read()))`, where `.read()` is fully EAGER and still returns `''` because python evaluates the `'w'` open first. A seat that knows the lazy rule reads the second form as safe. **TELL: the write target and a read source are the same path in ONE expression.** ⚠️ **AN ASSERT CANNOT SAVE YOU — the truncation happens at `open()`, before any guard you wrote can run**: a downstream assert fired correctly here and the file was already empty. Materialise first (`data = f(io.open(p).read()); io.open(p,'w').write(data)`), and on a file other seats hold uncommitted write a temp file + `os.chmod` + `os.replace` so a throw cannot reach the original. Cost when it lands on a shared tracker: every UNCOMMITTED row, unrecoverable — no dangling blob exceeded HEAD. ⛔ **AUTHORSHIP IS UNDERIVABLE HERE BY CONSTRUCTION AND THIS SENTENCE SAID "four peers" FOR ONE COMMIT: uncommitted means NO git author**, `whose-edit` answers at FILE granularity and the file is shared, so neither the number of writers nor their identity is establishable; the lost-line count is the only defensible figure.

<!-- END OF FILE — a new section HERE is the measured regrowth path; use the matching subsection. -->



<!-- TRAP keys: vercel logs -->
## `vercel logs` FILTERS TO THE CURRENT GIT BRANCH AND RETURNS AT MOST 50 ROWS — BOTH SILENTLY, BOTH SHAPED LIKE QUIET TRAFFIC

Two independent false readings, measured 2026-10-13 (a staging burst test). **(1) Without `--no-branch` the CLI keeps only deployments built from the branch you have checked out**, so on `dev` a production read returned "No logs found" and two staging reads returned 0 rows — three empty readings, all the filter. **(2) It returns at most 50 rows, newest first, whatever `--limit` says** (`--limit 500` and `--limit 1000` both came back with 50): a watcher printed `DONE: 50 rows, 1 /api/<route>` where the true count was 6, and the owner was told the other requests "haven't reached the log feed yet". **TELL: exactly 50 rows, or zero rows from a deployment you know served traffic.** Pass `--no-branch`, and slice a busy window with `--since`/`--until` (per minute, then per 10 s) until every slice returns fewer than 50.

<!-- TRAP keys: ; git add, ; git commit, ; bash scripts/safe-commit -->
## A VALIDATOR JOINED WITH `;` IS DECORATIVE — ITS TRACEBACK PRINTS AND THE COMMIT RUNS ANYWAY

`python3 -c 'import json; json.load(open(F))'; git add F && safe-commit …` prints the parse error and then commits the broken file, because `;` ignores the validator's exit code. Measured 2026-10-15: a quotation written into an eval-set JSON file with bare double quotes made the file invalid JSON, the traceback printed, and the commit landed anyway; it was repaired a minute later, and 569 tests read that file. **Join a validator to the commit with `&&`, or run it in its own call and read it first.**
