#!/usr/bin/env bash
# UserPromptSubmit hook — the /standby RESUME net.
#
# WHY: `/standby` parks a session — the owner stops its mail listener so it stops waking on mail
# turns and spending tokens; an open session that is not needed stays quiet until the owner
# resumes it by hand. The state is the marker
# `.claude/state/session-standby-<sid8>` (written by `session-lifecycle.py standby`); peers read it
# as ⏸ standby. NOTHING wakes a parked seat but the owner's next message — and that message is a
# UserPromptSubmit, which is why THIS hook is the wake-up: it re-injects the resume directive on
# every prompt until `/standby resume` clears the marker, the same persistent-net shape as
# post-compact-pending-check.sh (the one-shot SessionStart line can be lost behind a compaction;
# a per-prompt net cannot).
#
# The directive tells the agent the resume steps IN ORDER — clear the marker, read what arrived
# (BEFORE the re-arm: the read consumes, so the re-armed listener does not print the park's queue a
# second time — /standby SKILL step 1b), re-arm the listener (and the keep-warm timer where SKILL step
# 2b applies), THEN answer the owner — and tells it to stay parked if the turn is
# a task/monitor notification rather than the owner (a UserPromptSubmit also fires on those).
#
# MODE: ADVISORY (warn-mode) — always exit 0, never blocks the prompt. Escape for a genuine
# one-shot run: SKIP_STANDBY_RESUME_CHECK=1 in the LAUNCH environment (a session export never
# reaches a harness-spawned hook). FF_STATE_DIR is the same isolation override the lifecycle
# script honours, so the smoke suite never touches the live state dir.
set -u
[[ "${SKIP_STANDBY_RESUME_CHECK:-0}" == "1" ]] && exit 0   # =1 only — a stray =0 must NOT bypass

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # fallback ladder

INPUT="$(cat 2>/dev/null || true)"
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi
[ -z "${SID:-}" ] && exit 0
# Shape guard: the id interpolates into a path and into the text handed to the agent.
[[ "$SID" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 0
# The lifecycle key is the lowercased 8-char prefix (session-lifecycle.py norm_sid / the sibling
# arm hooks), NOT the full id the post-compact marker uses — the marker is written by the python.
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

state_dir="${FF_STATE_DIR:-$ROOT/.claude/state}"
marker="$state_dir/session-standby-$SID8"
# The /pause RESUME-IN-WORDS net shares this hook (one UserPromptSubmit, one JSON document): a
# paused session was resumed in words inside another command (2026-10-09), the pause
# marker stayed and 4 commits landed under it.
pause_marker="$state_dir/session-pause-$SID8"
[ -f "$marker" ] || [ -f "$pause_marker" ] || exit 0

# Marker body is "<epoch> <HEAD-sha>" (epoch first). Tolerate a malformed file: fall back to mtime.
since=$(head -c 200 "$marker" 2>/dev/null | awk 'NR==1 {print $1}')
[[ "${since:-}" =~ ^[0-9]+$ ]] || since=$(stat -f %m "$marker" 2>/dev/null || stat -c %Y "$marker" 2>/dev/null || echo 0)
now=$(date +%s)
parked=$(( now - since )); [ "$parked" -lt 0 ] && parked=0
dur="$(( parked / 3600 ))h $(( (parked % 3600) / 60 ))m"
since_iso=$(date -u -r "$since" +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d "@$since" +%Y-%m-%dT%H:%MZ 2>/dev/null || echo '?')

# WHO IS SPEAKING. The payload carries no promptSource/commandMode (owner and harness turns share
# ONE key set), but the PROMPT VALUE
# separates them, on the anchored prefixes band-o-inject.sh and queued-directive-residue-scan.py
# already key on. An unknown shape stays 'owner' — today's text, the model decides — so a miss
# degrades to the pre-classifier behaviour, never below it. A usage-limit reset CONTINUES the turn
# it cut, so it is neither class: the founding session's own resume turn took exactly that path.
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
else
  PROMPT=$(printf '%s' "$INPUT" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"[^"]*' | head -1 | sed -E 's/^"prompt"[[:space:]]*:[[:space:]]*"//')
fi
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
case "$PROMPT" in
  # '# Autonomous loop' covers the vendor /loop forms ('… check', '… tick', '… tick (dynamic pacing)'
  # in 2.1.292). The older 'check'-only arm classed a tick as the OWNER; measured 2026-10-06: 12 tick
  # prompts reached this hook (session <session-id>, before /standby existed), 0 while parked; 0 of 11,572
  # owner-sourced transcript records open with any arm below. '[keep-warm]' is the keep-alive ping.
  # '[Owner-authorized' is an /autorun one-shot the OWNER armed, so it ENDS the park like the owner's own
  # message — it formerly sat in the harness arm, which is why a park under a GO could not be
  # woken by a timer.
  '[Owner-authorized'*) kind=autorun ;;
  '<task-notification>'*|'<cross-session-message'*|'<agent-message'*|'# Autonomous loop'*|'[keep-warm]'*) kind=harness ;;
  'Your claude.ai usage limit'*) kind=continuation ;;
  *) kind=owner ;;
esac
# A parked REVIEW HUB re-arms what review-hub/SKILL.md Phase 2 arms, not the bare listener — that
# spec loads once per role-lifetime, so the correction has to ride the directive that fires.
arm="python3 scripts/session-manifest.py mail-listen --poll 30"; hub_extra=""
if [ -f "$state_dir/review-hub-active-$SID8" ] && [ ! -f "$state_dir/review-hub-active-$SID8.retiring" ]; then
  arm="$arm --rebroadcast-hours 48"
  hub_extra=", and — you are the REVIEW HUB — the staleness poller as a SECOND Monitor, also timeout_ms:1800000, with this session's newest poller arm command, its filters included (/pre-compact Step 1 shows how to read it), else Phase 1's loop (\`while true; do bash scripts/hub-stale-request-poll.sh 2>&1; sleep 600; done\`)"
fi
# One session at a time: SKIP_MAIL_LISTEN_ARM_REMINDER=1 (=1 only, as session-start.sh reads it) switches the
# listener off and /standby resume step 2 then skips the re-arm, so the directive must not order one.
step2="re-arm the inbound-mail listener — Monitor tool, timeout_ms:1800000, running \`${arm}\`${hub_extra}"
step2_main="${step2}, re-armed on every expiry notice"; step2_short="re-arm \`${arm}\`${hub_extra}"
if [ "${SKIP_MAIL_LISTEN_ARM_REMINDER:-0}" = "1" ]; then
  step2="skip the listener re-arm (SKIP_MAIL_LISTEN_ARM_REMINDER=1 switched it off; say so in the resume line)"
  step2_main="$step2"; step2_short="no listener re-arm (switched off)"
fi

# Fire-log (one line per fire; smoke runs route to a .smoke file, keyed on the isolation override).
if [ -n "${FF_STATE_DIR:-}" ]; then
  fire_log="$ROOT/.claude/logs/standby-resume-fires.smoke.jsonl"
else
  fire_log="$ROOT/.claude/logs/standby-resume-fires.jsonl"
fi
[ -f "$marker" ] && { printf '{"ts":"%s","session":"%s","parked_s":%s,"kind":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SID8" "$parked" "$kind" >> "$fire_log" 2>/dev/null || true; }

# Each net builds its text; ONE JSON document carries both, standby first (pause/SKILL.md resume step 0:
# the SEAT resumes before the WORK). Dynamic parts are digits / an ISO stamp / a sanitised sid /
# fixed literals — nothing that needs JSON escaping.
sb_ctx=""
if [ -f "$marker" ]; then
if [ "$kind" = harness ]; then sb_ctx="⏸ STANDBY (session ${SID8}, parked ${dur}, since ${since_iso}): this prompt is a HARNESS event — a task or monitor notification, a peer socket message, an /autorun cron or a /loop timer — NOT the owner. Do NOT run \`/standby resume\` and do not arm the listener: leave the marker and stay parked. Only the owner's own message ends standby."
elif [ "$kind" = autorun ]; then sb_ctx="⏸ STANDBY → THIS /autorun ONE-SHOT ENDS IT (session ${SID8} was parked ${dur}, since ${since_iso}; the owner armed this timer, so its prompt carries the owner's authorization). Run \`/standby resume\` FIRST, in the same order as for the owner's message: (1) \`python3 scripts/session-lifecycle.py resume\`; (1b) \`/mail check\`, dispositioning at read — BEFORE the re-arm, so the listener does not print the park's queue a second time; (2) ${step2}; (2b) \`/keep-warm on\` where SKILL step 2b applies; (4) THEN run what the one-shot's prompt says, under its own guardrails (never push, commit local, stop if unsafe)."
elif [ "$kind" = continuation ]; then sb_ctx="⏸ STANDBY (session ${SID8}, parked ${dur}, since ${since_iso}): this prompt is the harness RESUMING a turn a usage limit cut — not a new message. If the cut turn was the OWNER's (the owner's last message above, or the compaction summary's latest request), it ENDS standby: run \`/standby resume\` now — lifecycle resume, \`/mail check\` (before the re-arm), ${step2_short}, \`/keep-warm on\` where SKILL step 2b applies, then answer the owner. If the cut turn was a notification, stay parked."
else sb_ctx="⏸ STANDBY → THIS PROMPT ENDS IT (session ${SID8} was parked ${dur}, since ${since_iso}). Run \`/standby resume\` FIRST, before answering, in this order: (1) \`python3 scripts/session-lifecycle.py resume\` — clears the marker peers read as standby; (1b) \`/mail check\` — BEFORE the re-arm, so the listener does not print the park's queue a second time: read what arrived while parked and disposition it at read (verdicts and holds first; surface != act); (2) ${step2_main}; (2b) only if .claude/state/keep-warm-enabled or keep-warm-pilot-${SID8} exists and keep-warm-off-${SID8} does not, run \`/keep-warm on\` (the step-1b CronDelete at park removed the timer); (4) THEN answer the owner's message in this same turn, saying you resumed and how long you were parked. ⛔ IF THIS TURN IS NOT AN OWNER MESSAGE — a task or monitor notification, or a peer's cross-session message — do NOTHING: leave the marker, stay parked. This directive re-injects on every prompt until the marker is cleared; never read its silence as the net being off. Skip only in a genuine one-shot run (SKIP_STANDBY_RESUME_CHECK=1 in the LAUNCH env)."
fi
fi

# /pause RESUME IN WORDS. pause/SKILL.md lists the owner's words as a resume signal, but nothing ran the resume
# steps when they arrived inside another command. Fires only on the owner's own turn (a [keep-warm]
# ping, a notification, an /autorun one-shot, a usage-limit or Auto resume line are not his words),
# never on a /pause, /standby or /autorun command (each parses its own args), and only when the words
# START a message of 25 words or fewer, or END one of 12 or fewer: "resume", "resume now", "continue",
# "let's resume", a command followed by "and let's resume"; or when "let's resume/continue" sits anywhere in a message
# of 15 words or fewer, or "unpause" / "pause is
# lifted" / "lift the pause" / "end the pause" anywhere in one of 25 or fewer, unless "until"/"before"/"once"/"when"/"if" or a negation sits right before it (a "the", "my", "i", "we" or "you" between still counts). A false fire costs one Skill call that finds the
# marker and asks; a miss costs commits under a pause.
pz_ctx=""
if [ -f "$pause_marker" ] && [ "$kind" = owner ]; then
  pz_text="$PROMPT"
  case "$pz_text" in
    /pause|/pause[[:space:]]*|/standby*|/autorun*|[Aa]uto[[:space:]]resume*) pz_text="" ;;
    /*) case "$pz_text" in *[[:space:]]*) pz_text="${pz_text#/*[[:space:]]}" ;; *) pz_text="" ;; esac ;;
  esac
  q=\'; cq=$'\xe2\x80\x99'
  pz_text=${pz_text//$q/}; pz_text=${pz_text//$cq/}
  pz_norm=$(printf '%s' "$pz_text" | LC_ALL=C tr 'A-Z\n\t\r,;:!?.' 'a-z ' | tr -s ' ' | sed 's/^ //; s/ $//')
  pz_n=$(printf '%s\n' "$pz_norm" | awk '{print NF}')
  pz_fill='((and|ok|okay|so|now|alright|right|good|great|thanks|thank you|then|please|yes|yep|cool|perfect|fine) )*'
  pz_lead='((lets|let us|please|you can|we can|go ahead and) )?'
  pz_start="^${pz_fill}${pz_lead}(resume|continue)( |$)"
  pz_end='(^| )(resume|continue)( now| the work| work| please| again)?$'
  pz_hit=0
  if [ -n "$pz_norm" ]; then
    { [[ "$pz_norm" =~ $pz_start ]] && [ "${pz_n:-99}" -le 25 ]; } && pz_hit=1
    { [[ "$pz_norm" =~ $pz_end ]] && [ "${pz_n:-99}" -le 12 ]; } && pz_hit=1
    pz_mid='(^| )(lets|let us) (resume|continue)( |$)'
    { [[ "$pz_norm" =~ $pz_mid ]] && [ "${pz_n:-99}" -le 15 ]; } && pz_hit=1
    pz_lift='(^| )(unpause|pause is lifted|lift the pause|end the pause)( |$)'
    pz_lift_not='(until|before|once|when|if|dont|do not|not|never|cant|cannot|wont) ((the|my|i|we|you) )?(say )?(unpause|pause is lifted|lift the pause|end the pause)( |$)'
    { [[ "$pz_norm" =~ $pz_lift ]] && ! [[ "$pz_norm" =~ $pz_lift_not ]] && [ "${pz_n:-99}" -le 25 ]; } && pz_hit=1
  fi
  if [ "$pz_hit" = 1 ]; then
    p_since=$(head -c 400 "$pause_marker" 2>/dev/null | awk 'NR==1 {print $1}')
    [[ "${p_since:-}" =~ ^[0-9]+$ ]] || p_since=$(stat -f %m "$pause_marker" 2>/dev/null || stat -c %Y "$pause_marker" 2>/dev/null || echo 0)
    p_iso=$(date -u -r "$p_since" +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d "@$p_since" +%Y-%m-%dT%H:%MZ 2>/dev/null || echo '?')
    pz_after=""; [ -n "$sb_ctx" ] && pz_after="AFTER that \`/standby resume\`: "
    pz_ctx="${pz_after}⏯ PAUSE → THESE WORDS READ AS THE OWNER RESUMING THE PAUSED WORK (session ${SID8}, paused since ${p_iso}; the marker .claude/state/session-pause-${SID8} still stands). Run \`/pause resume\` through the Skill tool FIRST, before answering: a resume in his words runs the same steps 0-5 as the typed command, and step 5 clears the marker (2026-10-09: a resume in words left it standing and 4 commits landed under the pause). Then do the rest of what his message asks. If the word was incidental and he did not mean to end the pause, say so in one line and leave the marker."
    if [ -n "${FF_STATE_DIR:-}" ]; then pz_log="$ROOT/.claude/logs/pause-resume-words-fires.smoke.jsonl"; else pz_log="$ROOT/.claude/logs/pause-resume-words-fires.jsonl"; fi
    printf '{"ts":"%s","session":"%s","words":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SID8" "${pz_n:-0}" >> "$pz_log" 2>/dev/null || true
  fi
fi

[ -z "$sb_ctx" ] && [ -z "$pz_ctx" ] && exit 0
ctx="$sb_ctx"; [ -n "$pz_ctx" ] && ctx="${ctx:+$ctx }$pz_ctx"
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ctx"
exit 0
