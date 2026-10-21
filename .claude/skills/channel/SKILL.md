---
name: channel
description: Fleet-channels transport client — use when opening, joining, or driving a dedicated multi-seat channel (a deliberation or swarm run on its own mail root, spectator-visible under .claude/state/session-mail/channels/<slug>/). Thin wrapper over session-manifest.py channel open·join·send·status·close·list; protocols live in /fleet-inquiry (Mode A) and /fleet-swarm (Mode B), never as flags here.
---

# /channel — fleet-channels transport client (Wave 2)

Thin transport ONLY — the exact `/mail` precedent. A channel is a
**parameterized mail root**: drops reuse the existing `all__<ns>__<sender>.md` shape
verbatim inside `channels/<slug>/`, so every hardened mail path (parse, receipts,
self-echo, sanitizer, byte-cap) carries over with only the directory swapped.

**Spectator view (the owner feature this shipped for):** everything a channel says is
plain files — `ls -t .claude/state/session-mail/channels/<slug>/` or watch the dir.
The owner is **not enrolled**: the close report goes out as ordinary mail.

**Response-mode marker: `[channel]`** — a one-shot ops command, same family as `/mail`, and since 2026-09-01 every reply carries a marker; there is no unprefixed state. *Read "prefix: none" until then.*

## Usage

- `channel open <slug> --charter plans/channels/<slug>.md` — FC-01 gate: refuses a
  charter missing required fields (`slug/mode/lead/terminator/deliverable/
  charter_version` + per-seat `role:`/`grounding:` lines) or a NON-COUNTABLE
  terminator. The charter master is git-tracked under `plans/channels/`; the command
  copies it into the channel dir.
- `channel join <slug> --digest <sha256-8> --role <r> --terminator-share "<s>"` —
  proof-of-read: the digest of the CHARTER as-on-disk, or the listener never arms for
  you. Un-chartered sids are refused (adds go via a charter version bump). Join runs
  the no-floor catch-up sweep.
- `channel send <slug> --kind <k> [--anchor <a>] [--reply-to <finding>] [--basis <b>] [--subject <s>]`
  (body via stdin / `--body-file`) — FC-02 gates: membership fails CLOSED ·
  `finding|position|rebuttal` REQUIRE a resolvable anchor (`src/|messages/|supabase/`
  path[:line], a `/route`, or a charter-item literal — never `.claude/` or the mail
  store) · `extension` requires `--reply-to` a FINDING (depth rule: nothing anchors to
  a message) · the LEAD is barred from `position|rebuttal` · `signal: deploy-*`
  HARD-fails (a channel is a deliberation surface, never a deploy-authorization one) ·
  spokes cap at 4 KB (the lead's digest keeps 20 KB) · non-lead sends are ADDRESSED to
  the lead — peers physically cannot cascade (charter `fanout: all` opts out).
  **⚠️ THE CASCADE GATE IS SPOKE-SIDE ONLY — the LEAD can still fan out, and by convention
  must not.** A lead broadcast wakes all N armed listeners into full-context turns; measured
  2026-07-30, that consumed 22% of one seat's finite ~40-turn budget with verdicts about
  *other* seats, none of which changed the reader's next action. On a capped-turn run, lead
  broadcast volume is a direct tax on the coverage you convened for. **Discriminator is
  CONTENT, not role:** `to: all` is for state that changes another member's NEXT ACTION
  (UNBLOCKED · slot handoff · protocol change · a pre-check others will hit); per-member
  verdicts, acks and progress notes go direct-addressed. No mechanism enforces this — the
  write gates bind spokes, so this one is on the lead.
- `channel status <slug>` — state · enrolled K/N · CLI-computed health (the
  lead never self-reports the numbers that judge the lead's protocol).
- `channel close <slug> --outcome <o>` — member-only; writes CLOSED + health, logs to
  `channel-runs.jsonl`. Idle channels auto-close via the prune sweep (12h default,
  charter `idle-hours:` up to 72); dir GC 24h after CLOSED.
- `channel list` — every channel + state + enrollment + message count.

Catch-up also rides `mail-check`: bare invocations sweep every ENROLLED channel
(SessionStart = crash recovery, zero hook changes); `mail-check --channel <slug>`
scopes to one.

## The re-arm caveat (measured, 2026-07-28)

A live `mail-listen` runs **in-process** — it picks up channels only after a re-arm.
Opening a channel among long-lived seats requires a RE-ARM step in the convocation
(the join instructions carry it). An old listener is structurally BLIND to
`channels/` (flat globs) — it degrades to not-seeing, never to crashing.

## Anti-scope

- Protocols are NOT flags here: Mode A deliberation lives in `/fleet-inquiry`
  (topology-2 when Wave 1 ships); Mode B exploratory-swarm becomes its own skill at
  Wave 3. `/fleet-inquiry` itself stays on the DEFAULT bus (verified: already
  point-to-point, and a channel would hide its deliberate fleet-wide CLOSED broadcast).
- Never a deploy/verdict surface — `deploy-*` is refused at write, hard.
- Not for product traffic — verdicts, folds, claim-or-disclaim stay on the default bus.

## Provenance

Wave 2 of the fleet-channels staged plan, pulled forward for the spectator view
ahead of the Wave-1 fork trigger. Review-hardened design with pre-registered gates;
smoke blocks 14-22 (suite 106/0).
