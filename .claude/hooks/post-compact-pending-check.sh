#!/usr/bin/env bash
# UserPromptSubmit hook — post-compact pending-marker reader (occ-2, layer 2; 2026-07-04).
#
# WHY: the post-compact recovery directive has now silently failed through TWO channels
# (PostCompact = agent-invisible; SessionStart:compact = truncated behind a 44KB
# mail dump, occ-2). Both were ONE-SHOT injections — miss the shot, lose the
# recovery, and nothing measures the miss. This hook is the persistent net:
#   - compact-save.sh (PreCompact, disk writer — works regardless of channel visibility)
#     writes .claude/state/post-compact-pending-<session_id> at every compaction.
#   - THIS hook (UserPromptSubmit stdout provably injects — trigger-index-match.sh
#     precedent) re-surfaces the marker on EVERY prompt until it is cleared.
#   - /post-compact (run OR named-skip) clears the marker; the reminder text
#     carries the rm command so the action is self-sufficient.
#   - An uncleared marker = MEASURABLE evidence of a missed recovery (age visible in
#     the marker content) — the fire-rate telemetry the directive-only design lacked.
#
# MODE: ADVISORY (warn-mode) — always exit 0, never blocks the prompt.
# Prevents the occ-2 class: post-compact recovery directive lost in transit.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

INPUT="$(cat 2>/dev/null || true)"
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  TX=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  TX=$(printf '%s' "$INPUT" | grep -oE '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi
[ -z "${SID:-}" ] && exit 0
# SID shape guard (security DiD): the SID interpolates into a filename and
# into the rm command surfaced to the agent — reject anything outside [A-Za-z0-9_-].
[[ "$SID" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 0

# COMPACT_STATE_DIR override exists for the smoke suite (side-effect-free runs).
state_dir="${COMPACT_STATE_DIR:-$ROOT/.claude/state}"
marker="$state_dir/post-compact-pending-$SID"

# GC: markers of dead/abandoned sessions older than 48h (2880 min) — silent, cheap.
# NEVER reaps the CURRENT session's own marker: marker
# mtime = compaction time and is never refreshed, so a LIVE multi-day session that
# compacted >48h ago would otherwise lose its own pending reminder — breaking the
# "persistent until cleared" invariant this layer exists for.
# (the 48 h sweep for this file family runs in the shared loop below)
# ⛔ THE CLEARED BREADCRUMB NEEDS ITS OWN SWEEP — no existing glob reaches it. Every sweep in
# the estate matches `*.jsonl` / `agent-*` / `band-o-state-*` / `post-compact-pending-*`, and
# `post-compact-cleared-*` matches none of them, so it accumulated one file per recovered
# session forever (4 were live when this was added). Same 48h and the same never-reap-my-own
# carve as the line above, for the same reason: /wrap Step 0 reads THIS session's breadcrumb to
# tell "a recovery ran here" from "no compaction ever", so reaping it mid-session would restore
# the exact ambiguity it was introduced to remove.
# (the 48 h sweep for this file family runs in the shared loop below)
# The DEFERRED breadcrumb (`post-compact-deferral.py decide`) takes the same sweep and the same carve-out —
# it matched no glob either, one file per deferred session forever.
# ⛔ A WAITING SESSION KEEPS ITS NET HOWEVER LONG IT SLEEPS. A peer that
# is idle past 48 h with a DEFERRED marker (the hook fired early, no compaction landed yet) is not dead: when it
# resumes, the compaction applies, and if its marker, floor and breadcrumb were reaped meanwhile the
# boundary lands with no marker and the recovery is never directed. So none of a peer's three files is
# reaped while that peer's deferral breadcrumb is under 30 days old; past that the session is treated
# as abandoned and all three go. Own files are never reaped, as before.
_pc_waiting() { local b="$state_dir/post-compact-deferred-$1"; [ -f "$b" ] && [ -z "$(find "$b" -mmin +43200 2>/dev/null)" ]; }
for _pc_f in "$state_dir"/post-compact-pending-* "$state_dir"/post-compact-cleared-* "$state_dir"/post-compact-deferred-*; do
  [ -e "$_pc_f" ] || continue
  _pc_s=$(basename "$_pc_f"); _pc_s=${_pc_s#post-compact-pending-}; _pc_s=${_pc_s#post-compact-cleared-}; _pc_s=${_pc_s#post-compact-deferred-}
  [ "$_pc_s" = "$SID" ] && continue
  [ -n "$(find "$_pc_f" -mmin +2880 2>/dev/null)" ] || continue
  _pc_waiting "$_pc_s" && continue
  rm -f "$_pc_f" 2>/dev/null || true
done
# LIVENESS FOR THE FILES THE DEFERRAL RULE READS. The cleared file is the rule's FLOOR (recover iff a
# boundary is newer than it), its mtime is the last Step 8 write, and a PEER's sweep above reaps it
# 48 h later — the marker `touch` further down never reaches it. A reaped floor makes the next
# `decide` recover an already-recovered boundary and clear the net early. Refresh on EVERY prompt,
# marker or not (a live session with no marker is exactly the one about to need its floor); `-c`
# creates nothing.
touch -c "$state_dir/post-compact-cleared-$SID" "$state_dir/post-compact-deferred-$SID" 2>/dev/null || true

[ -f "$marker" ] || exit 0

# Fix (b) — refresh mtime on every fire (the own-SID exclusion above only
# protects against SELF-GC; a PEER session's per-prompt GC would still reap a live
# session's >48h marker). A LIVE session prompts → its marker stays fresh → no peer GC
# can age it out; a DEAD session stops prompting → its marker ages → reaped at 48h.
# The compaction TIME stays in the marker CONTENT (compacted=<ts>) — mtime is liveness.
touch "$marker" 2>/dev/null || true

# THE KEEP-WARM TIMER PROMPT IS NOT A TURN THAT CAN RECOVER (2026-10-08). Since
# then keep-warm-gate.py PASSES a ping while the marker comes from an early hook fire with no compaction landed,
# so this demand would land on a turn whose tools keep-warm-tool-deny.sh refuses and whose prompt says to
# ignore it, and its fires row would count a turn that could never act as a missed recovery. The liveness
# touches above still run. Keyed on the timer prompt's FIRST WORDS (the gate's SENTINEL), never the bare
# `[keep-warm]` tag the three advisory hooks use: an owner message that starts with the tag keeps this
# demand, because a recovery is not an advisory.
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"[[:space:]]*\[keep-warm\] automated cache keep-alive' && exit 0

# ⛔ THE READER BOUNDED BYTES WHILE THE WRITER BOUNDS CHARACTERS, AND THE CUT WAS SILENT.
# `compact-save.sh` allows 160 CHARACTERS of focus_args;
# this read 200 BYTES of the whole line, and the fixed prefix (`compacted=… trigger=… focus=…
# focus_args=`) is ~66 of them — so the banner showed ~130 of 160 ASCII characters, and far
# fewer of em-dash prose at 3 bytes each. The failure direction is the expensive one: an
# argument that OPENS as a curation and CLOSES with a directive loses the directive past the
# cut, which is exactly the judgement this field exists to let the reader make. 800 bytes clears
# 160 characters even if every one is multibyte; the marker is one short line, so there is no
# cost to the headroom. And when it DOES truncate, say so rather than trailing off silently.
content=$(head -c 800 "$marker" 2>/dev/null | tr -d '\n' || true)
if [ "$(wc -c < "$marker" 2>/dev/null || echo 0)" -gt 800 ]; then
  content="${content} …[TRUNCATED — read the marker file directly: $marker]"
fi

# Fire-log: the promotion-condition telemetry this
# hook lacked — 8 of 12 promotable hooks were measured writing NO fire-log, leaving
# their warn→block conditions unmeasurable forever. One line per fire; read it, never narrate it.
# SMOKE CHANNEL: suite runs override COMPACT_STATE_DIR, and
# routing their fires into the production log inflated it ~23x (45 of 47 rows were
# fixtures) — the exact log meant to make the warn→block promotion measurable. Keyed
# STRUCTURALLY on the override (the agent-dispatch-memory-guard precedent), never on a
# name-grep a reader has to remember.
if [ -n "${COMPACT_STATE_DIR:-}" ]; then
  fire_log="$ROOT/.claude/logs/post-compact-pending-fires.smoke.jsonl"
else
  fire_log="$ROOT/.claude/logs/post-compact-pending-fires.jsonl"
fi
# ⛔ JSON-ESCAPE AT THE INTERPOLATION POINT. `$content` is the marker line, and since
# 2026-09-09 that line carries `focus_args=<the operator's own text>` — arbitrary prose typed
# into a `/compact` slot. A single `"` in it closes the JSON string and every `jq` read of this
# log breaks FROM THAT LINE FORWARD. The banner below still renders correctly, so the only
# symptom is a telemetry file that fails exactly when somebody finally needs it.
#
# NOT hypothetical: this repo's own `compact-save.sh` quotes a REAL operator argument
# containing double quotes in its comments, so the first manual `/compact` of that shape
# poisons the file. Measured at the fix: 468 lines, 0 unparseable — latent, one keystroke away.
#
# ⛔ ESCAPE HERE, NOT A SECOND SANITISER IN `compact-save.sh`. The
# writer already strips control bytes and maps `=`; a second stripping layer there would drift
# from this one, and the writer's job is the MARKER's shape, not this consumer's encoding.
# Backslash FIRST then quote — the reverse double-escapes. `$SID` is escaped too: it is read
# from the payload, so it is not this hook's to trust.
_json_esc() { printf '%s' "$1" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# CLAUDE CODE'S PreCompact HOOK CAN FIRE WITH trigger=auto WHILE THE CONTEXT IS STILL UNDER THE COMPACT
# POINT, so this marker stands while no compaction has happened (measured 2026-10-18: this seat at 625,473
# of 727,000 tokens at the fire; fleet since 2026-10-01: 26 of 119 automatic compactions fired 10 min to
# 3.4 h before they applied, 37 of 242 fires had no compaction within 12 h; the summary is computed at the
# apply, so nothing is stale — only the hook is early), and the rule is to wait for the real one: once
# /post-compact Step 1 has looked and deferred, the urgent demand
# below contradicts it. SAY SO ONCE PER EARLY FIRE, THEN STAY SILENT UNTIL THE COMPACTION LANDS (the line
# had been re-injected 784 turns across 106 early fires in two weeks, up to 31 for one): the deferral breadcrumb gains a `said=<marker>` line the first time, and a
# later turn with the same marker logs its row and prints nothing (`decide` rewrites the breadcrumb, so a
# re-run of Step 1 says it once more). `status` re-reads the transcript and goes back to OWED the moment the
# real compaction applies. `transcript_path` comes from the payload so the rule reads THIS session's
# transcript, not a path guessed from a hardcoded project dir; absent, the script falls back to that
# guess, and an unreadable transcript reads OWED (the demand below), never the quiet line.
if python3 "$ROOT/scripts/post-compact-deferral.py" status --sid "$SID" --state-dir "$state_dir" ${TX:+--tx "$TX"} >/dev/null 2>&1; then
  printf '{"ts":"%s","session":"%s","marker":"%s","deferred":true}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(_json_esc "$SID")" "$(_json_esc "$content")" \
    >> "$fire_log" 2>/dev/null || true
  crumb="$state_dir/post-compact-deferred-$SID"
  if [ -f "$crumb" ] && grep -qxF -- "said=$content" "$crumb" 2>/dev/null; then exit 0; fi
  printf 'said=%s\n' "$content" >> "$crumb" 2>/dev/null || true
  fired=$(printf '%s' "$content" | sed -n 's/^compacted=\([0-9][0-9-]* [0-9:]*\) UTC.*/\1/p')
  sl="$state_dir/statusline-${SID:0:8}.json"; ctx=""; cap=""
  if command -v jq >/dev/null 2>&1 && [ -f "$sl" ]; then ctx=$(jq -r '.context_tokens // empty' "$sl" 2>/dev/null); cap=$(jq -r '.compact_threshold // empty' "$sl" 2>/dev/null); fi
  [ -n "$fired" ] || fired="the marker's time"
  trig=$(printf '%s' "$content" | sed -n 's/.*trigger=\([^ ]*\).*/\1/p'); [ -n "$trig" ] || trig="unknown"
  size=""; [ -n "$ctx" ] && [ -n "$cap" ] && size=" — context $ctx of the $cap-token limit"
  echo "🧠 post-compact: Claude Code fired its pre-compaction hook at $fired UTC for a compaction (trigger: $trig) it has not applied${size} — an automatic one fires early under the compact point, a manual /compact can be refused at the session limit; no recovery is owed until one lands, and this line returns as the recovery demand then. Said once; silent on later turns. [$content]"
  exit 0
fi
printf '{"ts":"%s","session":"%s","marker":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(_json_esc "$SID")" "$(_json_esc "$content")" \
  >> "$fire_log" 2>/dev/null || true

echo "🧠 PENDING [$content] — run \`/post-compact\` IMMEDIATELY: this turn's FIRST action, BEFORE any other work. Recovery DECAYS with delay. ⛔ An owner instruction arriving on this same turn does NOT defer it — the recovery is READ-ONLY and costs one turn, so run it FIRST and answer them after; 'their ask is small, I'll surface it afterwards' is the measured failure, not an exception. ⛔ WHILE THIS MARKER STANDS the degraded-memory consequence binds: the continuation summary is an INDEX, not evidence — an owner-facing state claim sourced from it is \`unverified\` until re-derived THIS turn (measured post-compact push-to-error: 4/4, 2026-08-17). ⛔ \`focus=yes\` IS NOT A SKIP GATE — READ \`focus_args\` ON THIS LINE AND JUDGE THE ARGUMENT. The flag records only that the /compact slot was NON-EMPTY; no shell hook can tell a curation of the CUTOFF from a DIRECTIVE typed in the same slot, and measured 2 of 2 in one session the argument was a directive while the flag still said yes. A DIRECTIVE means the skip is NOT eligible: run the recovery. Skip only when \`focus_args\` is genuinely a curation of what to keep — and NAME the decision either way. Then clear the marker: rm '$marker'. This reminder re-fires until cleared, on TYPED prompts AND on listener/notification turns — never read its silence as 'the net is off'."

exit 0
