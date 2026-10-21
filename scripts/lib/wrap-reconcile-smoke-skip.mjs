// Which wrap-reconcile probes a SMOKE FIXTURE may skip — pure, so its guard is unit-testable
// without running wrap-reconcile's probes.
//
// Why it exists: the post-compact arm of scripts/smoke-test-hooks.sh drives wrap-reconcile past its
// transcript gate twice to assert the finding, and each pass ran the step-7h defer-trigger
// scan, whose one `git blame` of its input file takes 25.5 s of the scan's 30.2 s on a full clone. In CI
// that job checks out a BLOBLESS partial clone (`filter: blob:none`, added 2026-09-01),
// so the blame has to fetch each historical version of that file on demand.
// Timed from the CI job logs: this arm's section took 23-25 s in the last two runs before that
// setting (2026-09-01) and 35 minutes in the first run after it, 103 minutes by 2026-09-14, and no
// commit in between touched wrap-reconcile.mjs or defer-trigger-scan.py. The per-blob fetch is the
// inferred mechanism; the timing is measured. The arm asserts the marker, not the triggers, so the
// scan was pure cost there. A real /wrap or /triggers runs on a full clone and does not pay it.
//
// The guard: a skip list is honoured ONLY for a session id beginning `zzsmoke-`, which no real
// Claude Code session carries (real ids are UUIDs), so the env var leaking into a real /wrap does
// nothing. wrap-reconcile reports every skipped probe in blind[] (so the verdict is BLIND, never
// CLEAN) and in a `skipped` id list, and flags a skip id that matched no probe or more than one.
//
// Naming, stated as a choice: house fixture overrides are `FF_*` and ship without a session guard
// (`FF_FAKE_COMMITS` is the precedent). This is stricter on purpose — a switch that makes a CERTIFYING
// tool check less must not be reachable from a real session — and the price is the coupling to the
// `zzsmoke-` literal, which smoke-test-hooks.sh documents where it chooses the fixture id.
const SMOKE_SID_PREFIX = "zzsmoke-";

export function smokeSkippedProbes(sid, raw) {
  if (!String(sid || "").startsWith(SMOKE_SID_PREFIX)) return new Set();
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
