---
name: test-gap
description: Analyze a specific file or feature and identify what's tested vs what's not. Use when writing tests for legacy code or when an audit surfaces coverage gaps.
---

# Test Gap — Find Untested Code Paths

Analyze a specific file or feature and identify what's tested vs what's not.

## When to Use
- After implementing a fix, before committing — "did I cover this?"
- During audit-check when evaluating test coverage
- When QA expert flags test gaps

## Process
1. Take a file path or feature name as input
2. Find all test files that reference it: `grep -rl "{filename}" tests/`
3. Categorize existing tests: behavioral (imports function) vs source-grep (readFileSync)
4. Identify untested code paths:
   - Error/catch blocks without corresponding failure tests
   - Conditional branches (if/else) without both-branch tests
   - Credit operations without refund-path tests
   - Auth checks without unauthorized-access tests
5. Report gaps with specific test recommendations

## Output
```
## Test Gap Analysis: {file}

Existing coverage: {N} tests ({M} behavioral, {K} source-grep)

Untested paths:
1. {error path at line N} — needs: integration test with mock failure
2. {conditional at line N} — needs: unit test for false branch
3. {credit operation at line N} — needs: Docker integration test

Recommendation: {N} tests to add, {effort estimate}
```
