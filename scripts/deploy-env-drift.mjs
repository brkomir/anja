#!/usr/bin/env node
/**
 * deploy-env-drift.mjs — read-only. Answers ONE question no other instrument here asks:
 *
 *     Is every production env value actually LIVE, or is a redeploy still pending?
 *
 * WHY THIS EXISTS (a staleness sweep of the top-priority backlog). Several top-priority
 * entries were stale, most of them for the same reason — the blocker cleared
 * OUTSIDE the repo, and nothing we run reads that surface:
 *
 *   a backlog entry asked for a production env value that had already been set
 *   a backlog entry said "one redeploy" — the deploy had already landed
 *   a tracker row sat open days behind that same already-landed deploy
 *
 * Every sweep we own reads FILES — git log, the trackers, /triggers. A deploy and an
 * env write are not files, so a row gated on either stays open until a human happens to look.
 * This is the "happens to look" made mechanical. It is a REPORTER, never a gate: the shape of
 * the defect is a row nobody re-read, not a change anybody should be blocked from making.
 *
 * ⛔ USE `--json` AND READ `updatedAt`. The HUMAN `vercel env ls` column is the CREATION date —
 * an in-place `--force` rewrite leaves it untouched, which is why an earlier tracker note
 * records "age cannot date a value" as a dead end. Through --json it CAN. Measured on a
 * production env var:
 *     createdAt = first creation · updatedAt = the real rewrite · human column = age since creation
 * On a variable rewritten in place, the human column and the real write time can sit far apart.
 *
 * EXIT CODES — instrument failure lands on the FAILING side (bash-environment.md):
 *   0  ran, verdict printed (drift or clean — this is a reporter, not a gate)
 *   1  --strict AND a redeploy is pending
 *   2  INSTRUMENT FAILURE — vercel unreachable, not logged in, unparseable JSON.
 *      Never read a 2 as clean; nothing was measured.
 *
 * Callers key on the VERDICT TOKEN (DEPLOY-ENV: PENDING-REDEPLOY | ALL-LIVE), never on rc==0.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const STRICT = process.argv.includes("--strict");
// The production domain is the ONLY handle on "what is serving" (see the resolution
// block below).
// ⛔ THE FLAG MOVES ONE READ OF THREE, AND THE COMMENT HERE USED TO CLAIM OTHERWISE.
// It said the flag exists "so the tool is not welded to one project" — FALSE:
// `vercel ls` and `vercel env ls` both take the LINKED project from
// .vercel/project.json and ignore --domain entirely. Pointing it at another project's
// domain would compare THAT project's serving build against THIS project's env vars and
// fire a spurious rollback notice. A documented path to a silently wrong verdict, in
// --help. Guarded below by asserting the resolved deployment belongs to the linked
// project. The flag is required: the domain is the only handle on what is serving, and
// there is no default to fall back on.
const domArg = process.argv.find((a) => a.startsWith("--domain="));
const domIdx = process.argv.indexOf("--domain");
const DOMAIN = domArg
  ? domArg.slice("--domain=".length)
  : domIdx !== -1
    ? process.argv[domIdx + 1]
    : "";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "usage: node scripts/deploy-env-drift.mjs [--strict] --domain <host>\n" +
      "  Reports whether any production env var was written AFTER the last production deploy.\n" +
      "  --domain  the production hostname whose serving deployment to inspect (required)\n" +
      "  --strict  exit 1 when a redeploy is pending (default: report and exit 0)\n" +
      "  Read-only. Exit 2 means the instrument failed and NOTHING was measured.",
  );
  process.exit(0);
}

const fail = (msg) => {
  console.error(`DEPLOY-ENV: INSTRUMENT-FAILURE — ${msg}`);
  console.error("Nothing was measured. Do not read this as clean.");
  process.exit(2);
};

async function vercelJson(args, label) {
  let stdout;
  try {
    ({ stdout } = await run("vercel", args, { maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    fail(`\`vercel ${args.join(" ")}\` failed (${label}): ${String(e.message).slice(0, 200)}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    fail(`\`vercel ${args.join(" ")}\` returned unparseable JSON (${label})`);
  }
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ageHours = (ms) => ((Date.now() - ms) / 36e5).toFixed(1);

/** The whole verdict, isolated so BOTH branches are exercisable without a real deploy. */
export const pendingAfter = (deployAt, written) =>
  written.filter((e) => e.at > deployAt).sort((a, b) => b.at - a.at);

/**
 * Shape-validate an `inspect --json` payload. Extracted so the SERVING-resolution logic
 * the fold added is self-testable — it had ZERO arms while --self-test still printed
 * "4/4 PASS", which reads as covered.
 * Returns null when usable, else the reason string for fail().
 */
export const inspectProblem = (dep, domain, linkedProject) => {
  if (typeof dep?.createdAt !== "number")
    return `\`vercel inspect ${domain} --json\` returned no numeric createdAt — cannot date the serving build`;
  if (String(dep.readyState ?? "").toUpperCase() !== "READY")
    return `the deployment serving ${domain} is ${dep.readyState} — refusing to compare against a build that is not READY`;
  // The --domain guard: the other two reads are project-linked, so a cross-project
  // domain must refuse rather than silently compare unrelated things.
  if (linkedProject && dep.name && dep.name !== linkedProject)
    return `--domain ${domain} resolves to project "${dep.name}" but the linked project is "${linkedProject}" — the env and deployment-list reads are project-linked and would compare unrelated things`;
  return null;
};

/**
 * The --domain value, refused unless it is a hostname. A placeholder left in a copied command
 * (`"<your production domain>"`) or a flag read as the value (`--domain --strict`) would otherwise
 * reach `vercel inspect`, cost a network call, and fail blamed on the CLI.
 * Returns null when usable, else the reason string.
 */
export const domainProblem = (d) => {
  if (!d) return "pass --domain <host> (the production hostname to inspect)";
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(d)) return null;
  return `--domain "${d}" is not a hostname: a placeholder left in the command, or a flag read as its value. Pass your production hostname`;
};

if (process.argv.includes("--self-test")) {
  const D = Date.parse("2026-09-05T18:00:27Z");
  const before = [
    { key: "OLD_A", at: Date.parse("2026-07-03T12:23:00Z") },
    { key: "OLD_B", at: Date.parse("2026-09-05T17:59:00Z") }, // 87s before the deploy
  ];
  const after = [...before, { key: "NEW_C", at: Date.parse("2026-09-06T09:42:21Z") }];
  const cases = [
    ["ALL-LIVE branch reachable", pendingAfter(D, before).length, 0],
    ["PENDING branch reachable", pendingAfter(D, after).length, 1],
    ["names the right var", pendingAfter(D, after)[0]?.key, "NEW_C"],
    // the boundary is the whole predicate: a var written in the same second as the
    // deploy is NOT pending (a deploy reads env at build start, so ties go to live)
    ["tie is not pending", pendingAfter(D, [{ key: "TIE", at: D }]).length, 0],
    // ── SERVING-RESOLUTION ARMS. The fold that added that logic shipped with ZERO
    //    arms while this block still printed "4/4 PASS", which reads as covered.
    ["inspect: healthy payload passes",
      inspectProblem({ createdAt: D, readyState: "READY", name: "<project-name>" }, "d", "<project-name>"), null],
    ["inspect: ISO-string createdAt refuses",
      /no numeric createdAt/.test(inspectProblem({ createdAt: "2026-09-05T18:00:27Z", readyState: "READY" }, "d", null) ?? ""), true],
    ["inspect: missing createdAt refuses",
      /no numeric createdAt/.test(inspectProblem({ readyState: "READY" }, "d", null) ?? ""), true],
    ["inspect: non-READY refuses",
      /is not READY|is BUILDING/.test(inspectProblem({ createdAt: D, readyState: "BUILDING" }, "d", null) ?? ""), true],
    ["inspect: renamed readyState refuses (fails CLOSED)",
      inspectProblem({ createdAt: D, state: "READY" }, "d", null) !== null, true],
    ["--domain cross-project refuses",
      /linked project/.test(inspectProblem({ createdAt: D, readyState: "READY", name: "other-proj" }, "d", "<project-name>") ?? ""), true],
    ["same project passes",
      inspectProblem({ createdAt: D, readyState: "READY", name: "<project-name>" }, "d", "<project-name>"), null],
    ["unlinked repo does not block",
      inspectProblem({ createdAt: D, readyState: "READY", name: "anything" }, "d", null), null],
    // ── the --domain contract, checked before any network read
    ["domain: missing refuses", domainProblem(undefined) !== null, true],
    ["domain: the skills' placeholder refuses", domainProblem("<your production domain>") !== null, true],
    ["domain: a flag read as the value refuses", domainProblem("--strict") !== null, true],
    ["domain: a hostname passes", domainProblem("app.example.com"), null],
  ];
  let bad = 0;
  for (const [name, got, want] of cases) {
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  got=${got} want=${want}`);
  }
  console.log(bad ? `\nSELF-TEST: ${bad} of ${cases.length} FAILED` : `\nSELF-TEST: ${cases.length}/${cases.length} PASS`);
  process.exit(bad ? 1 : 0);
}

// The self-test above needs no domain; every real read below does.
const domProblem = domainProblem(DOMAIN);
if (domProblem) {
  console.error(`DEPLOY-ENV: INSTRUMENT-FAILURE — ${domProblem}. Nothing was measured.`);
  process.exit(2);
}

// ── the SERVING production deployment, resolved by DOMAIN ───────────────────
// ⛔ NOT "the newest READY build". Those are different questions and they diverge
// under a ROLLBACK or a promote, where an OLDER deployment is the one serving. The
// first version of this script took max(createdAt) over `vercel ls --prod --json`
// and would then have compared env writes against a build nobody is running —
// reporting ALL-LIVE while the serving build predates the env writes. Silent, and
// wrong in the reassuring direction.
//
// Raised in review as the top item, CONFIRMED here
// rather than taken on trust: `vercel ls --prod --json` deployment objects carry
// exactly [buildingAt, createdAt, creator, meta, name, ready, state, target, url] —
// measured 2026-09-07, five rows, every one `state=READY target=production`. There is
// NO alias field, no aliasAssigned, no serving marker of any kind, so that listing
// CANNOT answer which deployment is live. `vercel inspect <domain> --json` can.
let linkedProject = null;
try {
  linkedProject = JSON.parse(readFileSync(".vercel/project.json", "utf8")).projectName ?? null;
} catch {
  /* not linked, or no read access — the guard below simply does not fire */
}

const dep = await vercelJson(["inspect", DOMAIN, "--json"], `serving deployment for ${DOMAIN}`);
const problem = inspectProblem(dep, DOMAIN, linkedProject);
if (problem) fail(problem);
const deploy = { at: dep.createdAt, url: dep.url ?? "", id: dep.id ?? "" };

// Cross-check: is the serving build ALSO the newest one? A divergence is a rollback
// (or a promote of an older build) and is worth naming — it is not an error.
// ⛔ MUST NOT use vercelJson() here — that helper calls fail(), which process.exit(2)s,
// so a hiccup in this OPTIONAL cross-check would kill a run whose load-bearing read had
// already succeeded. Read it non-fatally instead.
let rollbackNote = "";
let servingSha = "";
try {
  const { stdout: lsOut } = await run("vercel", ["ls", "--prod", "--json"], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const lsRaw = JSON.parse(lsOut);
  const rows = (Array.isArray(lsRaw) ? lsRaw : (lsRaw.deployments ?? [])).filter(
    (d) => String(d.state ?? d.readyState ?? "").toUpperCase() === "READY",
  );
  // Free identity for the serving build — it is in rows we already fetched.
  const mine = rows.find((d) => (d.url ?? "") === deploy.url);
  servingSha = (mine?.meta?.githubCommitSha ?? "").slice(0, 9);
  const all = rows.map((d) => d.createdAt ?? d.created).filter((n) => typeof n === "number");
  const newest = all.length ? Math.max(...all) : null;
  if (newest && newest > deploy.at) {
    // ⛔ STATE THE OBSERVATION, NOT THE CAUSE. "Rollback in effect" is an
    // inference; a pending promotion or a build that just went READY produces the
    // same reading.
    rollbackNote =
      `\n⚠️ THE SERVING BUILD IS NOT THE NEWEST — serving ${iso(deploy.at)}, newest READY ` +
      `production build ${iso(newest)}. A rollback, a pending promotion, or a build that ` +
      `just finished all read this way. Everything below is measured against what is ` +
      `SERVING, which is correct either way.`;
  }
} catch (e) {
  // ⛔ SILENCE IS NOT A DISPOSITION (this repo's own principle, stated one path
  // over). An empty note used to be byte-identical to "the serving build IS the newest",
  // while both call-site specs promise the tool names a divergence.
  rollbackNote =
    `\n⚠️ NEWEST-BUILD CROSS-CHECK DID NOT RUN — \`vercel ls --prod --json\` failed ` +
    `(${String(e.message).slice(0, 90)}). The SERVING read above stands; what is NOT ` +
    `established is whether a newer build exists.`;
}

// ── production env vars, keyed on the REAL write time ────────────────────────
const eRaw = await vercelJson(["env", "ls", "production", "--json"], "env");
const envs = (Array.isArray(eRaw) ? eRaw : (eRaw.envs ?? [])).filter((e) => e && e.key);
if (!envs.length) fail("production env listing came back empty — that is not a real reading");

// ⛔ COUNT THE TWO DATE SOURCES SEPARATELY. This used to take `updatedAt ?? createdAt`
// and then label the total "(updatedAt present)" — asserting more than the filter
// computed. If Vercel ever drops updatedAt on some rows, a --force-rewritten
// var dated by its stale createdAt reads OLD and lands on ALL-LIVE: wrong in the
// reassuring direction, the same class as the finding this file already folds.
// Dead today at 73/73, so it rests on unpinned vendor behaviour — hence fail-closed.
const withUpdated = envs.filter((e) => typeof e.updatedAt === "number");
const fallbackOnly = envs.filter(
  (e) => typeof e.updatedAt !== "number" && typeof e.createdAt === "number",
);
const undatable = envs.filter(
  (e) => typeof e.updatedAt !== "number" && typeof e.createdAt !== "number",
);
if (undatable.length) {
  fail(
    `${undatable.length} of ${envs.length} production env var(s) carry NO usable timestamp ` +
      `(${undatable.slice(0, 3).map((e) => e.key).join(", ")}…) — cannot decide whether they predate the deploy`,
  );
}

const written = envs
  .map((e) => ({
    key: e.key,
    at: typeof e.updatedAt === "number" ? e.updatedAt : e.createdAt,
    type: e.type ?? "?",
    dated: typeof e.updatedAt === "number" ? "updatedAt" : "createdAt",
  }))
  .filter((e) => typeof e.at === "number");

// ⛔ EMPTY GUARD, AND IT IS AN rc CONTRACT BUG, NOT A TIDY-UP (verified by
// mutation: unguarded + empty `written` exits 1 with ZERO verdict tokens, and 1 is this
// file's documented --strict PENDING code — instrument failure landing on the PASSING
// side of the contract stated in this header. Guarded it exits 2. Reachable if the CLI
// ever emits those timestamps as ISO strings.)
if (!written.length) {
  fail("no production env var carried a numeric timestamp — the date shape changed under us");
}

const pending = written.filter((e) => e.at > deploy.at).sort((a, b) => b.at - a.at);

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`# deploy-env-drift — ${new Date().toISOString().slice(0, 10)}`);
console.log(
  `\nSERVING production deploy (${DOMAIN}): ${iso(deploy.at)}  (${ageHours(deploy.at)}h ago)` +
    `${servingSha ? `  ${servingSha}` : ""}${deploy.url ? `  ${deploy.url}` : ""}`,
);
if (rollbackNote) console.log(rollbackNote);
console.log(
  `production env vars read: ${envs.length} — ${withUpdated.length} dated by updatedAt` +
    (fallbackOnly.length ? `, ⚠️ ${fallbackOnly.length} by createdAt FALLBACK (a rewrite would read stale)` : ""),
);

if (pending.length) {
  console.log(`\nDEPLOY-ENV: PENDING-REDEPLOY — ${pending.length} var(s) written AFTER that deploy`);
  console.log("These values are stored but NOT live. NEXT_PUBLIC_* are baked at BUILD, so they");
  console.log("need a rebuild, not just a restart.\n");
  for (const p of pending) console.log(`   ${p.key.padEnd(38)} ${p.type.padEnd(10)} ${iso(p.at)}`);
  console.log("\nA tracker row saying 'waiting on a redeploy' is CURRENT.");
  if (STRICT) process.exit(1);
} else {
  const newest = written.reduce((a, b) => (a.at > b.at ? a : b));
  console.log(`\nDEPLOY-ENV: ALL-LIVE — every production env value predates the serving deploy`);
  console.log(`   newest env write: ${newest.key} at ${iso(newest.at)} (${newest.dated})`);
  console.log("\n⚠️ So any row still saying 'waiting on a redeploy' or 'pending an env flip' is");
  console.log("   STALE — the deploy above already carried it. Re-read those rows before quoting.");
  // A limitation the output did not state.
  console.log("\n   SCOPE: ALL-LIVE means nothing was WRITTEN since that deploy. A var DELETED");
  console.log("   after it is undetectable here by construction, so this is not a claim that the");
  console.log("   deployment's baked env matches the store.");
}
