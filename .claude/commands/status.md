# Project Status

Quick overview of where things stand. Run this at the start of a session to get context.

## Steps

1. **Git status**: `git status --short` + `git log --oneline -5` — show what's changed and recent commits.

2. **Uncommitted work**: If there are unstaged changes, summarize what they are.

3. **Todo check**: Read `todo.txt` — count remaining items per section.

4. **Plans check**: List files in `plans/` and their status (implemented vs planned).

5. **Migration status**: List migrations in `supabase/migrations/` — note the latest one.

6. **Present** a concise summary:
   - Current branch + last commit
   - Uncommitted changes (if any)
   - Remaining open items count
   - Key decisions pending
