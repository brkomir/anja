# Final Audit Checklist Template

## Feature/Flow: {Name}

### Original Findings
| ID | Finding | Status | Verified By |
|---|---------|:------:|------------|
| P0-1 | {description} | [ ] VERIFIED / ISSUE | |
| P1-1 | {description} | [ ] VERIFIED / ISSUE | |

### Test Coverage Gate
- [ ] Every P0/P1 finding has at least one **behavioral** test
- [ ] Credit/auth/safety paths have **Docker integration tests** in `tests/integration/`
- [ ] User-facing flows have basic **E2E tests** (Playwright)
- [ ] All tests pass: `npx vitest run` + `npm run test:integration`

### Deferral Audit (5-minute rule on each)
| Item | Claimed Reason | Actual LOC | Valid? |
|------|---------------|:---------:|:------:|
| {item} | {reason} | ~{N} lines | Y/N |

### Cross-System Registration Check
| New Entry | Required Registrations | Status |
|-----------|----------------------|:------:|
| {entry} | {where it must appear} | [ ] Done |

### Tracker Updated?
- [ ] Flow/feature tracker entry reflects final status
- [ ] Deferred items in todo.txt with triggers
- [ ] Expert MEMORY.md files updated
