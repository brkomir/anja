---
name: claude-system-architecture-overview
description: Short reader-facing overview of this Claude Code system — the core mental model, the primitives, and worked examples that show how it works in practice.
type: docs
audience: A developer with basic Claude Code familiarity who wants the system shape (not every command). Also future-self needing fast reorientation.
companion: architecture.md (full reference) · state.md (current health + failure modes).
note: Conceptual overview. Counts are approximate — exact, filesystem-verified counts live in architecture.md Appendix B. Keep the story-chapters QUALITATIVE (the gist, not exact line-refs/counts) — the precise traces of Stories II and III live in the system's internal records (tracker rows, process logs, the lesson corpus; Story II's also in architecture.md), Story I is told as a pattern and cites none, and nothing mechanical guards prose-drift, so re-verify Stories II and III against their sources on any content pass. Refreshed on major architectural change.
last-reviewed: 2026-10-19
---

# This System — Architecture Overview

This page describes the source tree this copy was taken from; some files and counts it names are not in this copy. `docs/repository-map.md` lists what the copy ships.

The source project is a solo-built AI photography-critique SaaS — upload a photo, get a structured critique and a score. This document maps the thing built *around* it: the `.claude/` system one founder uses to ship that product, alone, at quality. The clearest way in is to watch one ordinary feature go from a decision to committed code — every step is one of the system's primitives doing its job.

## How a feature ships

The feature was small. The product's critique already names the edits a photo needs — crop tighter, warm the white balance, lift the shadows. The idea was a page that lays those out as an **editing reference** — the exact adjustments to make in your own editor — so a photographer can follow them without re-reading the prose. Small surface; unambiguous value.

The build path had four beats.

The first was an `/expert-review` final audit of the page's first version. The panel hit a genuine 3–3 deadlock: three experts argued the page needed a dedicated layout, isolated from the application shell's chrome; three argued it should stay inside the existing layout. Neither position was wrong on its merits.

> **Resolution by fact, not vote.** One expert flagged that in this framework, a child layout *cannot* un-wrap the parent shell — the shell's parent layout renders its wrapper around all descendants, and a nested layout renders *inside* it, not instead. The "dedicated layout" option was architecturally impossible. The deadlock collapsed into a pathname branch inside the existing shell — roughly ten lines — delivering the same visual outcome. No vote was taken; the dispute closed on a verifiable constraint. This is how cross-domain composition resolves deadlocks: a different lens surfaces a checkable fact, and a fact outranks a preference count.

The panel's output went to `/agent-work`: four specialist agents building in parallel, each owning a disjoint set of files. One handled the page component and shell chrome. One owned all twelve locale files — the feature introduced roughly sixteen newly-externalized strings, each requiring real translations per language. One owned the data-contract layer. One rebuilt the test suite, replacing a structure-asserting mirror test with real render and integration coverage.

> **Parallel construction by disjoint file ownership.** The agents never touched each other's files; the orchestrator integrated their outputs. This is intra-session orchestrated fan-out: one coordinator, isolated subprocesses, a clean partition. It is explicitly *not* the inter-session, uncoordinated parallelism of Story III, which requires the manifest, session-mail, and append-only discipline described there. The complexity of that story comes from the partition *not* being clean; the clean case is simple. At wave close, types were clean, unit and integration suites were green. The tracker was held PENDING, not flipped.

A `--code` pass ran on the wave's diff under one rule: no lens that *authored* wave code holds a reviewer seat on that code. The frontend expert who might have owned the page implementation was replaced by an adversarial counterpart — a lens that reviewed the surface but didn't write it. (Today that pass is delegated to the standing review hub — a session that wrote none of the diff — and self-run only when no hub is alive.)

A regression the build wave had introduced was caught in review. The pathname branch that fixed the layout also re-inserted the email-verification banner — the notification bar shown to users who haven't confirmed their email address — without the column padding every other element on the page carried. For a verified user: invisible. For a user with an unverified email: the banner rendered full-bleed and misaligned with everything else on the page.

> **Builder≠breaker.** The regression was invisible to every green gate — a layout break on a specific user-state, not a logic error any unit test exercises — and invisible to the original-finding verification pass, which confirmed the panel's findings were present. Only a lens that didn't write the branch could look at the branch and notice what it left out. The `--code` pass's structural independence from the authoring agents is not ceremony; it is the mechanism.

After the `--code` findings were resolved, `/audit-check` ran a thirteen-check verification: every original finding confirmed present, every suite green, tracker flip authorized. The feature moved to COMPLETE.

> **`/audit-check` and `--code` are distinct layers.** The code review catches what the author missed; the completion gate verifies the fixes actually arrived and the suites pass. A clean `--code` result does not substitute for the gate; a green gate does not mean an adversarial review ran. Each answers a different question — *was anything missed?* versus *did the fixes land?* — and running one does not close the other.

(`/orient` preceded this lifecycle and `/wrap` followed it; the four beats above are the build-day core, not the full session shape.)

That third beat is the whole idea in miniature: the system caught a bug its own builder couldn't see, *because the reviewer wasn't allowed to be the builder.* Most features ship exactly like this — four primitives, one small feature, correct. Everything below is how that holds up: the always-loaded layer these primitives run inside, the memory that lets them compound, and — eventually — how all of it can still miss.

> **How to read this.** A conceptual overview — the system's *stable shape* (the mental model, the primitives, the workflows), shown working through worked examples — a build walkthrough, then three deeper stories. It deliberately does **not** track current health or live failure modes (that's [`state.md`](state.md)'s job), and it isn't exhaustive (the full reference is [`architecture.md`](architecture.md)). **Read time ~25 minutes; ~10 to skim** on this note + the mental model (§2) + the three story TL;DRs.

---

## 1. Why this system exists

Underneath every primitive that built that feature is one mundane, universal problem: **Claude Code sessions forget.** Each session starts cold. Decisions made last week are re-litigated. Hard-won lessons ("don't `git add -A` with parallel sessions running") evaporate. Rules written into a config file get loaded into context but don't actually *fire* at the moment they matter — and a gap nobody is primed to look for survives review. As a codebase and a working relationship mature, that forgetting compounds.

So the system gives Claude four things it doesn't have by default:

- **Persistent memory** — decisions and lessons that survive across sessions.
- **On-demand expertise** — deep domain knowledge (security, payments, photography, accessibility…) that loads only when a task needs it.
- **Deterministic safety rails** — enforcement that runs as real code, not as instructions the model might ignore.
- **Maintenance workflows** — routines that keep the memory and the rules from decaying into noise.

The goal is **not** "agents for agents' sake." It's to make *product* work safer, faster, and more consistent. Every piece earns its place by preventing a specific, recurring failure — or it gets pruned.

---

## 2. The one-screen mental model

Five sentences, then the picture:

1. Claude Code is a model loop plus a tool harness plus the `.claude/` config.
2. A *small* always-loaded layer carries universal constraints into every session.
3. Deep expertise lives in skills/agents that load *only* when invoked — so the common case stays cheap.
4. Hooks enforce the rules that matter as deterministic code, independent of whether the model "remembered."
5. Memory persists decisions, and a meta layer maintains the system itself.

```
        Claude Code  =  model loop  +  tool harness  +  .claude/ configuration
                                                          │
                          ┌───────────────────────────────┴───────────────────────────────┐
                          │  the .claude/ configuration splits sharply by load cost:        │
                          │                                                                 │
                          │   ALWAYS LOADED (every turn, kept small)   ON DEMAND (on invoke) │
                          │   • 3 resident rules (+16 path-scoped)     • ~120 skill specs    │
                          │   • a trigger-index ("if about to X,       • ~55 agents          │
                          │     do Y first")  ≈ project MEMORY.md      • slash-command flows  │
                          │   • the project-memory INDEX (1 line each) • deep reference docs  │
                          └─────────────────────────────────────────────────────────────────┘

        Cutting across both, three standing layers:
          • HOOKS    enforce mechanically (real code, runs regardless of attention)
          • MEMORY   persists decisions across sessions
          • META     workflows keep the whole thing from rotting
```

The top box is a *split* (the config divides by load cost). The three layers below it are not a pipeline — they are standing concerns that cut across everything above.

---

## 3. The core primitives

**Source:** Anthropic, Claude Code documentation (the memory and sub-agents pages), 2026 — for the vendor facts restated in the Rules entry below.

Seven building blocks. Each is a *file convention* plus a behavior — named with one real member of each, so they're concrete:

- **Skills** — invocable bundles of expertise (`.claude/skills/<name>/`). A skill is a `SKILL.md` spec (how to behave in a domain), usually paired with a cumulative `MEMORY.md` (what it has learned) and a `CHANGELOG.md` (how its own spec evolved). Example: `security-expert` — its MEMORY remembers what it decided in a billing audit three sessions ago. Skills are the unit of reusable knowledge.
- **Agents** — isolated subprocesses (`.claude/agents/`). An agent runs a task in its own context window, usually loaded with a skill, and returns a result. Example: a panel review dispatches the `saas-engineer` and `security-expert` agents in parallel, each reasoning in its own context. Agents are the unit of *parallel, isolated execution*.
- **Memory** — persistent state across sessions. Three tiers: project memory (decisions/preferences for the whole repo — e.g. that reports are shown inline, not written as files), per-skill memory, and meta memory (lessons about how the system itself should behave).
- **Rules** — coding standards (`.claude/rules/*.md`). Three load every session (among them `bash-environment` and `migrations`) and are re-sent to every sub-agent except `Explore`/`Plan`; the other sixteen are `paths:`-scoped and arrive on a matching read (measured 2026-09-27: `grep -l -F 'paths: [' .claude/rules/*.md` → 16 of 19), so a rule reaches every context that reads a matching file — bounded by four named exceptions (`Explore`/`Plan` get no resident rule; a CREATED file gets only a pointer, after the write; a Bash-created file gets nothing; a compaction can drop a scoped rule until the next matching read). The point: rules arrive *without being invoked*, unlike skills. ⛔ **PATH-SCOPING IS IMPLEMENTED AND RUNNING — this sentence claimed the opposite ("many carry `globs:` headers … that mechanism was never implemented") until 2026-08-18.** Both halves were false: **zero** rules files carry a `globs:` header (`grep -rn '^globs:' .claude/rules/` → 0), and the real key is `paths:`, which works — `.claude/rules/tests-unit.md` declares a `paths:` enumeration of the unit-test subtrees (narrowed from `tests/**` on 2026-09-04) and was the first file observed *absent* from the `session_start` load events, joining only on a `path_glob_match`; with sixteen files scoped, the scoped set now outweighs the resident one (re-derive with `wc -c` over the two sets — the 2026-08-18 figures that stood here were for one file). ⚠️ Residency then **decays**: measured 4 of 7 compactions re-injected it and 3 did not, so a scoped rule can leave a context mid-session and be re-added by the next matching read. The mechanism is **vendor-documented** (the memory page, as read 2026-10-08: what loads a path-scoped rule is Claude reading, writing or editing a file its pattern matches — tool use in general does not; the created-file exception in this list was measured before the page named Write and has not been re-measured since) and observed here — the `InstructionsLoaded` log (`load_reason: path_glob_match`) is its detector. ⚠️ **AND THE "re-sent to every sub-agent" CLAUSE ABOVE IS TRUE OF DELIVERY AND UNTESTED FOR SCOPING (2026-08-18).** Vendor-confirmed on delivery (the sub-agents page, re-read 2026-09-27): a sub-agent that is not a fork starts out holding the same full CLAUDE.md hierarchy the main conversation loads; the built-in `Explore` and `Plan` agents are the exception and start without those files; every other built-in or custom sub-agent gets them unless its definition opts out through the `omitClaudeMd` field. An earlier version of that page said no per-agent or frontmatter switch for this existed, which it no longer says; no project agent sets `omitClaudeMd`. ⚠️ **CORRECTED 2026-08-24 — the earlier "nobody has measured" was too strong, and this file was the stale half of its own sibling pair.** The UNMATCHED case IS measured: a `paths:` glob matching nothing is **excluded** from a dispatched sub-agent's payload, at launch time, with a positive control (a no-frontmatter rule reaches it; the unmatched one does not). What remained untested on 2026-08-24 — whether a sub-agent that READS a matching file then receives the rule — was settled afterwards: it does, measured in throwaway-repo rigs with positive and negative controls and corroborated at runtime by the `InstructionsLoaded` hook; the one first-touch gap is CREATION, which `write-scope-inject.sh` narrows with a pointer that arrives after the write lands.
- **Hooks** — deterministic enforcement scripts (`.claude/hooks/`, shell and Python) wired to lifecycle events. They run as real code and cannot be "forgotten." Example: `block-subagent-memory-write.sh` denies a sub-agent's attempt to write a `MEMORY.md` directly — memory has exactly one writer, the orchestrator.
- **Commands** — slash-command workflows (`/orient`, `/wrap`, `/meta`…). Multi-step procedures that compose the primitives above.
- **Meta** — the system's self-awareness layer (`/meta`). It audits memory, extracts lessons, tracks evolution, and keeps the rest from decaying.

**One more actor, not a file:** throughout this doc, *the orchestrator* is the main Claude loop running the workflow — it composes these primitives, dispatches the agents, synthesizes their results, and is the *single* writer of memory (agents only *propose* updates).

**When to use what:**

| Need | Primitive |
|---|---|
| Reusable domain knowledge | **Skill** |
| Parallel, isolated work | **Agent** |
| A persistent decision or fact | **Memory** |
| An auto-loaded coding constraint | **Rule** |
| Mechanical, can't-be-ignored enforcement | **Hook** |
| A multi-step workflow | **Slash command** |
| System maintenance / learning | **Meta** |

---

## 4. Always-loaded vs on-demand (the load-bearing choice)

This is the single most important design decision in the system.

There are ~120 skills. Loading all of them into every conversation would be enormously expensive (tokens, latency) and would drown the actual task in irrelevant context. So the system splits sharply:

- **Always loaded** (the session baseline): the three unscoped coding-rule files, the *index* of project memory (one line per memory, not the contents — it carries the trigger-index rows), and, for the main session only, the orchestrator plane (`orchestrator/conventions.md`, `session-doctrine.md`) — delivered at SessionStart, or placed in the system prompt when the session is launched through `scripts/claude-main.sh` (since 2026-10-07, so it is cache-shareable). The former `active-recall.md` trigger-index and the behavioral anti-pattern catalog are parked — scoped to the rules archive since 2026-09-07.
- **On demand** (only when invoked): the full skill specs, the per-skill memories, the agents, the deep reference docs.

Everything in the always-loaded layer is a tax on *every* turn, so the budget is treated as scarce — and it is literally byte-capped: the harness loads always-on files up to a fixed limit (the first **200 lines or 25 KB** of the project index, whichever comes first — vendor, `code.claude.com/docs/en/memory` § How it works; the repo's gate is `CAP_BYTES` + `CAP_LINES` in `check-memory-budget.sh`, and it is the 200-*character* pointer length that is aspirational, not the line limit) and truncates the tail with a banner that names the size and the limit but not which rows were lost. When something must always fire, it earns its way in; otherwise it lives behind an invocation.

The budget is now *governed*, not merely watched: a push-time byte gate measures the whole always-loaded band against a ratified ceiling (delta-gated, so a push that shrinks the band always passes). The standing doctrine is write-path discipline — demote narratives, keep directives — because the ceiling itself moved four times inside one week — 236 → 330 → 400 → 440 → 473 KB, each one a deliberate raise, then to 825 KB days later and two ratchet re-baselines since; and since 2026-09-21 the binding ceiling is a separate 240,000 B over only what loads every turn, the ratcheted series bounding a looser corpus plane that also counts the path-scoped rules — which is the proof that a limit alone is not a control. (This sentence's argument IS the count, so it was written to be re-derived rather than incremented. The authoritative raise log is the basis block in `scripts/check-band-budget.mjs`; read the count from there, never from this line.)

One refinement keeps the split honest for sub-agents: rules only the orchestrator can act on (wrapping, mail, push approval, panel composition) live in no always-loaded file at all — a SessionStart hook delivers them to the main session at launch (`orchestrator-inject.sh`; the per-turn prompt-submit injector `band-o-inject.sh` is still registered but has been switched off since 2026-09-07, `SKIP_BAND_O_INJECT=1`) — or `scripts/claude-main.sh` puts them in the system prompt instead (2026-10-07) — and the commit doctrine arrives on the first commit-shaped Bash call (`commit-doctrine-inject.sh`); the hundreds of sub-agents dispatched every day receive neither at launch, so they do not pay for rows they cannot use (the known exception: a sub-agent's own compaction re-fires SessionStart inside it). This is what keeps a system with ~120 skills usable: most turns load almost none of it.

---

## 5. Lifecycle of a turn

What actually happens around the model on one real turn — say you type `fix the refund bug`:

1. **Session start** (already happened): a hook surfaced your *top recurring blindspots* into context — mined from a registry of past owner-corrections — so the patterns you most often get corrected on are in front of the model *before* it composes.
2. **Your message** lands. The always-loaded rules + memory index are in context. A hook greps your prompt against its keyword patterns and surfaces any matching advisory as `additionalContext` (bare stderr from an exit-0 hook reaches only the debug log, `code.claude.com/docs/en/hooks`) — here, none: its keyword list holds no billing word, so this prompt passes bare (a prompt naming a payment vendor would get the payment-vendor row).
3. **The model works.** You open the billing code, and that read pulls in the path-scoped `actions` rule for that code; each tool call then passes through hooks. A staged `git add -A` trips a warn-mode hook telling you to list files explicitly instead.
4. **Agents.** The model spawns two specialist agents to check the fix in parallel, each in its own context window; each returns findings plus a proposed `Memory Update` block — which the *orchestrator* persists (sub-agents never write memory directly).
5. **Session end.** The close-out checklist runs a reconcile script that notices a migration was applied but never recorded in a commit message, and warns; a pre-push hook backstops the same class at the push boundary.

The thing to notice: hooks sit at *many* boundaries. The system wires about sixty of them across the nine lifecycle events it hooks — session start, prompt-submit, before/after each tool call, before compaction, turn-stop, session-end, instructions-loaded (which is how path-scoped rule loading is observed at all), and sub-agent start (the newest, 2026-09-04, which logs every dispatch and, since 2026-10-19, tells each sub-agent its prompt cache lives five minutes). They are how it enforces behavior the model would otherwise have to remember.

---

A session also protects its own runway now (all since 2026-09-23): it banks its state in the working plan before a compaction it can see coming (`/pre-compact`, hook-directed about 30k tokens before an automatic one), keeps its one-hour prompt cache warm while the owner is away (`/keep-warm`), refuses to launch new helper agents past 90% of the five-hour usage limit, refuses (since 2026-10-19, at any usage) to wake an idle helper whose cache has gone cold unless the message acknowledges the price, and recovers the agents that died at a limit (`/limit-recovery`) — and the owner can pause the work (`/pause`) or park the seat (`/standby`) by name.

## 6. The workflows

Slash commands are the entry points. Purpose-only summaries (operational detail lives in each skill's spec):

- **`/orient`** — understand the current repo + session state at the start of work.
- **`/agent-work`** — implement a task with several specialist agents working in parallel.
- **`/expert-review`** — convene a multi-expert panel to review or audit a decision or change.
- **`/audit-check`** — verify a piece of work against a quality gate *before* calling it complete.
- **`/wrap`** — the end-of-session close-out: catch hanging work, extract lessons (`/meta learn`), persist decisions, sync trackers, commit safely.
- **`/meta`** — maintain the system itself: audit memory, extract lessons, track evolution, self-audit.

`/wrap` and `/meta` are intentionally the most procedurally heavy — they're where the "keep the system from rotting" work happens.

**The meta layer, up close.** `/meta` is really a *family* of ~14 subcommands — the self-maintenance toolkit:

- **Periodic maintenance** — `/meta maintain` runs the full maintenance family in one sequenced pass, opened by a *context read* (last-run dates, churn, sizes — grounding facts that shape each sub-audit's brief). An earlier due-check gate was retired 2026-07-19 after three consecutive all-due runs proved it structurally dead at fleet velocity. Standalone audits cover memory hygiene, a self-audit of the meta spec, cross-expert pattern synthesis, and a preference-coherence check (what the owner *said* they prefer vs. what the skills *do*).
- **The lesson lifecycle** — lessons have create, read, update and a retirement path, not just append: `/meta learn` codifies a new one and (Step 2c) marks the lesson it supersedes on its heading at the source, `/meta distill` compresses a verbose one into a prescriptive pattern, and a sweep, to be built once twenty headings carry the mark (a handful do at 2026-10-14), will move them to a cold archive (the per-lesson `/meta demote` command was pruned 2026-10-11 after 123 unused days). The corpus is meant to be curated, not hoarded; the retirement half of that is still young.
- **Self-maintenance** — `/meta architecture-audit` keeps the *full reference* honest: a script derives the real counts from the filesystem and flags any that drifted, plus any feature that shipped but never got described.

The throughline: the meta layer is how the system notices its *own* decay and acts on it — not a dashboard to read, but routines that prune, compress, retire, and re-audit.

---

## 7. Memory design

Memory is split by scope:

- **Project memory** — repo-wide decisions, preferences, and reference pointers. Indexed by an always-loaded `MEMORY.md` (one line each); the bodies load on demand.
- **Skill memory** — each expert skill accumulates its own `MEMORY.md` of domain decisions.
- **Meta memory** — a large, numbered catalog of lessons about how the *system itself* should behave, each with an evidence trail.

The always-loaded index is split **hot/cold** to live within the byte-cap from §4 (the truncation it prevents is real — vendor-reference pointers at the tail of the index were dropping every session before the split — announced by a truncation banner that never named which rows were lost). The mechanics of the hot/cold tiers and the append-only discipline that makes *parallel* writes safe are shown in the third story below ("A morning with three sessions").

Memory hygiene is genuinely hard — the system treats it as a permanent unhappy path under three pressures: **Capture** (did we record it?), **Retrieval** (is it loaded when needed? — having a rule in a file ≠ firing it), and **Staleness** (does it still reflect the code?). Most of the maintenance machinery exists to fight one of those three.

---

# Three stories

The rest of the system is best shown, not described. Three stories carry its distinctive mechanics — why even a clean expert panel can't be the last word, how a lesson hardens into mechanical enforcement, and how parallel sessions coordinate without colliding. (The opening already showed the fourth — how a feature gets built.) Each opens with a one-line TL;DR. For Stories II and III the precise traces (exact counts, line-refs, dates) live in the system's internal records — tracker rows, process logs, and the lesson corpus; Story I is told as a pattern and cites none.

## Story I — The one that could get through

**TL;DR.** The build lifecycle is a probability, not a proof. A feature can run through it clean and still carry a paywall leak that expert panels sign off on. This story sketches that failure as a hypothetical pattern: the gap, and why even a clean panel can't close it alone.

The pattern looks like this: the server action behind a top-tier paid feature returns the complete paid content to every authenticated request — every signed-in account, whatever its plan. On the client, a visual mask obscures the text and a lock icon sits on the card. It looks protected.

Any signed-in user on a lower plan can read the whole thing straight from the response.

The fix is not a better mask. The gate moves to the server: a request without the entitlement receives only a teaser, and the gated content never crosses the wire. The system carries that as a standing rule (*a client-side mask over a full payload is not a paywall*).

The fix is straightforward. The unsettling part is what it can take to find the leak — because a feature like this need not skip the system's review. It can go through it, exactly like the build in the opening, and come back clean.

A change goes to a panel when no single domain can verify it alone. A feature of this shape touches several: whether the server action checks entitlement, what it actually returns over the wire, and what a paying subscriber experiences when the client renders the result. Any one reviewer's brief covers one slice.

> **The panel.** `/expert-review` composes domain experts against a Panel Playbook that records prior-audit history to bias composition toward what's worked. Experts receive separate briefs and launch in parallel — none sees another's output before forming a verdict. Synthesis groups findings by *topic*, not by speaker. Every finding gets an evidence-class label: `[CONVERGED]` when two-plus experts independently identify the same root cause via distinct evidence (a `[CONVERGED]` finding auto-promotes one severity tier); `[SINGLE-SOURCE]` when one specialized lens flags something others couldn't reach; `[DISPUTED]` when experts disagree, which triggers a targeted re-verification before synthesis closes.

One seat in every full panel is structurally different from the rest.

> **The contrarian role.** One expert per full-mode panel gets the Devil's Advocate brief, and the must-find rule is explicit: at least one concrete concern is required — "looks good" is unacceptable in this seat. The brief targets the assumptions the team is most *confident* about, because those are dangerous precisely for not being questioned. The role rotates so no expert holds it long enough to hedge it. Counterweight: if after genuinely pressing the confident assumptions the contrarian finds nothing real, naming what was checked is the correct output — a fabricated weak concern is as much a failure as a missed one.

The panel's findings can be revised after synthesis closes. One gate governs that.

> **The sycophancy gate.** A verdict or severity change after synthesis requires *new evidence*: a file:line not cited before, a new expert consulted, a new fact about the code. Pushback alone does not move the verdict. The update must be grounded — persistence is not grounds. This is the system's defense against the model's tendency to cave when challenged.

After synthesis runs, the panel inspects its own agreement.

> **Distrust its own confidence.** If at least half the experts return near-identical APPROVED verdicts with similar reasoning and none cite distinct evidence, a Correlation Notice fires: unanimity is treated as the *most dangerous* failure mode, not the safest, because experts sharing training data converge on shared blind spots as readily as on genuine agreement. (Carve-out: when independently-weighted domains converge on one finding for *distinct* reasons — a security lens, a target user's read, and a paying-subscriber review all flagging the same server action through separate evidence — that's additive signal, not shared bias, and the notice does not fire.)

A leak of this shape can survive full panels — each running these mechanisms, none catching the gap. What finds it is an audit deliberately composed onto lenses the earlier panels lacked, whose distinct domains converge on the same server action through separate evidence — exactly the distinct-domains pattern the carve-out above describes.

The mask-over-full-payload pattern is what makes it possible. A client-side mask looks like a protection to any reviewer who doesn't probe what the server returns; a brief scoped to classic access-control checks has no path to that question, because the client-side rendering says *protected*. The contradiction between what the client displays and what the server returns lives in a gap no domain brief, by default, is scoped to check.

That is not a failure of the panel design. It is what the panel design is honest *about*. Parallel domain experts drawn from the same model share distributional intuitions about what "protection" looks like — orthogonal at the domain level, correlated at the representation level. Clean draws from that distribution are not independent validations; they are draws from one correlated source.

The system's response is not a *larger* draw. It is recomposition — loading the next audit onto the missing lenses — plus layers with structurally different properties: the `--code` review and the `/audit-check` gate from the opening lifecycle, and a rule-and-hook pair that fires at the push boundary regardless of what any future panel thinks to check (the next story). The pattern's second half shows why the extra layers earn their place: a fix of this kind can add an entitlement flag recording the plan the content was generated under, and that flag's default can mis-classify every row written before the flag existed — quietly reopening the leak for older data. A panel can wave that through; the builder≠breaker `--code` pass is the layer placed to catch it. These are not redundancy. They are the architecture's explicit acknowledgment that any panel result is a *probability, not a proof*. The next story is the push-boundary layer — the one that catches what no reviewer thought to check.

## Story II — A lesson climbs the ladder

**TL;DR.** The `hover:`-without-`focus-visible:` keyboard-accessibility bug appeared in half a dozen feature audits before a hard git hook stopped it. Its path — one-off finding → corrections log → always-loaded rule → hard push-time block — *is* the promotion ladder, concrete.

An interactive element with a `hover:` style and no `focus-visible:` style passes every automated check. `tsc` passes, Vitest passes, code review sees valid Tailwind. It highlights on mouse-hover; nothing happens when a keyboard user tabs to it. Invisible to tools, visible only to a manual audit looking for it.

An early audit finds it in the return-visit flow. Noted, fixed; `/meta learn` records the incident and it earns an entry in the lesson corpus.

> **How a lesson is born.** An entry carries an evidence chain, a Durability + Impact + Scope score that sets how much enforcement it deserves, and a revisit trigger. At birth a lesson is *advisory* — the weakest tier, and for a first occurrence the proportionate one. (The corpus runs to over two thousand numbered `L#` lessons, each citing the dated incident that produced it, so a year out the *rationale* survives and a future reader can re-judge whether it still holds.)

The same pattern returns in a different component. The lesson existed; the session didn't apply it. Then it returns again, and again — across half a dozen separate feature audits.

That many distinct-session recurrences is the threshold. The pattern is codified as a line in `components.md` (a rule file — always loaded then; since 2026-08-18 it is `paths:`-scoped to the component trees and arrives on the first read of a matching file) *and* a pre-push hook that scans the pushed diff and refuses the push.

> **The promotion ladder.** `incident → memory → always-loaded rule → hook`. Each rung is an *evidence threshold*, not a feeling. The move up is "how many times has the weaker tier failed?" — not "how important does this seem?" You don't jump straight to a hook; you earn it.

The hook ships **warn-mode** first — surfacing without blocking — to measure false positives, because a hard block with an unknown error rate teaches developers to work around it, which is worse than no hook. Clean window → it promotes to hard-block. A commit with `hover:` and no `focus-visible:` is now *impossible to push*. Not inadvisable — blocked. And the block is itself guarded: a CI job re-runs the hook layer's own smoke tests on every push, so a silently-broken gate — the worse-than-no-hook failure mode — is caught downstream rather than trusted.

> **Capture → Curate → Enforce.** Capture (the audit logged it), Curate (the recurrences crossed the threshold), Enforce (rule + hook). The frame's value is diagnostic: when something breaks, ask *which layer failed?* — a signal nobody logged is a Capture gap; logged-but-never-promoted is Curate; a rule that exists but doesn't fire is Enforce. Most botched fixes are *wrong-layer* fixes (writing another memory note for what is really an enforcement gap — the note gets forgotten too). Naming the layer is half the fix.

One story, four mechanisms. Half a dozen incidents, one hard block — and audits have not found the pattern since. Said carefully: a gate that refuses pushes produces zero recurrences *on the path it covers* by construction, and this gate reads only the tags a push adds (an awk pass over the pushed diff that follows each added `<button>`/`<a>`/`<Link>` across lines, so an edit inside a tag whose opening line is unchanged is outside it), so the honest claim is that the class *stopped showing up*, not that it became impossible. That is still the system working as designed — the ladder's job was to stop the bleeding, and it did.

---

*These three stories are the system's distinctive **mechanics** — they are not the bulk of the work. The bulk is the **product**: several dozen feature and flow audits behind these mechanics — the AI critique pipeline, the billing flow, content moderation, comparison and curation — each one built and reviewed like the opening feature, each one able to slip a gap like Story I, each lesson a climb like Story II. The mechanics exist so that work ships safer. The last story is how several of them run at once without corrupting each other.*

---

## Story III — A morning with three sessions

**TL;DR.** The owner runs many Claude Code sessions against one repo at once. One morning a peer session's routine count-sync commit absorbed an in-flight audit's uncommitted edit — and lost nothing; minutes later a hand `grep` and a script disagreed about a lesson's number, and the disagreement was re-checked instead of guessed. Scope manifests, session-mail, first-commit-wins git discipline, and a standing distrust of any surface two tools describe differently are what let parallel work on a live product avoid corrupting itself.

On a normal morning there are three sessions open against this repository: one auditing a flow, one building a feature, one closing out with `/wrap`. None of them knows, at the language level, that the others exist. They share one git working tree — and a working tree has no locks — plus the same git index and the same always-loaded memory files every session reads at startup.

This is the setup for clobbering. Two sessions stage files, one commits, and a bare `git commit -m` absorbs the entire shared index — including the other's half-finished work. The first defense is a discipline, not a mechanism: never `git add -A`, never `git stash`, list explicit paths, and commit through `scripts/safe-commit.sh`, which refuses a commit whose staged set differs from the files this session declared (a bare `git commit -o <paths>` is the older, weaker form). A warn-mode hook flags the dangerous forms; the rules are always loaded. That stops one session overwriting another's *files*.

It does not stop a subtler collision: two sessions reaching contradictory *decisions* about the same surface. For that there is a capture-time layer.

> **Parallel-session coordination.** Each session snapshots its current work-subject to a per-session manifest, self-identifying by session id. A peer can read those summaries or run a `check-overlap` gate that *halts* on code/migration overlap with a named peer and only warns on shared coordination files — wired into agent dispatch (`/agent-work`) and the panel's scope proposal (`/expert-review`), so a collision surfaces *before* the work starts. The manifest is detection; **session-mail** is the active half: a session writes a handoff into a git-ignored mailbox (one atomically-written file per message, addressed to a peer or broadcast), and the recipient's armed listener (or, failing that, its next startup) surfaces it — as *untrusted data, not an instruction*: wrapped in delimiters, tagged with an unauthenticated claimed sender, shown to the human, never auto-executed. The manifest stops collisions; the mail moves intent. Coordination by convention plus a safety net — not locks.

That morning the closing session finished first. Its `/wrap` ran a count-sync and committed. The audit session, still in flight, had also touched one of the shared append-only memory files — and when it went to commit, its edit was already in the tree, carried in by the peer's earlier commit. This is not a failure. It is the design.

> **Memory tiers, and the append-only discipline.** Durable memory is layered: a small always-loaded *hot* tier (the project index, the trigger table) and a large *cold* tier read on demand (the per-skill corpus). The hot tier is byte-capped — past the cap the tail is truncated, announced but without naming which rows — so it holds only what every composition needs. The shared cold-tier files (lesson logs, registries, changelogs) are **append-only**, and that single property is what makes parallel writes safe: when two sessions append, whoever commits first wins and carries the other's appends in intact. The second session simply finds its change *already applied*. There is nothing to merge and nothing to lose — the correct response is one check (*is my content in `HEAD`?*) and then move on, no investigation, no git surgery.

So the audit session ran the one check, saw its lines in `HEAD`, and continued. Then two tools disagreed.

Mid-audit, a claim needed grounding: which lesson number governed a rule. A hand `grep` over the corpus returned one number; a script that resolves lesson references returned another. Both ran against the same files, seconds apart. They disagreed. The corpus carries over two thousand lessons with renumber gaps — a numbering collision once moved a lesson to a new number, and numbers are now *allocated* from a mint ledger rather than derived from the visible maximum, precisely so two concurrent sessions cannot coin the same one — so a stale reference and a current one can both look authoritative.

> **A disagreement is the highest-fidelity signal, not noise.** When two tool outputs contradict each other on a load-bearing fact — two line counts for one file, a re-grep that can't find a block a prior read showed, two numbers for one lesson — the discipline is *not* to pick the more plausible side. It is to stop, treat both outputs as untrusted, form no conclusion and write no durable edit, and re-derive the fact with one clean command, cross-confirmed by a second method. The inconsistency itself is the information: one instrument is wrong and you don't yet know which. The same posture applies to a human in the loop — a user's pushback ("are you sure?") is the same disconfirming signal, to be investigated before any position moves. The system's entire memory of its own mistakes is built from these moments: a contradiction noticed, re-checked, codified.

The number was re-checked against the source, not guessed. The audit proceeded on the verified value.

Two disciplines, one morning. A git convention and an epistemics rule look unrelated, but they are the same instinct pointed at two surfaces: parallel work makes surfaces unreliable, so distrust the surface, then either recognize the known-benign pattern (the swept-in append) or re-verify with one clean command (the disputed number). Never guess, never clobber, never mistake the appearance for the fact.

Since that morning the coordination layer has grown a deliberate topology on top of the conventions. When a question needs the whole fleet, there are now two owner-invoked modes instead of an all-to-all broadcast: a *convergent inquiry* (one lead analyzes; peers answer only scoped, direct-addressed evidence requests) and a *divergent swarm* (many seats each live a different user situation against one pinned build), riding a channel transport whose write gates fail closed and keep spokes from cascading. And when a fleet-wide seat falls vacant — the standing review hub, say — peers no longer each quietly re-run the same work: a claim token turns the herd into an election — and the claim is read back after writing, so exactly one claimant is told it won rather than all of them believing it. (The election's precondition — knowing a peer's seat is actually empty — is a *derived* liveness status: one shared derivation over markers and transcript records, deliberately failing toward ACTIVE, because a false EXITED is what makes a peer adopt work someone still holds.) All of it exists because the mail bus once carried a 215-message cascade in 95 minutes; the topologies are the structural answer.

None of this is academic. The repository these sessions share is a real product — a payment flow, a usage ledger, a moderation pipeline. The cost of getting parallel coordination wrong is not a merge conflict; it is a peer's security fix silently reverted, a half-applied migration, or a lesson lost the moment after it was learned. The manifests, the mailbox, the append discipline, and the reflex to re-verify a contradiction all exist for one reason: so that three sessions building one product at the same time leave it more correct than they found it, never less.

---

## How this system is put together

Most of these patterns are shown in the three stories above — the **constructive build-and-review lifecycle** (the opening) and the **self-arguing expert panel** behind it — contrarian, sycophancy gate, and all (Story I), the **evidence-promoted enforcement ladder** and the **numbered-lesson corpus with evidence chains** (Story II), and **parallel-session coordination**, **hot/cold byte-capped memory**, and the system's **distrust of its own confidence** (Story III). A few more, not story-carried:

- **Per-skill cumulative memory** — each expert remembers across sessions, so expertise compounds instead of resetting.
- **A meta layer that audits itself** — the system has routines for catching its *own* drift, not just the code's.
- **Hook smoke-test discipline** — enforcement is tested like code, because a silently broken hook is worse than no hook.
- **User pushback as a first-class signal** — corrections are logged and mined for *patterns*, then primed back into context at session start, so a habit of getting corrected becomes a standing prompt to self-correct.
- **A standing review hub** — one session can hold the fleet's reviewer seat: peers mail their commits to it for fresh-context, builder≠breaker review instead of self-reviewing, and a vacancy is resolved by election, never by every peer quietly running its own panel. **The principle under it: the layer that checks the work matters as much as the layer that does it, because a model errs more as its context and moving parts grow and is badly placed to catch its own errors — so every non-trivial change is read by a session that did not write it.** Production inherits it: `/promote` refuses a range holding a `src/` or migration commit that no review has named, whose review did not clear, or that sits under an open hold, unless the owner's explicit go names it, and the merge waits on the owner's explicit yes.
- **Systematic cross-system learning** — ten other public Claude Code setups are catalogued as `external-*` skills in the source project (eight studied from April to July 2026, two more on 2026-10-09), seven of them in a comparison matrix, plus a comparison-only tier below expert admission for systems worth tracking but not consulting; patterns are borrowed or rejected with *recorded reasons*, not reinvented. The matrix is kept in the source project; the main ideas adopted from each system, and when, are credited in `docs/where-the-ideas-came-from.md`.

---

## Known risks (candid)

The honest read includes the failure modes. Five stand out:

- **It can become its own product.** Meta-work displacing product is a real pull, with a counterweight rule (a per-session cap on meta commits). An earlier self-audit framed it as a commit-count ratio, but that metric was later **downweighted** — commit-count overstates meta-share (product commits are far larger in scope/LOC). The pull is real; the raw ratio was a flawed measure of it.
- **Exact counts drift.** With this many moving parts, hand-written counts go stale fast (which is why this overview uses approximate counts and the full doc generates exact ones from the filesystem).
- **L-number references are opaque to outsiders.** The lesson-citation habit is great for the author and confusing for everyone else — which is why the stories above gloss every `L#` in plain language.
- **Memory can become noise.** Capture is easy; curation is the bottleneck. Without pruning, the signal drowns.
- **External-system comparisons stale quickly.** Other projects move; our notes on them age.

For the *current* state of these — what's actually fragile right now vs. handled — see [`state.md`](state.md).

---

## How to extend the system

The decision rule for "I want to add something":

| You have… | Add a… |
|---|---|
| New domain knowledge | **Skill** |
| A correction that keeps recurring | **Memory** entry |
| A rule that applies across many contexts | **Rule** file |
| A rule that's repeatedly missed despite being written | **Hook** (the climb in Story II) |
| An ambiguous "is this worth keeping?" lesson | score it on the **Durability + Impact + Scope** rubric |
| A pattern seen in another system | compare it with the other systems already studied before adopting |

Two throughlines. First, **add the *weakest* enforcement that will work** — escalate toward a hook only when evidence shows the weaker layer keeps failing. The default answer to "should this be machinery?" is **no, not until it has recurred**: a new skill/rule/hook earns its place by preventing a *specific, repeated* failure, or it's just more surface to maintain. Second, external systems are **pattern sources, not authorities** — "System X does it" is never sufficient on its own.

---

## Where to go next

- **Full reference** — [`architecture.md`](architecture.md): every mechanism, exact counts, lesson citations, history.
- **Current health + failure modes** — [`state.md`](state.md).

This overview is the front door. If you're going to *work* in the system, read `architecture.md` next; otherwise this is enough to understand the shape.
