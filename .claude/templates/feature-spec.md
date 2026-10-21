# Feature Spec Template

## Feature: {Name}

**Problem:** [What user problem does this solve? Who is affected?]

**Solution:** [1-3 sentences describing the approach]

**Affected Files:**
- `src/path/to/file.ts` — {what changes}
- `src/path/to/file.ts` — {what changes}

**Database Changes:**
- [ ] New migration needed? {Y/N — describe}
- [ ] New table? {RLS required}
- [ ] New column? {DEFAULT_PREFS sync needed?}

**Cross-System Registration:**
- [ ] New email type → add to PREF_MAP + unsubscribe route
- [ ] New cron job → add to vercel.json
- [ ] New API endpoint → add auth + rate limiting
- [ ] New preference → sync schema + DEFAULT_PREFS

**Tests Required:**
- [ ] Unit tests for logic
- [ ] Integration tests for DB/credit operations
- [ ] E2E tests for user-facing flows

**Expert Panel:** {Which experts should review? Check meta playbook.}

**Effort Estimate:** {hours}
