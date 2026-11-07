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
- `git` operations were occasionally contended by an `.git/index.lock` during parallel tool calls; resolved by retrying sequentially. Avoid parallel `git` commands in this environment.

## M0 — Results (completed 2026-11-07)

**Built**
- `package.json` (pnpm, Node >=20, ESM, `pnpm check` = lint + typecheck + test), `pnpm-lock.yaml`, `pnpm-workspace.yaml`/`.npmrc` for pnpm build approvals.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (plus `noImplicitOverride`, `noPropertyAccessFromIndexSignature`).
- `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` strict/stylistic type-checked; enforces `@typescript-eslint/no-explicit-any`, `no-unsafe-*`, `consistent-type-assertions: never`, `max-lines: 400`.
- `prettier.config.js`, `.prettierignore`, `vitest.config.ts`, placeholder `src/index.ts` and `test/smoke.test.ts`.
- `.github/workflows/ci.yml`: Node 20/22 on `ubuntu-latest`, `macos-latest`, `windows-latest` running `pnpm install --frozen-lockfile` + `pnpm check`.
- `LICENSE` (MIT), `docs/harness-notes.md` (stub).

**Commands/results**
- `pnpm install` (required build-approval config for esbuild in pnpm 11); `pnpm approve-builds --all` completed esbuild postinstall.
- `pnpm check` (runs `eslint . && tsc --noEmit && vitest run`): **passed** — 1 test file, 1 test passed.
- Acceptance (any fails lint): created `test/scratch-any.ts` with `export const bad: any = 1;` → `npx eslint test/scratch-any.ts` reported `@typescript-eslint/no-explicit-any` error; scratch file removed and `pnpm check` still passes.

**Commits (local, not pushed)**
- `docs: add M0 plan and harness notes stub`
- `chore: scaffold package, TypeScript, ESLint, Prettier, and Vitest`
- `chore: add GitHub Actions CI matrix`
- `chore: add MIT license`
- (this update) records M0 completion.

**Next (human)**
- Set up the agent workbench with `pnpm check` as its verify gate before M1 starts (do not create `.workbench/` here). M3b/M4 harness work remains blocked until the work harness is named / human-assisted tests run as specified in PLAN.

---
