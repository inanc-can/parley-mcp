# Progress

## M0 — Scaffold (plan, 2026-11-07)

**Goal:** Set up the repository tooling so `pnpm check` (lint + typecheck + test) passes and CI enforces it, with strict TypeScript/ESLint rules required by `AGENTS.md`.

**Tasks**
1. Create `docs/PROGRESS.md` (this file) with the M0 plan and `docs/harness-notes.md` (empty stub).
2. Initialize `package.json` (pnpm, Node >=20, `"type": "module"`), `tsconfig.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), and a minimal `src/` placeholder so typecheck has input.
3. Configure ESLint (strict type-checked) with `@typescript-eslint/no-explicit-any` error, `no-unsafe-*` rules, `consistent-type-assertions: never` (allow `as const` only where supported), and `max-lines` 400; configure Prettier.
4. Configure Vitest with an empty passing test placeholder (so `pnpm check` passes on an empty suite). Add `pnpm check` script (lint + typecheck + test).
5. Add GitHub Actions CI for Node 20 and 22 on macOS, Linux, and Windows running `pnpm check`.
6. Add MIT `LICENSE`.
7. Verify acceptance: `pnpm check` passes; an `any` in a scratch file fails lint. Record results here and stop (human sets up workbench).

**Constraints/notes**
- No files over 400 lines, no `any`, no `as` assertions except `as const`. CI will enforce ESLint rules.
- `opencode.json` is read-only in this environment; shell permissions are allowlisted (I cannot `git push`, publish, or run denied commands). If blocked, I will record it here.

---
