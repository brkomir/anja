---
name: expert-system-bootstrap
description: >-
  The front door for a new project on this expert system: from a repository path and a specification
  (an md or pdf file, a folder, or pasted text) it runs a lean panel that validates the specification,
  challenges its technical assumptions and sizes the expert lineup, waits for the owner's OK, then
  copies Anja into that repository, writes the product context file and each expert in today's shape,
  and hands over to the new repository's first panel. Use when the owner briefs a new project or asks
  to set the expert system up in a fresh codebase. Owner-invoked; never on this repository.
---

# Expert System Bootstrap — start a new project from a brief

Rewritten 2026-11-02 so that a new project can be started by briefing this command. The April 2026
version was a method only: six phases of templates
for a system that then had no generator, no memory files, no agent definitions and no public copy. The
method is kept below (§ Designing an expert, § Quality markers, § Scaling, § Anti-patterns); what is new
is that the command now RUNS, from a brief, against a repository you name, and that it starts from Anja
instead of from blank templates.

## The brief

```
/expert-system-bootstrap <path to the new repository> <specification>
```

- **The path** is a directory that is, or will be, a git repository. Relative paths resolve from this
  session's working directory. The command never touches this repository's own `.claude/` tree.
- **The specification** is one of three: a file (`.md`, `.txt` or `.pdf`; a PDF is read by pages), a
  folder (an existing codebase or a documents folder: its README, docs, manifests and top-level tree
  are read), or text pasted after the path. One is required. A single sentence is accepted as a very
  short specification, and the panel says so in its verdict.
- **Optional:** `--anja <path>` names a local Anja checkout to copy from (default
  `<local Anja checkout>`, pulled first; with no checkout, `git clone <Anja repository URL>`
  into the scratchpad). `--from-here` says the current session already sits in the new repository with
  Anja copied in (step 4 is then only checked, never run). Steps 1 to 3 still run in the source
  repository first, since the copy lacks step 2's external-system seats; paste step 3's
  `## Bootstrap lineup` block into the new session.
- **Where it runs:** from this repository. The lean panel of step 2 seats experts from this roster. A
  session can load another directory's agents (`--add-dir`, `/add-dir`, `/cd`; the vendor's sub-agents
  page), but all 34 of Anja's agent names also exist here with no documented precedence, and the hooks
  keep `CLAUDE_PROJECT_DIR` at the starting project after a `/cd`, so the new repository's own panel
  (step 7) runs in a session opened there.

What the owner gets at the end: the specification's verdict and the assumptions it should not keep
untested, each as a question he answered; a repository holding Anja's machinery; a product context
file his experts read; the lineup the panel sized and he approved, in today's shape, generated and
hidden from the command list; the review panel routed to them; and the line to type in the new
repository's first session to run its first panel.

## Process

The command runs a lean panel first, 3 to 5 experts with external ones among them, on the
specification given as its argument (an md or pdf file, for example): the panel validates the
specification, challenges its technical assumptions and decides how many experts and which
specializations the project needs, and only then is the Anja copy made for that project. Steps 1 to 3
are that panel; 4 to 7 are the copy and the experts. Step 3 waits for his answers and his OK; nothing is copied or written
before it. Each step ends with the files it wrote, by path, and a check that read them back.

### 1 · Read the specification and write its digest

Read it whole (a PDF by pages; a folder by its README, docs, manifests and top-level tree, never the
whole source). Write `<scratchpad>/spec-digest.md`, one page: what the product is and who pays; the
stack, scale and data it assumes; the claims it makes about users and the market; what it leaves out
(billing, data handling, moderation, languages, operations); the stage. Nothing is judged here: the
digest is the panel's shared input, and the owner sees it with the verdict.

### 2 · The lean panel: validate, challenge, size

`/expert-review --lean <the specification>`, 3 to 5 fresh seats from this repository's roster, no
contrarian (lean mode). Default seats, swapped when the specification says otherwise:

- **saas-architect**: the system the specification implies and the technical assumptions worth a test
  (stack, scale, data, async work, what not to build).
- **saas-economist** or **market-researcher**: whether the money and the market in it hold, and what
  would have to be measured first.
- **security-expert** or **legal-advisor** when it handles user data, uploads, payments or AI output;
  **prompt-engineer** when an AI feature is the core.
- **1 or 2 external-system experts for the sizing question** (how many experts, which specializations,
  how much ceremony this stage earns): **external-wshobson-agents** (granularity, resident-context cost,
  model tiers) and **external-shinpr-claude-code-workflows** (scale-based ceremony), or
  **external-superpowers** in shinpr's place when the specification is a plan with nothing built yet
  (its brainstorm-before-build gate is the question). The panel stays at 3 to 5 seats with at least
  one external; with more candidates than that,
  keep the seats the specification's risks name.

Every seat gets the digest, the specification's path, the stage, § Lineup sets and § Scaling of this
file pasted (question 3 sizes against them, and a seat here sees this repository's 58 agents, not
Anja's 34), one line saying the product under review is the specification's and not FinalFrame (each
seat's definition, skill and memory are FinalFrame's), and the same three questions:
(1) which claims are validated, disputed, or unverifiable from the document; (2) which technical
assumptions it should not keep without a test, each written as a question the owner can answer;
(3) the expert lineup this project needs at this stage: the count, the specializations, and for
Anja's 34 shipped names (33 experts and one external-system expert, § Lineup sets below) which to keep, drop, or write new, with the reason.

Synthesis, the lean table: validated / disputed / unverifiable claims; the challenged assumptions,
each with the owner's question beside it; the lineup with its count against the scaling table
(§ Scaling); the first panel question for the new repository. Guards: the panel judges the
specification, never the product's taste, so a disputed claim is a question for the owner and not a
rewrite of his document; a lineup above the scaling table's number for the stage is a finding, not a
plan; a seat that cannot verify a claim says unverifiable, never approved. Persistence: this panel's
`### Memory Update` blocks are not saved into this repository's expert memories, and its deferrals do
not go to this repository's tracker (`/expert-review` steps 8a and 15 would do both, and its Guideline 13 appends to this repository's
manual QA plan when qa-expert is seated; each would put
another product's facts into FinalFrame's files, and § Boundaries keeps this repository's `.claude/`
tree and trackers untouched). What the panel learned about the new product goes to step 5's context
file; a lesson about running this command goes to this file's CHANGELOG.

### 3 · Put it to the owner, and wait

One readout, in his register: the specification's verdict in 2 sentences; the challenged assumptions
as numbered questions he can answer in a word; the lineup as a keep / drop / new list, name and one
line each, recommendation first. His answers settle the assumptions and go into the product context
file; his OK names the final lineup. He may strike or add.

Every one of Anja's 34 shipped names lands in keep or drop (a name in neither still ships,
unspecialised and with no memory header), and each new expert names the canon or the persona research
it is built from. Write the result to this session's working plan under `## Bootstrap lineup`: the
keep / drop / new list, his answers numbered as asked, the first panel question, and his OK in his
words. Steps 4 to 7 read that block, not the conversation, so a compaction after the OK loses nothing.

### 4 · Copy Anja (the mechanics are the guide's, not this file's)

The copy follows `docs/start-a-new-project.md` in the Anja checkout, § First run, steps 1 to 4 and 6. Read
that guide at invocation; do not work from a memory of it, since it moves with every copy commit. This
command runs those steps and records which ran:

1. **A repository first, with the one package the commit tool needs.** If `<repo>` is not a git
   repository (`git -C <repo> rev-parse --git-dir` fails), `git init` it; sub-steps 6 and 7 and
   `setup-project-memory.sh` all stop outside one. If it is one already, `git -C <repo> status
   --porcelain -- .claude .githooks scripts .agents LICENSE NOTICE CLAUDE.md .gitignore package.json
   package-lock.json` reads empty first, or the owner commits or sets aside what it lists, so every
   change step 7's commit finds under those paths is this command's. Then `npm install --save-dev
   typescript` in `<repo>` (a `package.json` is created if none exists): `scripts/safe-commit.sh`'s staged-parse gate imports it,
   and without it every commit naming a `.ts`, `.tsx`, `.mts` or `.mjs` path is refused as unparseable
   (checked in a fresh repository), which includes the copy's own scripts. Add
   `/node_modules` to `<repo>/.gitignore` in the same sub-step (no trailing slash, so a symlinked
   `node_modules` is ignored too): the copy ships only `.claude/.gitignore`, and step 7's file list is
   `git ls-files --others --modified --exclude-standard`, which otherwise carries the package (140 files, 24 MB for
   typescript 6.0.3).
2. **The copy, into existing directories without nesting.** `cp -Rn <anja>/.claude/. <repo>/.claude`,
   the same for `.githooks/` and `scripts/`, plus `LICENSE` and `NOTICE` beside the project's own
   licence. The trailing `/.` is load-bearing: `cp -Rn <anja>/.claude <repo>/.claude` on a project
   that already has a `.claude/` (or a `scripts/`) copies INTO it, `<repo>/.claude/.claude/...`, rc 0,
   nothing printed, and the project's settings never get the `hooks` block (reproduced
   on BSD cp, 2026-11-02; GNU cp untested). `-n` never overwrites the project's files, and BSD cp exits
   1 when `-n` skipped one, which is not a failure. An existing `.claude/settings.json` is then merged
   by hand, block by block, as the guide's step 1 says (`hooks`, `env`, `statusLine`, `worktree`,
   `skillOverrides`, and the `skillListingBudgetFraction` key).
3. **`CLAUDE.md`** from `docs/starters/CLAUDE.starter.md` in the checkout, every `<…>` filled from the
   specification and the panel (the product line, the stack, the source-of-truth file), its rules table
   trimmed to the rule files the owner keeps (sub-step 4). It is the router that tells each session
   which path-scoped rule files exist; without it the first session finds none of them.
4. **Take out what the guide's § What to replace or remove lists and this command owns:** the source
   project's domain experts that step 3's lineup drops, the keyword map in `trigger-index-match.sh`, the
   `applies_when:` paths that name the source project's layout. The rest of that list (the stack rule
   files, `migrations.md`, the band pins, the counts in the architecture documents, `CODEOWNERS`) is
   the owner's call, read out here with a recommendation, never done silently.
5. **`.claude/settings.json` per the guide's step 2**, which names five edits: `permissions.allow`
   (the project's own toolchain checks; a `Read(./.env)` deny), `worktree.symlinkDirectories` (to fit
   the stack), `skillOverrides` (rebuilt in step 6 from the lineup), `env` (the two optional switches),
   `statusLine`; plus the three hooks that ship unwired. This command does `skillOverrides`; the other
   four and the unwired hooks are read out as the owner's choices with the guide's own words beside each.
6. **Git hooks:** `git -C <repo> config core.hooksPath .githooks` (the guide's step 3); the `pre-push`
   hook does not ship, and whether to write one is read out.
7. **Project memory:** `.claude/project-memory/MEMORY.md` with a short index header (the copy ships no
   starter for it; the harness loads only its first 200 lines or 25 KB), then
   `scripts/setup-project-memory.sh` (the guide's step 4; read its header first, it moves any memory
   Claude Code already holds for that checkout).
8. **Self-tests** (the guide's step 6): `node scripts/skill-lint.mjs --self-test` reads 73 pass / 1 fail
   on a bare copy, the 1 being the arm that needs a skill `MEMORY*.md` and a project-memory file, both of
   which this command writes (sub-step 7, step 6), so it is green on a re-run after step 6;
   `scripts/safe-commit.sh --self-test` reads 58 pass / 0 fail once sub-step 1 installed `typescript`
   (48 / 10 without it, measured 2026-11-02 on a copy with no `node_modules`). The guide's Tools line
   names the package; its step 6 does not. The smoke suite (the guide's step 5) runs once, at the end of step 6, because it
   takes minutes.

Check: `ls <repo>/.claude/{hooks,skills,agents,rules,orchestrator}` all non-empty and
`ls <repo>/.claude/.claude <repo>/scripts/scripts` both absent (the nesting tell); the settings file
parses and holds a `hooks` block; `<repo>/CLAUDE.md` exists with no `<…>` left; `git -C <repo> config
core.hooksPath` prints `.githooks`.

### 5 · The product context file

Write `<repo>/.agents/product-marketing-context.md` from the template below, filled from the
specification, the digest, the panel's corrections and the owner's answers; ask him, in the message
text and never the blocking question box, only what those four left open, in this order: the product
in one sentence and who it is for; the business model and billing provider; the stack; the stage and
what is live; the 2 or 3 user segments; the competitors and the difference; the build philosophy; what
he is worried about right now (the first panel's question, if the panel did not already name one).
Every expert agent definition the generator writes points at this path, so its name is fixed.

```markdown
# {Product} — Product & Technical Context

*Last updated: {date}. Read this before every expert consultation, agent task or architectural decision.*

## What {Product} Is
[1-2 sentences. Who is it for? What does it do?]

## Stage
[idea / prototype / pre-launch / launched on {date}; what is live today]

## Business Model
[Pricing tiers, billing provider, credit or usage system if any. Name the file that is the source of
truth for prices and limits: if this table disagrees with the code, the code wins.]

## Tech Stack
[Table: framework, language, database, auth, AI provider, hosting, payments]

## Core Features
[Bullet list, one line each]

## Target Users
[2-3 segments: who, what they want, what frustrates them, what they pay for today]

## Competitive Landscape
[Key competitors, the difference]

## Build Philosophy
[Quality vs speed, design principles, non-negotiables]

## Assumptions the panel challenged, and the owner's answers
[One line each, dated: the assumption, the question, his answer]

## What the owner is worried about
[His words, dated. The first panel's question.]
```

Check: the file exists, every section has a line under it, and no section still holds a bracket.

### Lineup sets (what step 2 sorts, and step 3 settles)

Anja ships 33 experts and one external-system expert. They are a working example built for one product:
most are generic SaaS roles whose bodies still name that product in places, a few are that product's
domain. The lineup sorts them into three sets and adds the new product's own domain experts:

- **Keep after a read** (generic roles): read each candidate's `SKILL.md` for the source project's
  nouns (`grep -c -i -E 'photograph|finalframe|critique|source project'` is the floor; measured on the
  copy at 2026-11-02: saas-engineer 2, ux-design-pro 2, qa-expert 0, security-expert 2, uncle-bob 4,
  saas-economist 4, legal-advisor 9, prompt-engineer 6, ux-copywriter 18 lines) and rewrite the
  specialization paragraph to the new domain — § Anti-patterns, 1: a generic role is useless, a role
  specialised to this product is the whole point. Candidates: saas-engineer, saas-architect,
  security-expert, qa-expert, uncle-bob, performance-expert, devops-deploy-expert, ux-design-pro,
  web-designer, ux-copywriter, accessibility-expert, saas-economist, growth-analyst, saas-metrics-analyst,
  market-researcher, saas-launch-marketing, seo-content-strategist, user-researcher, legal-advisor,
  engagement-psychologist, launch-ops-expert, ops-monitor, ab-testing, brand-naming-expert, prompt-engineer
  (only with an AI feature), the five `haines-*` CRO experts (only with a funnel to optimise),
  frontend-developer (only on React/Next.js), context-architect (only for meta-system work).
- **Drop** (the source product's domain, or no match): ai-vision-expert unless the product reads images;
  external-fagemx-edda unless the project evaluates agent tooling. Dropping means the skill folder, the
  agent file, the generator's `EXPERTS` entry, the name's line in the generator's `READ_ONLY_EXPERTS`
  set when it has one (at 128f56b: external-fagemx-edda, the five `haines-*` experts, saas-economist,
  saas-launch-marketing and legal-advisor; read the set, it moves; a name left there with
  no `EXPERTS` entry stops the generator, rc 1, nothing written: both drops checked) and
  the `skillOverrides` line go together (step 6 checks the pairing), and so does the name in the
  Routing Rules table (out of the cell it shares; the row goes only when it names no other seat) of `.claude/skills/expert-review/SKILL.md` and in
  `.claude/skills/expert-review/references/department-directory.md`, the two files step 6 edits for the new experts (the copy's
  table seats ai-vision-expert as Always Include for AI critique quality); step 4 removes them before
  the smoke run, as the guide's § What to replace asks, and reads out what `grep -rl <name> .claude
  scripts` still lists (after the default drop: 7 files for ai-vision-expert, 5 for
  external-fagemx-edda, `scout`'s link among them).
- **Write new** (the product's own domain): at least one domain expert and one persona (§ Designing an
  expert). The stage sets the count, § Scaling: 5 at a prototype, about 12 before launch.

### 6 · Write each expert in today's shape

An expert here is five things, and the harness or a test reads each one; a template alone is none of
them. For each expert in the OK'd set:

1. **`.claude/skills/<name>/SKILL.md`**, frontmatter then body:
   ```yaml
   ---
   name: <name>
   checks: []
   applies_when:
     paths:
       - "src/billing/**"
   description: >-
     <Role> for <Product>: <what it judges, specific to this product>. Built from <the canon, the
     critics, the evidence; or the persona's research basis>. Limits: <what it cannot know>. Use when
     <trigger conditions>. Pairs with <sibling> (<for what>).
   skepticism: medium
   ---
   ```
   No comment inside the frontmatter: copied with one, `expert-checks.mjs` reads no `applies_when`
   paths (the expert is never routed) and `skill-lint` marks `checks:` unscanned, both silently (checked
   on the commented and the clean copy). The fields: `name` equals the folder name;
   `checks` lists the mechanical checks the expert owns, by path, `[]` until it owns one;
   `applies_when.paths` are the review-routing globs, a `--code` review of a change under one of them
   seats this expert (`scripts/expert-checks.mjs resolve`); `description` is what the main session reads
   when it picks an expert, so it carries the when-to-use, and for a non-external expert the generator
   copies the `EXPERTS` string, not this field, into the agent definition, so keep the two the same;
   `skepticism` is `high` for an expert that finds problems, `low` for one that finds what to add,
   `medium` otherwise. Body: § Designing an expert.
2. **`.claude/skills/<name>/MEMORY.md`**: the header only (`# <name> — Memory`, one line on what gets
   recorded, append-only, dated `## YYYY-MM-DD — Title` entries). Agents never write it; the main
   session saves each agent's `### Memory Update` block into it after a panel. **Every KEPT expert gets
   this header too**: the copy ships no memory files, and `skill-lint` reds `AGENT_SKILL_PAIRING` on
   each agent whose skill has none (33 of 33 on the dry run of 2026-11-02, before the headers).
3. **`.claude/skills/<name>/CHANGELOG.md`**: a v0.1 entry naming the brief, the research used and the
   revisit triggers.
4. **The agent definition**: add the expert to the `EXPERTS` object in
   `scripts/generate-expert-agents.mjs` (alphabetical; the value is the description string, and it IS
   the agent file's description for every name that does not start with `external-`; only for those
   does the generator read the skill's frontmatter and keep the string as a fallback), and add a persona,
   CRO, economist, marketing or legal expert to the generator's `READ_ONLY_EXPERTS` set too (its header
   derives the set from `/agent-work`'s "Never for execution" row, which names those five kinds: their
   tools narrowed, `Write` and `Edit` denied). Then `node scripts/generate-expert-agents.mjs`,
   which writes `.claude/agents/<name>.md` with the shared operating posture, the pointer to
   `_agent-primer.md`, the read-first lines for the skill and memory files, the product context path,
   and `model: inherit`. Never hand-write an agent file: the smoke suite checks the generated clauses.
5. **Hidden from the command list**: `"<name>": "user-invocable-only"` in `.claude/settings.json`
   `skillOverrides`. An expert is dispatched by the Agent tool and reads its skill by path, so it never
   needs a listing entry, and every description left in the listing costs every session's start. A
   dropped expert loses its line. Check: `node scripts/generate-expert-agents.mjs --check` exits 0
   (it also reports an agent-vs-overrides pairing violation).

Then the review routing, so a panel can find them: a row per new question type in the Routing Rules
table of `.claude/skills/expert-review/SKILL.md`, the expert in its department cluster in
`.claude/skills/expert-review/references/department-directory.md`, a lead per cluster in the Department
Leads table when the cluster has 3 or more. `scripts/expert-checks.mjs resolve <a path of the product>`
must name at least one expert for each tree the product has.

Checks, all in the new repository: `node scripts/skill-lint.mjs` names no finding on a new expert and
no `AGENT_SKILL_PAIRING` anywhere; the copy's own residue stays and is read out (measured on the copy at 128f56b
with every memory header in place: 57 findings and 1 unscanned, of which 29 are the architecture
documents' counts step 4 leaves to the owner, and 10 sit on experts a lineup keeps: security-expert's 4
rotted `checks:` paths and 6 links to `references/*-rule-map.md` the copy does not ship; fix those 10
here when the expert is kept, or say they stand; a run that follows this command reads differently:
step 4's `CLAUDE.md` removes 1 unscanned-pattern finding and each drop changes the count: its leftover
links add findings, and a dropped expert that holds one of the 10 takes it away (dropping legal-advisor
as well reads 59 and 1, its `compliance-rule-map.md` link gone with it), so the default
drop of external-fagemx-edda read 60 findings and 1 unscanned, the 3 more being architecture counts of
catalogued external systems and the 1 `scout`'s link to the dropped skill);
`node scripts/generate-expert-agents.mjs --check`
exits 0; `node scripts/expert-checks.mjs resolve <a path of the product>` names the right experts
(`list` shows only experts with a `checks:` key, 9 of 34 on the copy, so it is not the roster);
`./scripts/smoke-test-hooks.sh --only agent-definition` reads the generated agent files alone (the
section's full header differs between the copy and this repository; the substring matches both) (`--for <agent file>` refuses: no section names a new agent by basename); then the whole smoke
suite, read as the guide's step 7 says (red arms that drive files the project does not have yet are
expected; a red arm on the agent definitions is not).

### 7 · Hand over to the first session, and the first panel

The new repository's panel does not run from this session. Not because its agents cannot be loaded
(`--add-dir` and `/cd` load another directory's `.claude/agents/`, without live reload; vendor docs read
2026-11-02), but because all 34 of Anja's agent names also exist in this repository with
no documented precedence between the two sets, and because the hooks keep `CLAUDE_PROJECT_DIR` at the
starting project after a `/cd`, so the new repository's guards would not run. The hand-over is the
owner's next move, written out:

1. Commit the tree in the new repository by file list. On a repository with no commit yet
   (`git -C <repo> rev-parse --verify -q HEAD` prints nothing), make an empty root commit first,
   `git -C <repo> commit --allow-empty -m "root"`, because `scripts/safe-commit.sh` diffs the index
   against `HEAD`, and with no commit it exits 128 (`fatal: bad revision 'HEAD'`) and leaves every
   named path staged (measured 2026-11-02 on a 473-path tree; over the root commit the same call
   committed all 473, its parse gate reading 59 files clean). Then `git -C <repo> ls-files --others
   --modified --exclude-standard -- .claude .githooks scripts .agents LICENSE NOTICE CLAUDE.md .gitignore
   package.json package-lock.json` gives the paths (scoped, so an existing codebase's own untracked
   files stay out of the copy's commit; `--modified` because an existing codebase's `.gitignore` and
   `package.json` are tracked, and the lines sub-step 1 adds to them are modifications that `--others`
   alone leaves out: a later check ran it, the commit landed without `/node_modules` and a worktree made
   from it listed the symlinked `node_modules`). A modified file needs `--del N`, N the deletions
   column of `git -C <repo> diff --numstat` (npm's comma after the last key counts as 1), and `scripts/safe-commit.sh` (in the copy) takes them one per
   argument, since it refuses a directory path. In a session opened in the new repository the first
   commit-shaped call is refused once by the commit doctrine, by design, and goes through on the
   re-issue; from a terminal it is not refused. The copy's `pre-commit` tsc gate prints an INSTRUMENT
   FAILURE block (tsc's help text) on that commit, because the copy ships no `tsconfig.json`; it is
   warn-mode and the commit lands.
2. Open Claude Code in the new repository. Its session-start hooks run; `/orient` reads the trackers the
   guide's § What you supply names, which may not exist yet, and says so.
3. Type `/expert-review --lean <the first panel question from step 2's synthesis>`. A 3-expert panel on
   one narrow question: one domain expert, one persona, one engineering or business role, whichever the
   question needs. Read the result against § Quality markers; a panel where all three agree in the same
   words has a lineup problem, not a product answer.
4. Save each `### Memory Update` block into its expert's `MEMORY.md`; fold what the panel taught into
   the expert files as v0.1.x patches, each citing the panel (the `/meta new-skill` calibration step is
   the same discipline, one expert at a time).

The readout to the owner at the end of step 6 is those four lines plus the paths written, in his
register, with nothing it did not verify.

## Designing an expert (the April method, kept)

**Research before writing** (for a domain expert; a persona built from in-house research skips it):
3-5 searches for the canonical positions, 2-3 for the critics (load-bearing: the critics say when the
expert must NOT fire), one primary source fetched for voice. Adapt, never copy: a "UX expert" is useless,
a "UX expert for creative SaaS tools used by photographers" was the whole value.

**A domain expert's body**, after the frontmatter: a one-paragraph identity (who, what credibility, what
this product needs from them); *Before starting* (read `.agents/product-marketing-context.md`);
*Boundaries, what I don't cover* (3-5 lines, each pointing at the sibling that does); 2-4 sections of
the expert's own knowledge as checklists, frameworks and the numbers they judge by; *Key files to read*
(the product's files this expert always opens); *Output*: the Required Output Format in
`.claude/agents/_agent-primer.md` and the agent definition (verdict, confidence, scope, assessment,
recommendation, trade-offs, memory update). Target 180-280 lines; a persona 120-180.

**A persona's body**: *Before starting* (the product context); *Boundaries* (technical and business
questions go to the experts); *Who this is* (the segment and the research it rests on); *Meet {Name}*
(a full name, age, place, occupation, 2-3 paragraphs: daily life and where the product fits, skill and
tools, what frustrates them today, how they spend); *How {Name} evaluates {Product}* (what matters most,
what makes them pay, what makes them leave, their language, which is never the product's jargon). A
persona answers AS the person. "A typical user" is worthless; "Dana Reyes, 38, Portland, project
manager, shoots a mirrorless camera on weekends" is a person whose reactions you can predict.

**A CRO expert** (the Haines shape, one per funnel stage) keeps a named persona with a voice, a boundary
line to the neighbouring stage, and three sections: the stage's metrics, its failure patterns, its
checklist.

**The contrarian**: a panel of 5 or more seats one, and never a high-skepticism expert (they already find
problems; a contrarian is a constructive expert made to argue the other side).

## Quality markers of a working system

Working: experts disagree with each other; findings name files, lines and exact copy; the synthesis
surfaces trade-offs, not a list of approvals; personas say things the founder would not have thought of;
engineering finds what UX missed and the reverse. Needs work: near-identical APPROVED verdicts, or any unanimous verdict or recommendation (phantom
consensus); vague findings ("consider improving the UX"); experts drifting into each other's domains;
personas that sound like the founder; a synthesis with no disagreement in it.

## Scaling

| Stage | Lineup | Count |
|---|---|---|
| Idea or prototype | saas-engineer, ux-design-pro, security-expert, 1 domain expert, 1 persona | 5 |
| Pre-launch | + performance-expert, ux-copywriter, 2 CRO stages, legal-advisor, qa-expert, a second persona | 12 |
| Growth | + saas-metrics-analyst, growth-analyst, community or email lifecycle, accessibility-expert | 17 |
| Mature | + market-researcher, saas-launch-marketing, API, i18n, trust & safety | 22+ |

Do not create experts you will not use: each one's product references and file paths go stale, and 10
maintained experts beat 40 with outdated information. The source project reached 58 over seven months,
one at a time, each on a measured gap (`/meta new-skill`).

## Anti-patterns

1. **Generic experts.** Specialise every one to the product's domain.
2. **No boundaries.** An expert that does not know what it does not cover drifts and duplicates findings.
3. **Personas without specifics.** See § Designing an expert.
4. **A panel orchestrator without routing rules.** Without the table mapping question types to experts,
   panel selection is arbitrary; Anja ships the table, step 6 extends it.
5. **No required output format.** Without it, synthesis degrades to cherry-picked quotes; the primer and
   the generated agent definition carry it.
6. **No contrarian** on a panel of 5 or more.

## Boundaries

- **Owner-invoked, on a brief that names a repository that is not this one.** FinalFrame's system
  exists; one more expert here is `/meta new-skill`.
- **Runs from this repository.** Step 2 seats this roster; the new repository's own panel runs in a
  session opened there (step 7 says why: name collisions between the two agent sets, and hooks pinned to
  the starting project). A session opened in the new repository can run steps 4 to 7 after the copy,
  never step 2.
- **Writes the new repository only**, plus this session's working plan and step 1's digest in the
  scratchpad. It never pushes the new
  repository, never creates a remote, never runs the smoke suite more than once, and never touches
  this repository's `.claude/` tree, settings or trackers.
- **The guide owns the mechanics.** Step 4 runs Anja's own first-run steps and records which ran; where
  this file and the guide differ on a mechanical step, the guide in the checkout wins, and this file is
  corrected.
- **The Anja copy of this file is older than this one until `/anja-copy move` ports it** (the base
  moves only on the owner's word). Run from the source repository, this command uses this file; a
  session opened in the new repository finds the copy's version until the port.

## Revisit

- The first real run (a product that is not FinalFrame): measure which of steps 1-7 the owner had to
  correct, and fold each correction into the step, not into a note beneath it.
- If Anja's guide gains its own "set up the experts" section, § Lineup sets and step 6 point at it and shrink.
- If the harness documents which of two same-named loaded agents wins, and `/cd` sets
  `CLAUDE_PROJECT_DIR` to the directory it moves to, step 7 can move into this command (both: either
  alone leaves the other reason standing, and the vendor's `/cd` already runs the target's hooks).
- An idea on record: Anja's own spec-first bootstrap, run inside the user's repository.
  If it is built, this command stays the source-side version and the port inherits this file's
  corrections; its first real run on a product that is not FinalFrame goes first.
