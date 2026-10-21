# Audit Finding Template

| Field | Value |
|-------|-------|
| **ID** | P{0-3}-{N} |
| **Feature/Flow** | F{N} or Flow #{N} |
| **Priority** | P0 (blocks launch) / P1 (high impact) / P2 (should fix) / P3 (polish) |
| **Summary** | One-line description |
| **File(s)** | `src/path/to/file.ts` line ~N |
| **Effort** | ~N lines, ~N minutes |
| **Expert(s)** | Who found it |
| **Status** | Found / Fixed / Verified / Deferred |

**Description:**
[2-3 sentences: what's wrong, why it matters, what the fix is]

**Test Required:**
- [ ] Behavioral unit test (import function, assert output)
- [ ] Docker integration test (getTestDb, seed rows, call service)
- [ ] E2E test (Playwright, seed project, verify UI)

**Deferral Reason (if deferred):**
[Must be one of: needs production data / needs user decision / has unbuilt dependency]
