#!/usr/bin/env bash
set -euo pipefail

# ─── Local integration test runner ────────────────────────────────────────────
# Spins up a fresh Postgres, applies migrations, runs tests, tears down.
# Ports 5433-5437 — parallel runs pick the first free port so two sessions
# can run side-by-side without Docker-DB contention. Does NOT collide with e2e
# tests (port 5499).
#
# Usage:
#   npm run test:integration          # run all integration tests
#   npm run test:integration -- -t "referral"     # filter tests (vitest 4: -t, NOT --grep,
#                                                 # which CACErrors AFTER Postgres is up)

DB_USER="test"
DB_PASS="test"
DB_NAME="app_test"

# ── Docker reachability gate (2026-08-21, measured false-green) ──────────────
# Without this, a down daemon (colima stopped) printed the connect failure,
# collected ZERO tests, ran the EXIT trap, and exited 0 — so any gate reading
# rc==0 certified a suite that never ran. The TELL was the ABSENCE of a
# "Test Files"/"Tests" counts line, which nothing downstream checked. Fail
# LOUD and non-zero before any port-picking or teardown trap is armed.
if ! docker info >/dev/null 2>&1; then
  printf "\033[31m%s\033[0m\n" "integration-test: Docker daemon UNREACHABLE (is colima running? try: colima start) — refusing to exit 0 over an unrun suite" >&2
  exit 1
fi

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

# ── Ownership handles + cleanup on exit (declared BEFORE the port loop so a container created
#    there is covered by the trap from the first moment it exists) ──────────────────────────────
CONTAINER_ID=""                      # set by a successful `docker create` — the ONLY handle cleanup() removes by
CONTAINER_NAME=""
RUN_TOKEN="$$-$(date +%s)"           # per-run label: finds a container a signal mid-create left behind
ACL_SNAPSHOT_FILE=""
cleanup() {
  # Remove ONLY the container THIS run created — by ID (unique), never by name (reusable). The
  # previous ownership flag was a fact about the past while `docker rm -f -v $NAME` acted on
  # whoever held the name NOW, and it was measured deleting a PEER's live
  # database by two routes (a peer's age sweep; an OOM-killed postgres swept as Exited, the port
  # re-taken, then this trap firing on "connection refused"). The run-token label covers the one
  # case the ID cannot: a signal while `docker create` was in flight.
  local ids
  ids=$(docker ps -aq --filter "label=ff.run_token=${RUN_TOKEN}" 2>/dev/null || true)
  if [ -n "${CONTAINER_ID:-}" ] || [ -n "$ids" ]; then
    green "Stopping test Postgres (${CONTAINER_NAME:-<unnamed>})..."
    [ -n "${CONTAINER_ID:-}" ] && { docker rm -f -v "$CONTAINER_ID" &>/dev/null || true; }
    [ -n "$ids" ] && { printf '%s\n' "$ids" | xargs -r docker rm -f -v &>/dev/null || true; }
  fi
  [ -n "$ACL_SNAPSHOT_FILE" ] && rm -f "$ACL_SNAPSHOT_FILE" "$ACL_SNAPSHOT_FILE.err"
  return 0
}
trap cleanup EXIT

# ── Pre-port-pick zombie sweep ────────────────────────────────────────────────
# Defense-in-depth for EXIT trap not firing on SIGKILL/OOM/power-loss: orphans
# accumulate over days, hold their ports, and starve resources. Sweep runs
# BEFORE port-picking so a zombie's port becomes reclaimable for this session.
# `{{.RunningFor}}` renders as "2 hours ago" / "About an hour ago" / "3 days ago";
# matching hour|day|week|month catches >=~1h while excluding "N minutes ago".
# Normal runs are 3-15 min; >1h means parent is dead or run is hung.
# Evidence: 2026-04-19 a full-suite run took 70 min vs normal
# 3-5 min with 5 zombies present (ff-integration-db-5433 up 2 days, etc).
# Running containers: ownership by LIVENESS, never by age (at
# exactly 60 min `{{.RunningFor}}` reads "About an hour", and the old hour|day|week|month arm
# force-removed a LIVE peer's database). A container this script creates carries ff.owner_pid /
# ff.owner_host labels and is removed only when that pid is dead on THIS host. An unlabeled
# container (created before the labels existed) keeps an age rule, raised to >= 6 h.
docker ps --filter "name=^ff-integration-db-" --filter "status=running" --filter "status=created" \
  --format '{{.ID}}|{{.Label "ff.owner_pid"}}|{{.Label "ff.owner_host"}}|{{.Label "ff.owner_start"}}|{{.RunningFor}}' 2>/dev/null \
  | while IFS='|' read -r cid opid ohost ostart age; do   # '|', not tab: tab is IFS whitespace, so an EMPTY label field is collapsed and the fields shift
      if [ -n "$opid" ]; then
        [ "$ohost" = "$(hostname)" ] || continue        # another host's container: not ours to judge
        if [ -n "$ostart" ]; then                          # owner alive AND the same process (not a reused pid)
          [ "$(ps -o lstart= -p "$opid" 2>/dev/null)" = "$ostart" ] && continue
        else                                               # pre-owner_start label set: pid liveness only
          ps -p "$opid" >/dev/null 2>&1 && continue        # ps, not kill -0: EPERM on another UID is not "dead"
        fi
        docker rm -f -v "$cid" &>/dev/null || true       # owner dead: an orphan
      else
        case "$age" in
          *day*|*week*|*month*|[6-9]\ hours*|[1-9][0-9]\ hours*) docker rm -f -v "$cid" &>/dev/null || true ;;
        esac
      fi
    done || true
docker rm -f -v ff-integration-db &>/dev/null || true  # pre-parallel legacy name
STALE=$(docker ps -aq --filter "name=^ff-integration-db-" --filter "status=exited" 2>/dev/null || true)
[ -n "$STALE" ] && docker rm -v $STALE &>/dev/null || true

# ── Pick the first free port in the pool ──────────────────────────────────────
# Session A claims 5433, session B auto-picks 5434, etc. Container name is
# scoped to the chosen port so parallel sessions never stomp each other.
# A port is taken only when it is free AND no container (running OR exited) holds
# the port-keyed name — and the container is CREATED inside the loop, so the name is
# reserved the moment the port is chosen (the check-then-create race is retried below).
DB_PORT=""
for port in 5433 5434 5435 5436 5437; do
  lsof -iTCP:$port -sTCP:LISTEN &>/dev/null && continue
  [ -n "$(docker ps -aq --filter "name=^ff-integration-db-${port}$" 2>/dev/null)" ] && continue
  CONTAINER_NAME="ff-integration-db-${port}"
  # `docker create`, then `docker start`: a successful create means the
  # NAME is ours and cleanup() can remove the container by ID even if `start` fails. `docker run`
  # reserved the name at create and a start failure (port allocated, OCI/shim under memory
  # pressure) left a Created container nothing swept, burning the port for every later run.
  CREATE_ERR=$(mktemp)
  if CONTAINER_ID=$(docker create --name "$CONTAINER_NAME" \
        --label "ff.owner_pid=$$" --label "ff.owner_host=$(hostname)" --label "ff.owner_start=$(ps -o lstart= -p $$)" --label "ff.run_token=${RUN_TOKEN}" \
        -p ${port}:5432 \
        -e POSTGRES_USER=${DB_USER} -e POSTGRES_PASSWORD=${DB_PASS} -e POSTGRES_DB=${DB_NAME} \
        postgres:16-alpine -c max_connections=200 -c fsync=off 2>"$CREATE_ERR"); then
    rm -f "$CREATE_ERR"; DB_PORT=$port; break
  fi
  # The race the free-port check cannot close: a peer created the same name between
  # our check and our create. Docker says so; take the next port instead of dying rc=125.
  if grep -q -F 'is already in use' "$CREATE_ERR"; then
    yellow "integration port ${port}: taken by a peer between check and create — trying next"
    rm -f "$CREATE_ERR"; CONTAINER_ID=""; CONTAINER_NAME=""; continue
  fi
  cat "$CREATE_ERR" >&2; rm -f "$CREATE_ERR"; exit 1
done
if [ -z "$DB_PORT" ]; then
  echo "No free port in 5433-5437 — a container holds each name? Run: docker ps -a --filter 'name=^ff-integration-db-' (-a: a Created or Exited container holds its name too) and clean up." >&2
  exit 1
fi

DB_URL="postgres""ql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}"

# Pre-harness column-ACL snapshot (see the dump block after "Migrations applied").
# No pre-run `docker rm -f` of our chosen name: the port loop above refuses a held name and
# creates the container itself; an unconditional rm here was the second way a run could delete
# a PEER session's database.
green "Using port ${DB_PORT} (container: ${CONTAINER_NAME})"

# ── Start fresh Postgres ──────────────────────────────────────────────────────
green "Starting test Postgres on port ${DB_PORT}..."
docker start "$CONTAINER_ID" >/dev/null   # created in the port loop above (with its -c flags)
# fsync=off: this database is thrown away at
# exit, so crash durability buys nothing and forcing every commit to disk only costs time.
# ⚠️ The -51% is NOT a reading of this line: the A/B behind it ran THREE knobs
# (fsync=off, synchronous_commit=off, full_page_writes=off) on
# 3 of the suite's files (201 tests, serial, one DB): tests phase 27.5 s -> 13.2 s, 201/201 both arms.
# fsync=off alone is unmeasured; the first CI run after the push gives its reading against the
# last CI run before it. Never copy this to a database whose contents must survive a crash.
# max_connections=200 (default 100): vitest's parallel workers (~6-8) × postgres
# pool (max:3 per worker) × in-test transactions can briefly peak above the
# default ceiling during clearAllTables() bursts. ⚠️ The bump did NOT eliminate
# the `write CONNECT_TIMEOUT localhost:5433` flake class (first seen 2026-05-25;
# OCCURRENCE 2 on 2026-08-22 with
# this setting live) — and the causal story above is likely the wrong axis:
# measured concurrency is ~20 connections against 200 slots, and slot
# exhaustion REFUSES ("too many clients") rather than hanging; CONNECT_TIMEOUT
# is the backend fork queueing past the client window under container CPU/IO
# starvation during the burst. Discriminator: grep the container's docker logs on the NEXT
# failing full run before teardown. No memory/CPU impact at idle; each unused
# connection slot is ~few KB. Single source of truth — e2e uses port pool
# 5495-5499 in a separate script (scripts/e2e-local.sh).

# Wait for healthy
for i in $(seq 1 30); do
  if PGPASSWORD=${DB_PASS} psql -h localhost -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -c "SELECT 1" &>/dev/null; then
    break
  fi
  [ "$i" = "30" ] && { echo "Postgres failed to start"; exit 1; }
  sleep 1
done

# ── Stub Supabase auth ────────────────────────────────────────────────────────
# ⛔ BOTH PostgREST ROLES, AND THEY MUST EXIST BEFORE THE MIGRATION APPLY BELOW.
# Every anon-side statement in the migrations sits behind
# `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')` (a portability
# pattern). With the role absent those guards are FALSE for the whole apply, so
# no anon grant can exist to find and every anon leg of the column-ACL leak test
# reads clean for a reason unrelated to any REVOKE — a vacuous pass, which that
# test discloses through a pin on the roles it probes rather than hiding it.
# Real cost of the role's absence: without the `anon` role this suite cannot
# see any anon grant at all, so it cannot tell whether one exists.
# ⚠️ `service_role` is deliberately NOT created: the migrations never reference it
# outside comments, so the role would be inert and its presence would assert
# coverage it has none of.
PGPASSWORD=${DB_PASS} psql -h localhost -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -q <<'SQL'
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $fn$
  SELECT current_setting('app.test_user_id', true)::uuid;
$fn$ LANGUAGE sql STABLE;
SQL

# ── Apply migrations ──────────────────────────────────────────────────────────
# Strict apply: ON_ERROR_STOP=on, no `|| true` swallowing.
# Path: the squash file first, when the project keeps one, then every later numbered file in
# order. MIGRATIONS_SQUASH names the squash file and MIGRATIONS_FIRST the first number applied
# after it; the files the squash absorbed stay below that number, and re-applying them is an error.
green "Applying migrations..."
PSQL="psql -h localhost -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -v ON_ERROR_STOP=on"

MIGRATIONS_SQUASH="${MIGRATIONS_SQUASH:-}"
MIGRATIONS_FIRST="${MIGRATIONS_FIRST:-0}"
if [ -n "$MIGRATIONS_SQUASH" ]; then
  PGPASSWORD=${DB_PASS} $PSQL -q -f "$MIGRATIONS_SQUASH" >/dev/null
fi

# ⚠️ THIS LOOP IS PURELY NUMERIC AND DOES NOT READ `-- apply-before: NNNN`
# (scripts/apply-all-migrations.mjs does — see the block near the top of that
# file). That is correct HERE only because this database has no hosted-platform
# public-schema default privilege granting anon, so a migration whose ACL pre-check
# needs a later migration's fix still passes in numeric order. It is not a general
# guarantee: if a fixture ever reproduces that default ACL, this loop applies the
# pre-check before the fix and dies at its RAISE.
# Every numbered file from MIGRATIONS_FIRST onwards, in numeric order
for f in $(ls supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | sort -u); do
  _n=$((10#$(basename "$f" | cut -c1-4))); [ "$_n" -ge "$MIGRATIONS_FIRST" ] || continue
  [ -f "$f" ] && PGPASSWORD=${DB_PASS} $PSQL -q -f "$f" >/dev/null
done
green "Migrations applied."

# ── Pre-harness column-ACL snapshot (2026-08-17) ──────────────────────────────
# THE ONLY PRISTINE MOMENT. The column-ACL leak test is the
# authoritative column-ACL gate; its drift arms ask "does any column the MIGRATIONS
# grant to `authenticated` sit outside the allowlist?". Asking that question from
# inside vitest is impossible:
#   - the leak test's own beforeAll runs `GRANT SELECT ... ON ALL TABLES` and then re-applies
#     the ACL *from the same Sets the drift arms check*, so a live reading is a
#     tautology (a set-deletion mutation deletes its own grant → can never RED).
#   - sibling files (the set a blanket-grant restore sentinel test
#     finds) run the same blanket grant on the same per-worker DB, so even a beforeAll-time
#     reading is pure-or-polluted depending on fork scheduling.
#   - there is no `globalSetup` in vitest.integration.config.ts, so no in-vitest
#     hook runs before the first file.
# So the snapshot is taken HERE — after the strict migration apply, before the
# per-worker TEMPLATE copies, before vitest exists. The ordering is checkable by
# line order in this file, which is the point.
#
# NEVER let this block fail the run: it is wrapped `|| true` so a psql/mktemp
# problem cannot break every seat's integration suite. The loud half lives in the leak test,
# which HARD-FAILS on a missing or empty snapshot rather than skipping its arms —
# an absent snapshot must never read as "no drift".
ACL_SNAPSHOT_FILE="$(mktemp "${TMPDIR:-/tmp}/ff-acl-snapshot.XXXXXX" 2>/dev/null || echo "")"
if [ -n "$ACL_SNAPSHOT_FILE" ]; then
  # The query lives in its own file because the leak test runs the SAME text live as the
  # control for its write-plane arm (see the file's header).
  PGPASSWORD=${DB_PASS} psql -h localhost -p "${DB_PORT}" -U ${DB_USER} -d ${DB_NAME} -At \
    -v ON_ERROR_STOP=1 -f scripts/integration-acl-snapshot.sql \
    > "$ACL_SNAPSHOT_FILE" 2>"$ACL_SNAPSHOT_FILE.err" || true
  if [ -s "$ACL_SNAPSHOT_FILE" ]; then
    green "Column-ACL snapshot captured ($(wc -c < "$ACL_SNAPSHOT_FILE" | tr -d ' ') bytes)."
  else
    # Still never fails the run: the ACL tests and restoreSchemaAcl hard-fail on
    # the empty file. This only keeps psql's reason, which 2>/dev/null discarded.
    yellow "Column-ACL snapshot EMPTY; the ACL tests and every restoreSchemaAcl caller will fail. psql said: $(head -c 400 "$ACL_SNAPSHOT_FILE.err" 2>/dev/null)"
  fi
  rm -f "$ACL_SNAPSHOT_FILE.err"
fi

# ── Per-worker DBs for parallel runs (2026-05-29) ─────────────────────────────
# The migrated ${DB_NAME} above doubles as the TEMPLATE. We file-copy it into N
# per-worker DBs (CREATE DATABASE … TEMPLATE — near-constant time per copy, vs
# re-applying ~170 migrations N times). Each vitest fork connects to its own
# ${DB_NAME}_w{poolId} (tests/integration/setup.ts), so concurrent files never
# collide on clearAllTables() TRUNCATE.
#   N = INTEGRATION_WORKER_COUNT (default: CI→2 on the 2-vCPU runner, local→4).
#   Opt out entirely with INTEGRATION_PARALLEL=0 → single shared DB, serial.
INTEGRATION_PARALLEL="${INTEGRATION_PARALLEL:-1}"
if [ "$INTEGRATION_PARALLEL" = "1" ]; then
  if [ -n "${CI:-}" ]; then DEFAULT_WORKERS=2; else DEFAULT_WORKERS=4; fi
  WORKER_COUNT="${INTEGRATION_WORKER_COUNT:-$DEFAULT_WORKERS}"
  green "Creating ${WORKER_COUNT} per-worker DBs (TEMPLATE copy of ${DB_NAME})..."
  # CREATE DATABASE … TEMPLATE requires zero connections to the template; the
  # migration psql sessions above have all exited, and nothing connects to the
  # base ${DB_NAME} during the run (workers use the _w{N} copies).
  for i in $(seq 1 "$WORKER_COUNT"); do
    PGPASSWORD=${DB_PASS} psql -h localhost -p "$DB_PORT" -U ${DB_USER} -d postgres \
      -v ON_ERROR_STOP=on -q \
      -c "DROP DATABASE IF EXISTS ${DB_NAME}_w${i};" \
      -c "CREATE DATABASE ${DB_NAME}_w${i} TEMPLATE ${DB_NAME};" >/dev/null
  done
  green "Per-worker DBs ready (${WORKER_COUNT})."
else
  WORKER_COUNT=1
fi

# ── Run tests ─────────────────────────────────────────────────────────────────
# --bail default 10: stops after 10 failed tests. Integration suite runs 5-10min;
# when the first 10 failures share a systemic cause (e.g., missing env var, mock
# drift), wasting 5 more minutes gathering 50 more identical failures is pure cost.
# Override for a full-suite investigation: `INTEGRATION_BAIL=999 npm run test:integration`.
# NOTE: do NOT pass `-- --bail=N` — vitest's CAC rejects a duplicate single-value
# option ("Expected a single value for option --bail, received [10, N]"). The env
# var is the only safe override because --bail is injected here unconditionally.
green "Running integration tests (${WORKER_COUNT} worker(s))..."
# ── Positive-verdict gate (2026-08-21, follow-up on the docker gate) ─────────
# The docker gate above closes ONE cause of "files found, zero executed"; this
# closes the CLASS: the script's rc is only a verdict if the run actually
# emitted a counts line. vitest 4 already exits 1 on NO-files-found
# (measured), so the residual shape is a run that collects files and executes
# nothing (bad glob, skipped-suite config, a swallowing setup). We capture via
# tee and read ${PIPESTATUS[0]} — the script is bash; the zsh spelling
# ($pipestatus[1]) expands EMPTY here and would silently pass. grep -a guards
# the NUL-byte binary-detection false-negative.
VITEST_OUT="$(mktemp)"
set +e
TEST_DATABASE_URL="$DB_URL" \
  INTEGRATION_PARALLEL="$INTEGRATION_PARALLEL" \
  INTEGRATION_WORKER_COUNT="$WORKER_COUNT" \
  FF_ACL_SNAPSHOT_FILE="$ACL_SNAPSHOT_FILE" \
  npx vitest run --config vitest.integration.config.ts --bail="${INTEGRATION_BAIL:-10}" "$@" 2>&1 | tee "$VITEST_OUT"
vitest_rc=${PIPESTATUS[0]}
set -e
# The CONNECT_TIMEOUT flake's discriminator lives in this container's log, which the EXIT trap deletes:
# read it now.
# shellcheck source=lib/connect-timeout-diagnostic.sh
# A subshell: under bash 3.2 a fatal error in a sourced file (missing, unparseable, an unset variable) exits
# with the EXIT trap's status, which is cleanup's 0, so a broken lib would report a failing suite as rc=0.
( source "$(dirname "$0")/lib/connect-timeout-diagnostic.sh" && connect_timeout_diagnostic "$vitest_rc" "$VITEST_OUT" "${CONTAINER_ID:-}" ) || true
if ! grep -aqF "Test Files" "$VITEST_OUT"; then
  printf "\033[31m%s\033[0m\n" "integration-test: NO 'Test Files' counts line in the run output — the suite did not RUN; refusing to report rc=${vitest_rc} as a verdict" >&2
  rm -f "$VITEST_OUT"
  exit 1
fi
rm -f "$VITEST_OUT"
exit "$vitest_rc"
