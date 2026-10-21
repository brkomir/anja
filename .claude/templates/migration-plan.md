# Migration Plan Template

## Migration: {NNNN}_{name}.sql

**Purpose:** [What this migration does and why]

**SQL:**
```sql
-- Migration {NNNN}: {description}
{SQL statements}
```

**Schema change:** `src/db/schema.ts`
```typescript
{Drizzle schema change}
```

**DEFAULT_PREFS sync:** `src/services/account.ts` (if preference column)
```typescript
{DEFAULT_PREFS change if applicable}
```

## Apply Commands

Apply through `/migration` only (`.claude/skills/migration/SKILL.md`): staging with
`node scripts/run-migration.mjs {NNNN}_{name}.sql`, prod with the skill's template. Both execute the
COMMITTED blob (an uncommitted or modified file is refused), refuse a file already recorded in
`public._migration_history`, and record the apply. Do not hand-roll an apply here: reading the
working copy can send SQL no commit holds, and splitting on `;` breaks every `DO $$ ... $$` block.

## Verification
- [ ] Docker integration tests pass (`npm run test:integration`)
- [ ] Applied to staging
- [ ] Applied to prod
- [ ] Schema.ts matches migration
- [ ] DEFAULT_PREFS synced (if applicable)
