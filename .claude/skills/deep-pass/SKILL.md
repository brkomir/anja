---
name: deep-pass
description: Parallel-agent deep-pass over a huge or multiday session's transcript, for /wrap Step 1b-DEEP and for post-compaction recovery. Use when this session compacted (a record, not a phrase) AND the stripped transcript exceeds 3 MB or the session spans more than 20 commits — the inline scan systematically under-scans at that size.
---

**The core, paid on every invocation and re-attached after every compaction.** The why is in `references/deep-pass-detail.md`, by step; the annotated checkpoint derivation is `references/checkpoint-derivation.md`. This core wins any disagreement. **Appending:** DIRECTIVE + TELL + the number the action needs here, the why to the reference in the SAME commit; a correction REPLACES. Ceiling: a byte-budget test (not in this copy). Injected into the transcript the detectors scan, so every worked example stays digit-free (`START,ENDp`, `<N>`, `wrap-dp-<i>`) and no `wrap-dp-<wordchar>` filename is ever written here.

# Deep-pass — the parallel-agent transcript scan

1b-DEEP. **Mandatory PARALLEL-agent deep-pass for HUGE / multiday sessions** — a BOUNDED PARALLEL pass, AUTO-fired, never owner-prompted.

**Trigger — auto-detect (fire when this session compacted — a record, per /wrap Step 1b's Detection, auto or `/compact` — AND either bound is crossed):**
```bash
TX="$HOME/.claude/projects/<project-key>/${CLAUDE_CODE_SESSION_ID}.jsonl"
# STRIP FIRST, then measure — the unit is BYTES.
TXT=/tmp/wrap-stripped-${CLAUDE_CODE_SESSION_ID}.jsonl   # SESSION-SCOPED — see below
# ⛔ BLANK image payloads (keys `data`, `base64`) and stub `api-request*` records (prefix test) to one line — NEVER DELETE
# A LINE (line numbers must match the raw transcript); after an edit to the base64 half, run this block, blankBase64Payloads in
# scripts/lib/transcript-strip.mjs and transcript_bytes in scripts/wrap-preflight.py on one transcript and compare byte counts.
python3 -c 'import re,sys
R=re.compile(r"^\{\"type\":\"(api-request[a-z-]*)\"")
for l in open(sys.argv[1],encoding="utf-8",errors="replace"):
    m=R.match(l)
    sys.stdout.write("{\"type\":\"%s\",\"stripped\":\"request copy\"}\n" % m.group(1) if m else re.sub(r"\"(data|base64)\":\"[^\"]{200,}\"","\"\\1\":\"<stripped>\"",l) if "\"type\":\"base64\"" in l else l)' "$TX" > "$TXT"
BYTES=$(wc -c < "$TXT" | tr -d ' ')
COMMITS=$(git log --oneline <session-start-sha>..HEAD | wc -l)   # session span
# FIRE the parallel deep-pass if Step 1b counted a compaction record AND (BYTES > 3000000 OR COMMITS > 20)
```
Below both bounds, or no compaction record → skip; the inline 1b scan suffices.

⛔ **SCOPE THE SLICE SET TO WHAT IS NEW SINCE THE LAST WRAP**. DERIVE the checkpoint; never ask the operator for a turn-start line. ⛔ **READ `references/checkpoint-derivation.md` BEFORE EDITING ANY FILTER BELOW** — the obvious fixes are the retired forms.
```bash
# Last PRIOR /wrap in THIS transcript; 1 if none.
python3 - "$TXT" <<'CPPY'
import json, re, sys
lines = open(sys.argv[1], encoding='utf-8', errors='replace').readlines()
def rec(l):
    try: return json.loads(l)
    except Exception: return {}
def is_tool_result(r):
    c = (r.get('message') or {}).get('content')
    return isinstance(c, list) and any(
        isinstance(b, dict) and b.get('type') == 'tool_result' for b in c)
BASE_DIR = re.compile(r'"(?:text|content)":"Base directory for this skill: [^"\\]*?/\.claude/skills/([A-Za-z0-9_-]+)(?=\\n|")')
def foreign_spec(l):
    return bool(rec(l).get('isMeta')) and not wrap_injection(l)
WRAP_LOADED = 'Skill /wrap is already loaded above'
def wrap_injection(l):
    r = rec(l)
    if not r.get('isMeta'):
        return False
    m = BASE_DIR.search(l)
    c = (r.get('message') or {}).get('content')
    return bool(m and m.group(1) == 'wrap') or (isinstance(c, str) and c.startswith(WRAP_LOADED))
raw = [i for i, l in enumerate(lines, 1)
       if ('<command-name>/wrap' in l or wrap_injection(l))
       and rec(l).get('type') == 'user'
       and not rec(l).get('isCompactSummary')
       and not is_tool_result(rec(l))
       and not foreign_spec(l)]
marks = [m for k, m in enumerate(raw) if k == 0 or m != raw[k-1] + 1]
typed = [i for i, l in enumerate(lines, 1)
         if '"type":"user"' in l and rec(l).get('promptSource') in ('typed', 'queued', 'suggestion_accepted')]
CUR = marks[-1] if marks else 0   # the CURRENT run's own marker — the SANITY comparand below
marks = marks[:-1]
cmds = [i for i, l in enumerate(lines, 1)
        if '<command-name>' in l and rec(l).get('type') == 'user' and not rec(l).get('isMeta')
        and not rec(l).get('isCompactSummary') and isinstance((rec(l).get('message') or {}).get('content'), str)]
owner_in = sorted(set(typed) | set(cmds))
asst = [i for i, l in enumerate(lines, 1) if '"type":"assistant"' in l and rec(l).get('type') == 'assistant'
        and not rec(l).get('isApiErrorMessage') and (rec(l).get('message') or {}).get('model') != '<synthetic>']
def answered(m):
    nxt = min([t for t in owner_in if t > m] + [len(lines) + 1])
    return any(m < a < nxt for a in asst)
print("ABANDONED", [m for m in marks if not answered(m)])
ok = [m for m in marks if any(t > m for t in typed) and answered(m)]
print("CP", ok[-1] if ok else 1)
print("CUR", CUR)
CPPY
CP=<the CP printed>   CUR=<the CUR printed>
COVERED=.claude/state/deep-pass-covered-${CLAUDE_CODE_SESSION_ID:0:8}; [ -f "$COVERED" ] && CP=$(( $(cut -d' ' -f2 "$COVERED") + 1 ))   # ⛔ FIRST: a COMPLETED pass's record (the pass-return step below) overrides the walk; keep it BELOW every walk `CP=`. SANITY abort with this file present ⇒ read it, do not re-dispatch.
SCAN_BYTES=$(sed -n "${CP},\$p" "$TXT" | wc -c | tr -d ' ')
# ⛔ SANITY — an EXACT comparison, never a threshold; on abort read the marker list and the flags.
[ "$CP" -lt "$CUR" ] || { echo "ABORT — CP=$CP is not below CUR=$CUR: the derivation matched THIS run; re-derive, do NOT dispatch."; exit 1; }
```
**Slice `${CP},$` — not `1,$`.** The TRIGGER still measures the WHOLE `$TXT`; only the SLICE SET is scoped; `$CP` indexes `$TXT`, never the raw `$TX`; the plan line (below) states the scope. ⛔ A FIRST WRAP has `CP=1`: assert `CP` is 1 or a real earlier wrap before trusting it.

⛔ **`$TXT` MUST BE SESSION-SCOPED** (two wraps on one path overwrite each other). TELL: a slice-total that cannot fit the file — cross-check it against `wc -l < "$TXT"` before any coverage claim. ⛔ SUFFIX THE RUN TOO (`…-<sid>-$(date +%s)/`): a plan figure is valid only for the run that cut it. ⛔ THE N SLICE AGENTS SHARE THAT SCRATCHPAD: the brief MUST mandate a slice-unique name (`slice-<first>-<last>-<slot>.jsonl`) and a content-key of the first record's timestamp against the assigned range. ⛔ `$TXT` IS A FROZEN COPY, FOR SLICING ONLY: session-state claims re-read `$TX`.

⛔ **THE SLICE CAP BOUNDS THE INPUT YOU NAME, NOT THE CORPUS A SUBAGENT CAN REACH — FENCE THE CORPUS IN EVERY BRIEF:** the hazard is `~/.claude/projects/` (multi-GB). The fence is NECESSARY, NOT SUFFICIENT, and nothing else bounds the CORPUS:

**Put this in the brief verbatim, every wave:** *"Search ONLY your slice file and the named repo paths. NEVER search `~/.claude/projects/`, `$HOME/.claude`, or any path outside the repo — the transcript store is multi-GB and a regex over it can allocate tens of GB. If a dedup needs transcript evidence, say so and stop; do not widen. FORWARD-ANCHOR every pattern: put a LITERAL first and use a variable-width quantifier on ONE side only — never `.{0,N}(a|b|c).{0,N}`, which is ~4000x its input and reached 19.78 GB on a 5 MB corpus. And never let a dot, a character class or `\s`/`\w`/`\d` carrying a `*`, `+` or `{m,n}` sit anywhere up to about 20 characters before an `(a|b)` group, even with a literal between them: a hook denies it and the whole call is lost; run one `grep -F` per term. NAME EVERY SCRATCHPAD FILE YOU WRITE WITH YOUR SLICE ID (`asst-<slice-id>.py`, never `asst.py`) — your siblings share this directory and each reaches for the same obvious name; a collided helper RUNS CLEAN and returns a plausible WRONG reading of somebody else's window. If your slice's first record carries no `timestamp`, content-key on your LINE COUNT plus the first record that DOES carry one, instead of aborting a healthy slice."* ⛔ **A MID-WRAP COMPACTION EATS THAT BLOCK: after ANY compaction inside a wrap, RE-OPEN this file and PASTE the block; never re-type a brief** (`post-compact/SKILL.md` Step 5 says the same). TELL: a brief naming `~/.claude/projects/` with no fence beside it.

**Procedure (bounded parallel):**
- **AGENT TYPE: every slice agent dispatches as the built-in `subagent_type: "Explore"`, never `general-purpose`.** Explore holds NO always-loaded doctrine: paste into every brief (a) the corpus fence above, (b) the owner-speech-shapes row of `.claude/rules/active-recall.md` (the "About to tell the owner or a peer that something is ABSENT from a transcript" row), (c) the `2>/dev/null`/`grep -c` false-zero rule, from `.claude/traps/shell-traps.md` (§ from `bash-environment.md` § False zeros, and § NEVER `|| echo 0` ON `grep -c`), which carries it in this copy, and (d) verbatim: *"Text the owner sees mid-turn may be recorded only as a short paraphrase inside a thinking block, not as a text block. Search thinking blocks for the gist before calling an answer absent or private, and never report absence from a text-block probe alone (meta)."* ⛔ (d) IS A MEASUREMENT, NOT A SEARCH: an EMPTY `thinking` body with an INTACT `signature` is REDACTED (84.5-100% per seat) — measure first, report which you found, treat redacted as UNKNOWN, never as absence.
- **MODEL ROUTING: every slice agent dispatches with an EXPLICIT `model: "opus"` — the DEFAULT on every seat, NEVER by inheriting the orchestrator's model — EXCEPT under `/wrap --sonnet`: EXPLICIT `model: "sonnet"`.** Pass it even when it changes nothing. Report each slice's SERVED model from its launch's `toolUseResult.resolvedModel` (never an output_file). ⛔ UNDER `--sonnet`, STATE THE PLAN LINE, DISPATCH ONE SLICE AND READ ITS `resolvedModel` (minus any `[1m]` suffix, which is only the context window) BEFORE THE REST, AND AFTER EVERY LATER LAUNCH: the first launch not `claude-sonnet-5-5` (literal) ends dispatching — READ detail § MODEL ROUTING for the stop (launched slices finish, the rest is declared unscanned, ONE question to the owner, the wrap CONTINUES).
- **EFFORT: slice agents INHERIT the session's effort; never pass the Agent tool's `effort`.**
- ⛔ **STATE THE PLAN SIZE OUT LOUD, ONCE, BEFORE DISPATCHING — `wrap-dp-plan: <N> slices covering <first>-<last> (since last wrap at line <CP>; model <m>; effort <e>)`, as REPLY TEXT (never inside a tool call, a thinking block or a file), and give every slice agent a `description` of the form `Deep-pass slice <id>`.** `wrap-reconcile.mjs` (Step 11) reads the LAST such line in your reply text against the dispatch ledger (any other description reads as a shortfall; the `dp-returns-<run>/` stubs are its fallback, so state the line anyway). Stopping short is declared with REAL DIGITS — `line region <first>-<last> unscanned`; a SILENT shortfall is the one option not on the table.
- **SESSION LIMIT, BEFORE EVERY WAVE: run `python3 scripts/deep-pass-wave-budget.py --state <scratchpad>/dp-budget-<run>.json --left <slices not yet dispatched> --cap 12 --ran <slices the last wave actually dispatched>` and dispatch the number after its first word `DISPATCH`** (wave 1 takes the default size unless the limit is already at the line, a later wave what the last wave's per-slice cost says still ends at or below it). On `STOP`: dispatch nothing more, write the undispatched ranges into the working plan, declare them `line region <first>-<last> unscanned`, give the owner the one line it printed.
- **Slice the STRIPPED `$TXT` by BYTES, never the raw `$TX` by lines ** — target ~2 MB per slice → N = ceil(BYTES / 2000000) (NET window-fit) — ×5 (→ 10 MB) under `/wrap --light`, a FLAG, never the default (`wrap/SKILL.md` § Light mode); scope to the last checkpoint FIRST — then CLAMP N to 12 concurrent.
- **⚠️ THE CEILING OF 12 IS A GUARD-RAIL, NOT A BUDGET.** The REAL control is `agent-dispatch-memory-guard.sh` (block-mode; it DENIES past its own `THRESHOLD_GB` — DERIVE IT with `grep -nF 'FF_AGENT_MEMGUARD_THRESHOLD_GB' .claude/hooks/agent-dispatch-memory-guard.sh`, never restate it). The measured runaway was `ugrep`, not the agents; if `.claude/hooks/grep-blowup-warn.sh` (WARN-mode) goes block-mode, retire this clamp.
- **⛔ WHEN THE CLAMP BINDS, DROP COVERAGE — NEVER WIDEN THE SLICE. Hard ceiling 2 MB per agent — ceiling == target, a TRIPWIRE; raise N by one while any slice exceeds it.** Run SEQUENTIAL WAVES over the FULL slice set FIRST — "drop coverage" is the per-WAVE budget, never the TOTAL scope; genuinely unaffordable waves ⇒ declare the residue `line region N–M unscanned`. ⛔ The OOM mechanism is UNPROVEN (three falsified post-mortems, detail § OOM post-mortems): cite none, invent no fourth.
- **⛔ MEASURE THE PASS, DON'T RECONSTRUCT IT:** arm the RSS sampler before each wave and append its END peak (never a mid-wave read) to `.claude/skills/wrap/references/measurement-registry.md` (not in this copy) in the SAME TURN, grepping the ordinal against THAT file first — READ detail § Measure the pass for the command, the kill-by-saved-pid rule and the read discipline. Peak over ~60% of `hw.memsize` ⇒ lower the ceiling and record the number HERE with its date.
- ⛔ **WRITE EACH RETURNING AGENT'S REPORT TO `<scratchpad>/dp-returns-<run>/slice-<NN>.md` ON ARRIVAL, before anything else; the ORCHESTRATOR writes it, under the SAME run token as the slice dir.** ⛔ KEY THE EXTRACTOR ON THE `SubagentHandback` TOOL INPUT, NEVER THE LAST OR LONGEST TEXT BLOCK: the call whose tool result reads `"success":true` in the DECODED `text`, never a re-serialized copy; save each successful delivery in order; no hand-back at all ⇒ detail § Reports. TELL: a saved report far smaller than its siblings; the body after the `range:`/`status:` lines must be byte-identical to the hand-back `message`.
  ⛔ WRITE A STUB AT DISPATCH — EXACTLY `range: <first>-<last>` (digits, stripped-transcript lines) then `status: dispatched`, OVERWRITTEN BY THE REPORT, which keeps `range:` first (absence = never dispatched, a stub = died). ⛔ `dp-returns/` LIVES BESIDE THE SLICE DIR, NEVER INSIDE IT. ⛔ ON A RE-WRAPPED SESSION, STEP 2 READS EVERY `dp-returns-*` AND `dp-topups-*` DIR. TELL: more than one `dp-returns-*` dir.
- **Record the covered range when the LAST slice returns — one line, `<first> <last> <UTC> <N slices>`, to `.claude/state/deep-pass-covered-<sid8>` (overwritten per completed pass):** `RET=<scratchpad>/dp-returns-<run>; TOP=<scratchpad>/dp-topups-<run>; M=<scratchpad>/dp-gate-<run>; rm -rf "$M"; mkdir "$M"; cp "$RET"/slice-*.md "$M"/ 2>/dev/null; for s in "$M"/slice-*.md; do t="$TOP/$(basename "$s" .md)-topup.md"; [ -f "$t" ] || continue; grep -q -F 'status: returned' "$t" || continue; grep -q -i -E '^[[:space:]#*0-9).-]*unscanned regions:[[:space:]*]*none[[:space:]*.]*$' "$t" || continue; ok=1; n=0; while IFS= read -r r; do [ -n "$r" ] || continue; n=$((n+1)); grep -i -E '^[[:space:]*#>-]*range:' "$t" | grep -o -E '[0-9][0-9,]*[[:space:]]*(-|–|—|to)[[:space:]]*[0-9][0-9,]*' | sed -E 's/,//g; s/[[:space:]]*(-|–|—|to)[[:space:]]*/-/' | grep -q -x -F -- "$r" || ok=0; done < <(grep -h -i -F 'unscanned' "$s" | grep -o -E '[0-9][0-9,]*[[:space:]]*(-|–|—|to)[[:space:]]*[0-9][0-9,]*' | sed -E 's/,//g; s/[[:space:]]*(-|–|—|to)[[:space:]]*/-/'); [ "$ok" = 1 ] || continue; [ "$n" -gt 0 ] || grep -q -i -E '^[[:space:]#*0-9).-]*unscanned regions:[[:space:]*]*none[[:space:]*.]*$' "$s" || continue; cp "$t" "$s"; done; [ "$(ls "$RET" | grep -c '^slice-')" -eq "$N" ] && ! grep -q -F 'status: dispatched' "$M"/slice-*.md && [ "$(grep -l -i -E '^[[:space:]#*0-9).-]*unscanned regions:[[:space:]*]*none[[:space:]*.]*$' "$M"/slice-*.md | grep -c '')" -eq "$N" ] && ! { grep -h -i -F 'unscanned' "$M"/slice-*.md | grep -q -E '[0-9][[:space:]]*(-|–|—|to)[[:space:]]*[0-9]'; } && printf '%s %s %s %s\n' "$FIRST" "$LAST" "$(date -u +%FT%TZ)" "$N" > .claude/state/deep-pass-covered-${CLAUDE_CODE_SESSION_ID:0:8}` with the same `<first>`/`<last>`/`<N>` the plan line stated — the four tests ARE the complete-pass gate (one report per planned slice, no dispatch stub left, EVERY report AFFIRMS `Unscanned regions: none` ALONE on its line, no line carrying "unscanned" also carries a digit range in any dash form). Top-up overlay: a slice that declared regions is re-covered by ONE top-up agent for ALL of them, never a subset — READ detail § Covered range before dispatching one (the gate reads its report under `<scratchpad>/dp-topups-<run>/`: `status: returned`, a `range:` line in the slice's own digits, the affirmation; anything less refuses the pass). ⛔ Write it ONLY for a pass whose every planned slice returned; a halted or partial pass leaves the previous file in place.
- **Delete the slice files only after EVERY dispatched slice agent has returned — any replacement AND the agent it replaced** (`rm -rf` the slice dir): count returns per agent id from the task notifications; an agent still out at the wrap's last step ⇒ leave the dir and name the agent in the closing readout. ⛔ VERIFY THROUGH `/private/tmp`, NEVER `/tmp` (a symlink `find` does not follow): delete by GLOB, and only YOUR OWN sid's artifacts.
- Each agent owns ONE line-range with the ANTI-STALL protocol in its prompt: (1) `sed -n 'START,ENDp' "$TXT" > /tmp/wrap-dp-<i>.jsonl` FIRST; (2) NEVER `Read`/`cat` the raw transcript or the whole slice — grep it for owner messages in BOTH SHAPES, `grep -oE '"role":"user"[^]]{0,400}'` AND `grep -F '"type":"queued_command"'` (read `.prompt` where `origin.kind` is `human`), de-dup on the record, plus arc keywords, matched regions only; (2b) EVERY extraction command ends in a HARD cap (`| head -40` / `| head -c 4000`); a region that resists bounded reading is SKIPPED and reported "line region N-M unscanned"; "partial + honest beats complete + stalled" goes in the prompt verbatim; (3) return STRUCTURED missed lessons / decisions (verbatim owner quotes — NEVER invent) + an explicit "nothing new", and END with `Unscanned regions: none` ALONE on its line when every line was read — any depth caveat on the line BEFORE it. A stalled slice: resume it with tighter bounds before re-slicing (detail § The slice protocol).
- Inject the ALREADY-CAPTURED set into EVERY agent's prompt (this session's L#s + DECISIONS + expert-memory writes) so agents surface only GAPS.
- ⛔ **A MID-WRAP COMPACTION DESTROYS THE SLICE REPORTS; THE DURABLE COPY IS THE TASK NOTIFICATION'S `outputFile`.** Use the key's VALUE, never a built path. Record every `outputFile` path BEFORE persisting findings; after a mid-wrap compaction read those files, never re-dispatch. The report inside is the `SubagentHandback` tool input; `Read` the specific report, never `cat`/`tail` the task JSONL.
- **The orchestrator VERIFIES every load-bearing finding ITSELF before persisting.** ⛔ The dominant false positive is "NO DURABLE HOME" (1 in 4 refuted on re-derivation): re-derive with a POSITIVE CONTROL and grep the CLAIM; re-derive at the SOURCE when a slice refutes something you shipped. Then persist confirmed gaps (missed L#, decision, defer), codify confirmed lessons.
