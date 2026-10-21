#!/usr/bin/env bash
# SessionStart hook — resume advisory + marker GC.
# Non-blocking: ALWAYS exit 0. On `resume`/`startup`, if this session already
# /wrapped, advise that we're REOPENING (kills the 2-5x re-wrap loop). The GC in
# `cmd_gate` deletes marker FILES older than GC_DAYS — housekeeping, not inference.
# ⛔ THIS HEADER ONCE SAID "crash-recovery sweep". That sweep INFERRED an
# exit from elapsed time and was removed; nothing here resolves a
# crashed session's status any more, and /exit fires no SessionEnd at all, so such a
# session reads ACTIVE indefinitely by design. Four other dead pointers to the
# removed mechanism were found; this was a fifth, in a wired hook.
# Stdin JSON shape: { session_id, source, hook_event_name, cwd, ... }
set -uo pipefail
INPUT="$(cat 2>/dev/null || true)"
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  SRC=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  SRC=$(printf '%s' "$INPUT" | grep -oE '"source"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# Thread the authoritative harness session id (stdin .session_id) into the env so the
# mail-* + prime subprocesses below resolve THIS session's identity even before its jsonl
# hits disk (the SessionStart misroute: a fresh session whose transcript isn't written yet
# resolved to the most-recent PEER and consumed its mail). GUARD against an empty
# $SID: an empty export reads as "absent" and silently reintroduces the peer fallback.
[ -n "$SID" ] && export CLAUDE_CODE_SESSION_ID="$SID"

# Session-start git anchor (enforce-layer infra): stamp HEAD once at the
# FIRST start of this session, so wrap-reconcile.mjs can diff "*MEMORY.md appends
# THIS session" (emitted-vs-persisted completeness) against a stable baseline +
# window the transcript scan to this wrap's segment. Write-once (a resume/compact
# must NOT re-anchor to a later HEAD) — only if the marker is absent.
if [ -n "$SID" ]; then
  _anchor="$DIR/.claude/state/session-start-sha-$SID"
  [ -f "$_anchor" ] || git rev-parse HEAD > "$_anchor" 2>/dev/null || true
fi

python3 "$DIR/scripts/session-lifecycle.py" gate --session "${SID:-}" --source "${SRC:-}" 2>&1 || true

# ── EMIT-ORDER RULE (2026-07-04) ──────────────────────────
# BOUNDED emissions FIRST, UNBOUNDED (mail dump) LAST. When this script's stdout
# exceeds the harness inline cap (~2 KB preview + persisted file), only the FIRST
# ~2 KB reaches agent context. On 2026-07-04 an 11-message mail dump (44 KB) ran
# ahead of the post-compact directive — the directive landed at line 321/345 of
# the persisted file and NEVER entered context (0% effective fire despite the
# "proven-injecting" channel). Directives/primes are a few hundred bytes; the mail
# dump scales with unread count. Order below is load-bearing — do not append new
# emitters after mail-check unless their loss-under-truncation is acceptable.
# NOTE: the "directive lands in the first ~2KB" guarantee is SOFT — the
# lifecycle gate above (2>&1, can emit peer-exit advisories) runs BEFORE this block,
# so it shares the pre-mail budget. Bounded-vs-unbounded is the real invariant.
#
# ── UPDATE 2026-08-14: THE MAIL EMITTER IS NOW BOUNDED, so every clause above calling it
# UNBOUNDED is HISTORICAL. `mail-check --summary` emits a hard-capped constant block
# (SUMMARY_TOTAL_CAP, session-manifest.py), O(1) in the unread count. "Mail last" is kept
# anyway — it is still the largest, least-critical emitter — but the invariant this rule
# actually protects now holds for every emitter here EXCEPT the compact-checkpoint replay
# below (measured p50 1,370 B, max 6,929 B; filed, not fixed in this change).
# WHY IT MATTERED, and it was worse than verbosity: measured on one real start this hook
# emitted 147,083 B of which 2,174 B (1.48%) reached context, the cut landing ON the
# SESSION-MAIL delimiter so ZERO message bytes arrived — while all 48 read-receipts were
# written anyway. The dump was CONSUMING mail it provably never delivered.

# Post-compact recovery: /post-compact directive + checkpoint replay
# (relocated here from the retired compact-restore.sh 2026-07-03; renamed from
# "postmortem" + moved AHEAD of the mail dump 2026-07-04). The PostCompact
# EVENT's output is AGENT-INVISIBLE — zero `"hookName":"PostCompact"` attachments
# exist in ANY session transcript (the 2026-07-01 "verified firing" corroboration
# grep matched only its own investigation's echoes — reading the hook file writes
# its strings into the transcript). SessionStart fires with source=compact on BOTH
# auto- and manual compaction, and THIS script's stdout provably injects — so the
# agent-facing compact-recovery emissions live HERE, at the TOP of the emission
# order. compact-save.sh (PreCompact, a disk WRITER — works regardless of channel
# visibility) still writes the checkpoint this block replays.
if [ "${SRC:-}" = "compact" ]; then
  echo ""
  echo "🧠 POST-COMPACT RECOVERY — run \`/post-compact\` IMMEDIATELY: this turn's FIRST action, BEFORE any other work."
  echo "   (umbrella subject + last exchanges + hand-off state + a session-mail store sweep.) Recovery DECAYS with delay."
  echo "   ⛔ An owner instruction arriving on this same turn does NOT defer it — the recovery is READ-ONLY and costs one turn:"
  echo "   run it FIRST, then answer them. \"Their request is small / I'll surface it after\" is the measured failure, not an exception."
  echo "   Skip ONLY after an owner-curated \`/compact <focus>\` — and NAME the skip decision either way."
  # THIS session's own checkpoint file — compact-save.sh writes one per session since 2026-09-07.
  # The shared compact-checkpoint.md is a
  # SPECTATOR log and is not read here: replaying its last block showed a peer worktree's
  # branch/HEAD/cwd as ours (2026-09-07), and picking "our newest block" out of 2.46 MB / 1,464
  # blocks needed labels, a fallback and an empty-stamp guard — all deleted with the picker.
  # COMPACT_STATE_DIR mirrors compact-save.sh's override so the smoke suite drives this against
  # a scratch state dir.
  sid8="${SID%%-*}"
  own_ckpt="${COMPACT_STATE_DIR:-$DIR/.claude/state}/compact-checkpoint-${sid8}.md"
  # ⛔ The sid guard is LOAD-BEARING, not belt-and-braces (my commit message said otherwise;
  # it was measured): a dash-leading sid collapses `${SID%%-*}` to "", and without the
  # guard a sid-less reader opens `compact-checkpoint-.md` — another session's block under a
  # "THIS session's ()" banner if the writer ever produced that file.
  if [ -n "$sid8" ] && [ -s "$own_ckpt" ]; then
    # Last block of OUR file. The ```-fenced `git log --oneline -10` snapshot is 81% of a block's
    # bytes and is labelled by its writer "SHARED BRANCH … NOT this session's work" — dropped on
    # the read side, replaced by one line naming the command.
    ckpt_body=$(awk '
      /^## [0-9]{4}-[0-9]{2}-[0-9]{2}/ { block = $0 "\n"; in_block = 1; fence = 0; next }
      in_block && /^---$/ { last = block; block = ""; in_block = 0; next }
      in_block && /^```/ { fence = !fence; if (fence) block = block "  (git log snapshot omitted — shared branch, not this session; run `git log --oneline -10`)\n"; next }
      in_block && fence { next }
      in_block { block = block $0 "\n" }
      END { if (last != "") print last }
    ' "$own_ckpt" 2>/dev/null)
    if [ -n "$ckpt_body" ]; then
      echo ""
      echo "🔄 Last pre-compaction checkpoint (compact-save.sh) — THIS session's (${sid8}), from its own file:"
      printf '%s\n' "$ckpt_body" | sed 's/^/     /'
    else
      # The file exists but holds no terminated block — a torn write, or a header-only file.
      # Fail LOUD on the one turn this channel exists for. The shared log holds the same blocks.
      echo ""
      echo "🔄 This session's checkpoint file exists but holds no complete block (${own_ckpt}) — a torn write. The shared compact-checkpoint.md carries the same blocks: grep -n '^- session: ${sid8}' .claude/state/compact-checkpoint.md"
    fi
  else
    echo ""
    echo "🔄 No pre-compaction checkpoint file for this session (${sid8:-<unknown sid>}) — its compactions predate the per-session file (2026-09-07) or none happened. The shared compact-checkpoint.md is a spectator log: never read its last block as yours."
  fi
fi

# Mail-listen at session start (standing directive — 2026-06-22 experiment, GRADUATED
# 2026-07-19 on measured data: 89% of mail marked read + 160 surfaced-live receipts + 0.6%
# addressable gap over the full post-instrument window). A shell hook CANNOT arm the Monitor tool
# (an agent-turn primitive), so it DIRECTS the agent to arm it on turn 1.
#
# ARM ONLY IF NO LIVE LISTENER EXISTS FOR THIS SESSION (2026-07-16 leak fix). The prior guard
# skipped only `compact`; a RECONNECT fires source=resume and re-armed a DUPLICATE — and the
# listeners are persistent + had no teardown, so they accumulated (7 machine-wide, measured).
# Check the session-keyed PID file instead of the source: a LIVE listener (pid answers kill -0)
# → skip; a stale (dead pid) or absent one → clean + arm. Source-agnostic, and correct for both
# reconnect (alive → skip) and resume-from-exit (dead → re-arm). Teardown is the SessionEnd hook.
ML_ARM=1
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)   # match python current_sid() .lower()[:8] + the sibling arm hooks (project-wide key convention)
# Band-O dose reset (2026-08-14): delete this
# session's Band-O injection state at EVERY SessionStart (startup|resume|clear|compact) so
# band-o-inject.sh's next emission is FULL — a fresh context window/epoch never opens on a
# digest. Fail direction is already safe (absent state => FULL), this line just makes the
# epoch reset structural instead of heartbeat-eventual. Aging cleanup mirrors the
# post-compact-pending sweep above it in spirit: state older than 48h belongs to dead sessions.
[ -n "$SID8" ] && rm -f "$DIR/.claude/state/band-o-state-${SID8}.json" 2>/dev/null || true
find "$DIR/.claude/state" -maxdepth 1 -name 'band-o-state-*.json' -mmin +2880 -delete 2>/dev/null || true
# Commit-doctrine epoch reset (2026-09-09): compaction wipes the
# event-delivered commit doctrine from the context, so drop this session's per-part markers on source=compact — and on
# source=clear, which empties the context by construction — and commit-doctrine-inject.sh
# re-delivers on the next commit-shaped call. NOT on resume: a resume keeps the delivered copy (measured) and the
# harness de-duplicates SessionStart output but never PreToolUse output, so a resume reset would land a second 57 KB copy.
# The state dir honours the same override the hook and the smoke suite use; SID8 above is lowercased, and the
# hook lowercases its marker key the same way. The age-out sweeps -part AND the per-session -escape file.
if { [ "${SRC:-}" = "compact" ] || [ "${SRC:-}" = "clear" ]; } && [ -n "$SID8" ]; then
  rm -f "${COMMIT_DOCTRINE_STATE_DIR:-$DIR/.claude/state}/commit-doctrine-${SID8}-part"* 2>/dev/null || true
fi
find "${COMMIT_DOCTRINE_STATE_DIR:-$DIR/.claude/state}" -maxdepth 1 -name 'commit-doctrine-*' -mmin +2880 -delete 2>/dev/null || true
# Per-session checkpoint files age out on the same horizon. THREE guards on the one destructive
# verb this hook has: (1) it reads the same COMPACT_STATE_DIR override
# the writer and reader honour, so the smoke suite can drive it against a scratch dir instead of
# pruning the REAL state dir mid-run (measured happening); (2) `! -name 'compact-checkpoint.md'`
# is inert on this glob and load-bearing the day someone widens it — one `*` wider deletes the
# 2.46 MB shared log with no backup and a green suite; (3) THIS session's own file is excluded
# because `/wrap` 1b COUNTS its blocks (`grep -c '^## 20'`) — recovery would survive a prune
# (PreCompact recreates the file seconds before the read) but that count would read 0 for a
# session idle >48h that compacted three times. `${SID%%-*}`, NOT `$SID8` (`cut -c1-8`): they
# agree on a real UUID and diverge on any other sid shape — the file is named by the former.
find "${COMPACT_STATE_DIR:-$DIR/.claude/state}" -maxdepth 1 -name 'compact-checkpoint-*.md' \
  ! -name 'compact-checkpoint.md' ! -name "compact-checkpoint-${SID%%-*}.md" -mmin +2880 -delete 2>/dev/null || true
ML_PID_FILE="$DIR/.claude/state/mail-listen-${SID8}.pid"
if [ -n "$SID" ] && [ -f "$ML_PID_FILE" ]; then
  ML_PID=$(cat "$ML_PID_FILE" 2>/dev/null)
  # Verify the pid is alive AND is actually a mail-listen (guards PID REUSE — a crashed listener's
  # pid recycled by an unrelated process must NOT read as "still armed" and suppress the listener).
  if [ -n "$ML_PID" ] && kill -0 "$ML_PID" 2>/dev/null && ps -p "$ML_PID" -o command= 2>/dev/null | grep -q 'mail-listen'; then
    ML_ARM=0
  else
    rm -f "$ML_PID_FILE"
  fi
fi
# /standby: a parked seat's listener is disarmed ON PURPOSE — an open session that is parked must
# not wake up on mail turns; it is resumed manually when it is needed. Until this branch existed the
# directive below re-armed every parked seat at its next resume or compaction, silently undoing the
# park. The marker is the state; the owner's next message ends it via standby-resume-check.sh
# (UserPromptSubmit), which owns the re-arm.
STANDBY_MARKER="${FF_STATE_DIR:-$DIR/.claude/state}/session-standby-${SID8}"
if [ -n "$SID8" ] && [ -f "$STANDBY_MARKER" ]; then
  ML_ARM=0
  _sb_since=$(head -c 200 "$STANDBY_MARKER" 2>/dev/null | awk 'NR==1 {print $1}')
  _sb_iso=$( [[ "${_sb_since:-}" =~ ^[0-9]+$ ]] && (date -u -r "$_sb_since" +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d "@$_sb_since" +%Y-%m-%dT%H:%MZ 2>/dev/null) || echo '?')
  echo "⏸ STANDBY: this session was parked by the owner (/standby, since ${_sb_iso}) — its mail listener is DISARMED ON PURPOSE. Do NOT arm it on your own, and do not read the dead listener as a fault. The owner's next message ENDS standby — and so does an owner message THIS compaction cut off (the summary's latest request is the owner's, not a notification's): on that message run \`/standby resume\` (clears the marker peers read, re-arms the listener, reads what arrived, then answers the owner); standby-resume-check.sh re-injects that directive on every prompt until the marker is cleared. Peers see this seat as ⏸ standby and expect no reply from it."
fi
# One session at a time: the settings env block sets this switch, which mail-listen-arm-reminder.sh already reads.
[ "${SKIP_MAIL_LISTEN_ARM_REMINDER:-0}" = "1" ] && ML_ARM=0
if [ "$ML_ARM" = "1" ]; then
  echo "📡 MAIL-LISTEN (standing directive): on your FIRST turn, ARM a persistent inbound-mail listener — call the Monitor tool with timeout_ms:1800000 running 'python3 scripts/session-manifest.py mail-listen --poll 30', and re-arm it on every expiry notice (30 minutes is the tool's cap). Surface-only; apply the on-surface discipline (NAME each inbound, VERIFY its state-claims vs git/tracker before relaying, surface != act). Skip if already armed this session, or in a one-shot/non-interactive run."
fi

# System-resident doctrine staleness line. A session
# launched through scripts/claude-main.sh carries the orchestrator doctrine in its SYSTEM prompt, read ONCE
# at launch (measured: not refreshed by an in-process /compact), and SKIP_ORCHESTRATOR_INJECT=1 silences the
# hook copy. So at every in-process context reset (compact, clear, resume — the hook copy re-delivered on all
# three), name the doctrine files that changed since launch; they must be re-read. Inert for every session not
# launched that way (the variable is unset). A label that is not a commit here is reported, never silent, and
# never reaches git as an option (a value starting "--output=" truncated a file through `git diff`).
if [ "${SRC:-startup}" != "startup" ] && [ -n "${CLAUDE_RESIDENT_DOCTRINE_COMMIT:-}" ]; then
  _rd_c="$CLAUDE_RESIDENT_DOCTRINE_COMMIT"
  if [[ "$_rd_c" =~ ^[0-9a-f]{7,40}$ ]] && git -C "$DIR" cat-file -e "${_rd_c}^{commit}" 2>/dev/null; then
    _rd_changed=$(git -C "$DIR" diff --name-only "$_rd_c" -- \
      .claude/orchestrator/conventions.md .claude/orchestrator/session-doctrine.md 2>/dev/null | tr '\n' ' ')
  else
    _rd_changed="(launch label '${_rd_c:0:12}' is not a commit in this clone, so freshness is UNKNOWN: treat both .claude/orchestrator/{conventions,session-doctrine}.md as changed) "
  fi
  if [ -n "${_rd_changed// /}" ]; then
    echo "📜 DOCTRINE CHANGED SINCE LAUNCH (main session launched by scripts/claude-main.sh; a dispatched sub-agent or a nested claude ignores this line): this session's system prompt holds the orchestrator doctrine as it was at ${_rd_c:0:9}; these files have changed since: ${_rd_changed}— Read them now (the working tree is current), and relaunch through scripts/claude-main.sh at a natural break to refresh the cached copy."
  fi
fi

# Keep-warm arm directive (on once the keep-warm-enabled switch file exists). Same shape as mail-listen: a shell hook cannot call
# CronCreate, so it directs and the agent arms. ⛔ EMITTED ONLY WHILE THE GATE IS WIRED: an armed timer
# with no gate in settings.json turns every timer fire into a full paid turn, so the directive keys on
# the gate's own entry, never on this file existing. Not on /standby (the park owns the seat) and not after
# /keep-warm off. Every SessionStart (startup, resume, clear, compact) re-emits it; /keep-warm on is
# idempotent (it never arms a second job). ⛔ AND ONLY ONCE THE FLEET SWITCH IS ON: until
# .claude/state/keep-warm-enabled exists, only a PILOT session (keep-warm-pilot-<sid8>) is directed — the
# cost of a BLOCKED timer tick is proven for a typed prompt only, so one session's first idle hour is read
# before every session arms.
KW_STATE="${FF_STATE_DIR:-$DIR/.claude/state}"
# GC: a passed ping's turn marker lives one tick. One left by a session that died mid-ping keeps
# keep-warm-tool-deny.sh off its fast path for every tool call fleet-wide; past its 30-minute TTL it is dead.
find "$KW_STATE" -maxdepth 1 -name 'keep-warm-turn-*' -mmin +30 -delete 2>/dev/null || true
# The gate writes keep-warm-<sid8>.json on every owner prompt in every session; a week-old one is dead.
find "$KW_STATE" -maxdepth 1 -name 'keep-warm-*.json' -mtime +7 -delete 2>/dev/null || true
# An armed marker past a recurring job's 7-day auto-expiry is already read as absent by keep-warm-arm-reminder.sh;
# one left by a session that never fired SessionEnd (a crash, a closed terminal) would otherwise stay forever.
find "$KW_STATE" -maxdepth 1 -name 'keep-warm-armed-*' -mtime +7 -delete 2>/dev/null || true
# WIRED = the gate under UserPromptSubmit AND the tool block under an all-tools PreToolUse matcher, read from the
# parsed JSON: a bare substring also matched a permissions rule, the wrong event, and the gate without its tool
# block (all three measured emitting). The skill must exist too: the directive points
# at its timer prompt. Cheap file tests run first, so python starts only once a switch or pilot marker exists.
_kw_wired() {
  python3 - "$DIR/.claude/settings.json" <<'PY' 2>/dev/null
import json, sys
try:
    h = json.load(open(sys.argv[1])).get('hooks') or {}
    def has(ev, name, all_tools=False):
        return any(name in str(x.get('command') or '') for b in (h.get(ev) or [])
                   if not all_tools or (b.get('matcher') or '') in ('', '*', '.*') for x in (b.get('hooks') or []))
    sys.exit(0 if has('UserPromptSubmit', 'keep-warm-gate.py') and has('PreToolUse', 'keep-warm-tool-deny.sh', True) else 1)
except Exception:
    sys.exit(1)
PY
}
# The armed marker (keep-warm-armed-marker.sh) silences keep-warm-arm-reminder.sh. A startup has no timer. A
# resume RESTORES unexpired CronCreate jobs (Claude Code docs, "Scheduled tasks" → Limitations) but an expired
# one is gone, and a reconnect also fires source=resume; this hook cannot tell which, so drop the marker and let
# the reminder ask once — the skill's step 3 re-touches it when the job came back. A compact keeps the session
# id and its jobs, so the marker stays; a clear opens a NEW session id, whose marker never existed.
case "${SRC:-}" in
  startup|resume) [ -n "$SID8" ] && rm -f "$KW_STATE/keep-warm-armed-${SID8}" ;;
esac
if [ -n "$SID8" ] && [ ! -f "$KW_STATE/session-standby-${SID8}" ] && [ ! -f "$KW_STATE/keep-warm-off-${SID8}" ] \
   && { [ -f "$KW_STATE/keep-warm-enabled" ] || [ -f "$KW_STATE/keep-warm-pilot-${SID8}" ]; } \
   && [ -f "$DIR/.claude/skills/keep-warm/SKILL.md" ] && _kw_wired; then
  echo "🔥 KEEP-WARM (standing directive): on your FIRST turn, run \`/keep-warm on\` — CronList, and only if no job's prompt starts '[keep-warm]', CronCreate recurring '7,22,37,52 * * * *' with the exact prompt in .claude/skills/keep-warm/SKILL.md. The keep-warm gate blocks every fire that is not due, at zero cost. Skip in a one-shot/non-interactive run."
fi

# Working-plan directive: the plan is created automatically on the session's first message, by the
# same mechanism as the mail listener (the first-durable-write deviation below failed its first live
# test). Same SHAPE as the listener above — the hook DIRECTS, the agent acts — because the plan needs
# the session's own judgement about what to write, and a hook-scaffolded stub would be content-free.
# ⛔ THE TRIGGER IS THE FIRST MESSAGE. The per-turn nag that makes the listener directive reliable
# is working-plan-reminder.sh (UserPromptSubmit): it re-injects until the plan file
# exists. An earlier version read "first durable write" on a ~167-empty-files argument that assumed a
# hook-WRITTEN stub — with the AGENT writing the file there is no empty file to mint — and that
# deviation was never ratified. The placement is the first message — do NOT cite a
# coverage percentage here: the ~3% once quoted divided by transcripts that predate the directive.
# If a plan already exists for this session it is announced instead — that is the post-compaction
# re-read path.
# Resolve the plan the way scripts/summary-plan-sync.mjs's findPlan does: sort the names and take the
# LAST. A `head -1` here (until 2026-10-12) named the FIRST, which on both sessions holding more than
# one plan file was a stale fragment (`…-blocks-<date>.md` sorts before `….md`: hyphen before dot), so
# the post-compaction re-read path pointed at the wrong file.
# LC_ALL=C = byte order = JS default sort.
WP_FILE=$(ls "$DIR"/plans/session-"${SID8}"-*.md 2>/dev/null | LC_ALL=C sort | tail -1)
if [ -n "$SID8" ] && [ -n "$WP_FILE" ]; then
  echo "📋 WORKING PLAN (exists): ${WP_FILE#$DIR/} — it is the re-read path after a compaction and the source /wrap reads its closability verdict FROM. Update it AT the state change, not at the next commit; corrections REPLACE the text they correct."
elif [ -n "$SID8" ] && [ "$SRC" = "compact" ]; then
  # A COMPACTION with no plan file means the first-message directive (and its per-turn nag) was
  # missed for the whole pre-compaction span, so whatever the session held is only in the
  # summary now — the session a compaction hurts most. Unconditional create-now arm.
  echo "📋 WORKING PLAN (compaction, none exists — create it NOW): this session just compacted with no plan file, so whatever it was holding is only in the summary. Open plans/session-${SID8}-\$(date +%Y-%m-%d).md THIS turn — live items, the closability block, the REVIEW LEDGER (reviewed / pending / NOT SENT per work unit) — reconstructing from /post-compact rather than from recall. It is the re-read path for every compaction after this one."
elif [ -n "$SID8" ]; then
  echo "📋 WORKING PLAN (standing directive): on your FIRST turn — before the user's task, exactly like the mail-listener — open plans/session-${SID8}-\$(date +%Y-%m-%d).md: the arc, the live item table, the REVIEW LEDGER (reviewed / pending / NOT SENT per work unit), and the closability block. Update it at every state change thereafter, including events you did not author. working-plan-reminder.sh re-injects this every turn until the file exists. Skip only in a genuine one-shot / non-interactive run (SKIP_WORKING_PLAN_REMINDER=1 in the LAUNCH environment — a session export cannot reach a hook)."
fi

# Recurring-blindspot prime (dynamic, ranked) — load the top firing owner-pushback
# patterns into context at session start so they prime composition. WITHOUT this the
# prime only fired on an explicit /orient or /meta prime (the "session-start priming"
# label was aspirational until 2026-06-09). Read-only; degrades silently (no rows /
# PRIME_UNAVAILABLE → no output) when the registry is absent/empty. Single render
# source = meta-corrections-scan.py PRIME_COUNTER_ACTIONS (shared with /orient Step 9).
# --window 14: rank on the RECENT window, not all-time share — the all-time ranking provably
# inverted (under-justification 40%→18% receding vs preference-violation 7%→25% rising,
# measured 2026-07-02); all-time stays visible in [brackets].
python3 "$DIR/scripts/meta-corrections-scan.py" --prime --render --window 14 2>/dev/null || true

# Review-hub PULL discovery (2026-07-08): surface any LIVE review-hub so a freshly-booted peer
# finds it WITHOUT depending on the staleable 48h push broadcast (unread-mail TTL is 72h, so a
# long-lived hub's ORIGINAL "I'm the hub" announcement is gone for any peer that booted since).
# BOUNDED (a few lines) → before the unbounded mail dump per
# EMIT-ORDER. Read-mostly (GCs only >72h dead markers). Degrades silently. Complement: the hub
# arms the 48h PUSH via `mail-listen --rebroadcast-hours 48` + stamps review-hub-active-<sid>
# (see .claude/skills/review-hub/SKILL.md Phase 1/2).
python3 "$DIR/scripts/session-manifest.py" hub-discover 2>/dev/null || true

# Manifest hygiene: prune peer manifests whose session has been idle >24h. This
# previously ran ONLY on /orient, so active-sessions/ accumulated dead-session
# manifests and the overlap gate's manifest channel defended against long-gone
# peers. Running it on every session start makes cleanup reliable. NON-DESTRUCTIVE:
# manifests are a derived cache, re-buildable from the session jsonl via
# `session-manifest.py write --session <sid>`; durable history lives in git +
# /wrap + session-memory + the jsonl transcript, never in the manifest.
python3 "$DIR/scripts/session-manifest.py" prune 2>/dev/null || true

# ── Drift sentinels (session-start; moved from /orient Steps 5b-5c) ──
# The 2 FAST (~0.06s each), local, read-only drift checks that previously fired ONLY on /orient —
# so a session that skipped the ~5-min /orient never saw them. BOUNDED (a summary line each) +
# SILENT when clean; warn-mode (never blocks; degrades silently if node/a script is absent).
# Full detail stays in /orient 5b-5c. The 3rd sentinel (i18n-prose-drift) is DELIBERATELY NOT
# here: it is ~6s (git-blames 12 bundles of 4,812 leaf keys, 4,811 of them reachable by its
# scanner) + a 1,322-candidate standing backlog with low per-session delta — too slow + noisy
# for an every-session hook; it stays on /orient Step 5d. (Re-measured 2026-09-22 after the
# scanner's same-line-object fix: it read "3.5s / ~1200 keys / ~1200 candidates" from the era
# when the scanner reached only 487 keys, so both the cost and the backlog were
# understated — the cost argument holds a fortiori.)
# Before the unbounded mail dump per the EMIT-ORDER RULE above.
_drift=""
# Latent guards (2026-07-19):
#  · alarm-3 wrapper on each node call — the sentinels measure ~0.06s today, but an
#    unguarded runtime regression would tax EVERY session start (the exact multi-second
#    concern that excluded i18n-prose from this hook). No macOS `timeout` → perl alarm; the
#    pending SIGALRM survives execve so the exec'd node inherits the deadline. A killed
#    sentinel degrades silently (warn-mode) under the existing `|| true` + 2>/dev/null.
#  · _cap220 — the old `head -c 220` cuts BYTES and can slice a multibyte UTF-8 glyph
#    mid-codepoint (tail mojibake once output stops being pure ASCII); perl -CSD substr
#    counts CHARACTERS. Falls back to the old byte cap only if perl is absent.
#    ⚠ Both cap branches assume ONE-line input (the upstream `tr '\n' ' '`): perl -p caps
#    PER LINE while head -c caps the STREAM — they diverge on multi-line input, so keep
#    the tr if you edit the call sites.
if command -v perl >/dev/null 2>&1; then
  _cap220() { perl -CSD -pe '$_ = substr($_, 0, 220)' 2>/dev/null; }
  _sentinel() { perl -e 'alarm 3; exec @ARGV' "$@"; }
else
  _cap220() { head -c 220; }
  _sentinel() { "$@"; }
fi
# Greps anchored to each script's FINDING VOCABULARY:
#  · audit-tier — anchors the TOTAL line (no bare '.*: [1-9]' FP) + KEEPS the BLIND/vacuous state
#    ('vacuous pass', the audit-tier script's deliberate BLIND≠CLEAN signal — the net-hole)
#    + drops the bare 'UN-BACKFILLED' token (it matched the BENIGN ops line; a real un-backfilled
#    finding is still counted in TOTAL, so it's still caught — drop-safe). NOTE: 'vacuous pass' not
#    '0 rows scanned' — the latter substring-matches a clean "(40 rows scanned)" line.
#  · surface-register — POSITIVE finding-shape, not a negative '-viE agree|✓' filter: the script
#    NAME 'surface-register-drift' made a bare 'DRIFT' match its OWN clean line, so the old filter
#    was the only thing suppressing it (fragile — a reworded clean line would spam every session).
_at=$(_sentinel node "$DIR/scripts/audit-tier-drift-check.mjs" 2>/dev/null | grep -iE 'TOTAL flows\+features drift findings: [1-9]|[1-9][0-9]* drift finding|vacuous pass' | head -3 || true)
[ -n "$_at" ] && _drift="${_drift}  · audit-tier: $(printf '%s' "$_at" | tr '\n' ' ' | _cap220)"$'\n'
_sr=$(_sentinel node "$DIR/scripts/surface-register-drift.mjs" 2>/dev/null | grep -E 'finding\(s\)|✗ DRIFT|NO-SSOT|NOT-IN-MATRIX' | head -3 || true)
[ -n "$_sr" ] && _drift="${_drift}  · surface-register: $(printf '%s' "$_sr" | tr '\n' ' ' | _cap220)"$'\n'
if [ -n "$_drift" ]; then
  echo ""
  echo "🔎 DRIFT SENTINELS (session-start; full detail + the i18n-prose sentinel via /orient 5b-5d):"
  printf '%s' "$_drift"
fi

# ── Warn-only hooks failing through run-advisory.sh ──
# A warn-only hook wired through .claude/hooks/lib/run-advisory.sh that exits 2 (a syntax error, or a
# deliberate block it should not have) is let through as a non-blocking error, and Claude Code draws a
# Stop hook's error nowhere, so a broken reminder could go unseen for days. The launcher keeps one marker
# per failing hook, cleared by that hook's next clean run (a syntax error: once its file parses again); this
# names each one at every session start, at most 8 lines, then a count of the rest.
_ra=$(bash "$DIR/.claude/hooks/lib/run-advisory.sh" --list 2>/dev/null || true)
if [ -n "$_ra" ]; then
  echo ""
  echo "🪝 WARN-ONLY HOOK FAILING (run-advisory.sh let it through as a non-blocking error; it is listed here until its next clean run, or for a syntax error until its file parses):"
  printf '%s\n' "$_ra" | head -8 | sed 's/^/  · /'
  _ran=$(printf '%s\n' "$_ra" | grep -c .)
  if [ "$_ran" -gt 8 ]; then echo "  · …and $((_ran - 8)) more: bash .claude/hooks/lib/run-advisory.sh --list"; fi
fi

# ── First-turn context-echo watch (placed where it cannot be missed) ──
# Five sessions opened by emitting a FABRICATED Band-O rules document as their first reply
# instead of running the typed command. Fix shipped (the band file's header
# named the split marker; the hook strips the real one, so the header was the only in-window
# source). It is a HYPOTHESIS: date and CLI version are the same variable in this corpus by
# construction (0 off-diagonal across 148 sessions), so no observational partition
# separates them and the intervention is the only experiment available.
#
# WHY IT IS WIRED HERE rather than left as a tracker row. The natural home was an
# `exit-zero` trigger — but exit-zero is OPT-IN (`--run-exit-zero`) and NOTHING in this repo
# passes that flag, so the row would have been counted-and-never-executed: a decorated never.
# This costs 0.27s, is SILENT unless there is news, and lands where the owner reads.
# BOUNDED (2 lines) + before the mail dump per the EMIT-ORDER RULE above.
#
# FIRES ON TWO OPPOSITE READINGS, both worth interrupting for (scripts/band-o-echo-scan.py
# check_verdict, controlled at its boundaries in --self-test):
#   RECURRENCE  a post-fix session rendered a marker => hypothesis REFUTED, re-open at framing
#   CLEAN BAR   >=7 post-fix sessions, none rendered => first falsification rung cleared
# Anything between is "still accumulating", which is not news and stays silent — a watch that
# speaks while nothing has happened is one the reader learns to skip.
_echo_watch="$(perl -e 'alarm 5; exec @ARGV' -- \
  python3 "$DIR/scripts/band-o-echo-scan.py" --check 2>/dev/null)" && {
  echo ""
  echo "🔁 FIRST-TURN ECHO WATCH — $_echo_watch"
  echo "   · detail: python3 scripts/band-o-echo-scan.py"
}
true

# Cross-session mail (deliver-and-surface handoffs): GC
# read+ancient mail, then surface unread handoffs for THIS session as ADVISORY DATA
# — wrapped + authority-demoted, NEVER auto-applied. Both degrade silently + always exit 0 inside the script.
# mail-check resolves the current session via CLAUDE_CODE_SESSION_ID (own_session_path),
# not the stdin SID; its stdout reaches context (same channel as the prime above).
# BOUNDED since 2026-08-14 (was UNBOUNDED — it scaled with unread count and once emitted
# 147,083 B, of which 1.48% reached context). Kept LAST anyway per the EMIT-ORDER RULE:
# it is still the largest emitter, and ordering costs nothing now that it is capped.
python3 "$DIR/scripts/session-manifest.py" mail-prune 2>/dev/null || true
# ⛔ FALLBACK CHAIN, NOT A BARE SWAP — this is the whole safety of the change.
# argparse rejects an unknown flag with rc=2 BEFORE dispatch, emitting zero
# stdout and a usage line that `2>/dev/null` eats and `|| true` swallows. Measured on the
# pre-change tree: `mail-check --summary` -> rc=2, 0 bytes, silent. So if this hook lands
# and the python side does not — a partial checkout, a one-file revert, a peer's
# `git checkout -- scripts/` — a bare swap takes EVERY SEAT'S MAIL DARK with no signal.
# The second arm degrades to the PREVIOUS behaviour instead of to silence. It is safe to
# chain because the failed arm exits before cmd_mail_check runs, so nothing is consumed.
python3 "$DIR/scripts/session-manifest.py" mail-check --summary 2>/dev/null \
  || python3 "$DIR/scripts/session-manifest.py" mail-check 2>/dev/null || true

exit 0
