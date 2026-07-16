# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@rcrsr/rill-config` is a shared library for the [rill](https://rill.run) scripting runtime. It parses `rill-config.json`, validates it, loads extensions, and generates bindings and resolvers. It is a pure library: no CLI, no `process.exit()`, all failures throw a `ConfigError` subclass from `src/errors.ts`.

`@rcrsr/rill` is a peer dependency pinned in lockstep to the matching rill minor version (see `peerDependencies` in `package.json`). Version bumps here track rill releases.

Full project conventions live in `conduct/policies/` and are the source of truth: `policy-domain-node.md` (§NOD: layout, boundaries, errors, testing, commands), `policy-artifact-typescript.md` (§TS: code style), `policy-product-rill.md` (§RILL: product tenets). This file summarizes only what an everyday edit needs; the policies carry the detail.

## Commands

Package manager is pnpm (via Corepack); the supported Node range is the `engines` field in `package.json`.

```bash
pnpm install               # install deps (also installs lefthook git hooks)
pnpm build                 # tsc --build, emits to dist/
pnpm test                  # vitest run (all tests)
pnpm test tests/loader.test.ts              # single test file
pnpm test -t "pattern"                      # single test by name
pnpm typecheck             # tsc --noEmit -p tsconfig.typecheck.json
pnpm lint                  # oxlint on src/ and tests/
pnpm fix:lint              # oxlint --fix
pnpm check:format          # oxfmt --check
pnpm fix:format            # oxfmt
pnpm check:deps            # knip (unused deps/exports)
pnpm check                 # build + test + lint (what CI runs across the Node matrix)
```

Vitest arguments pass straight through, with no `--` separator. `pnpm test -- tests/loader.test.ts` silently runs the *whole* suite instead of the one file, and a full green run looks just like a passing filtered one, so check the reported file count when filtering.

Linting and formatting use oxlint and oxfmt, not ESLint or Prettier. Lefthook runs lint+format on pre-commit and typecheck+test on pre-push (`LEFTHOOK=0` or `--no-verify` skips).

Always go through the package scripts. `npx <tool>` and `pnpm exec <tool>` bypass the toolchain versions pinned in `devDependencies`. This is a standalone package, not a workspace, so `--filter` and `-r` do not apply. See `conduct/policies/policy-domain-node.md` §NOD.7.

## Architecture

ESM-only (`"type": "module"`). All intra-package imports use `.js` extensions. Public API is re-exported through `src/index.ts`; tests import `@rcrsr/rill-config`, which vitest aliases to `src/index.ts` (see `vitest.config.ts`), so no build is needed before testing.

`src/` is flat: one concern per module, no subdirectories. A new concern gets a new top-level `src/*.ts` file, which keeps every stage one hop from the barrel. See `conduct/policies/policy-domain-node.md` §NOD.1.1.

`loadProject()` in `src/project.ts` is the top-level orchestrator. Its pipeline (read, parse and interpolate, version check, load extensions, validate context, extension bindings, context bindings, resolvers) maps roughly one step per module. The `// Step N` comments in `project.ts` are the authority on step numbering; when the policy table disagrees with them, the code wins and the table gets fixed. See §NOD.1.2 for the mapping.

Two invariants that a routine change can silently break:

- **Cleanup on failure.** Every step after extension loading runs inside a `try/catch` that awaits `runDisposes(disposes)` before rethrowing. Anything that can throw while `disposes` is non-empty belongs inside that block, or extension handles and timers leak (§NOD.1.3).
- **Standalone exports.** Every step is also exported from `src/index.ts` so hosts like rill-cli can run partial pipelines. A step reachable only through `loadProject()` breaks them (§NOD.1.2).

Extension loading (`src/loader.ts`) is the largest module: it resolves specifiers (relative, absolute, `file://`, bare), dynamically imports each extension, validates the manifest, invokes the factory, and collects the value tree, dispose callbacks, and error codes. Bare specifiers resolve from the `prefix` option (callers pass `<projectDir>/.rill/npm`; defaults to the config dir).

## Conventions

- Errors: always throw a `ConfigError` subclass, never a plain `Error`; hosts dispatch on `instanceof ConfigError` and `.code`. A new class lands in `src/errors.ts`, `src/index.ts`, and the README error table in the same change (§NOD.3.2). Every public API addition belongs in the README tables that release (§RILL.3.3).
- Imports: leaf modules import only `./types.js`, `./errors.js`, Node builtins, `semver`, and `@rcrsr/rill`. The single leaf-to-leaf exception is `loader.ts` importing `detectNamespaceCollisions`; do not add a second without equivalent rationale (§NOD.2.1).
- A helper exported from its module but not from `index.ts` is `@internal` (e.g. `resolveSpecifier`). Do not re-export it "for convenience"; that turns an implementation detail into public API (§NOD.2.3).
- `exactOptionalPropertyTypes` is on: forward optional fields with a conditional spread, `...(signal !== undefined ? { signal } : {})`, not `signal ?? undefined` (§NOD.7, §TS.2.3).
- Source files use `// ===` banner comments to group sections; new exports go under the matching banner in `src/index.ts` (§NOD.2.2).
- Tests live in `tests/` (one file per `src/` module) with fixtures under `tests/fixtures/`; knip ignores fixtures. Each test file opens with a `Covers: HP-*, EC-* (AC-*)` spec header (§NOD.5.2), and imports the public package rather than `../src/*.js` unless the symbol is `@internal` (§NOD.5.1).
- Naming and style rules (function prefixes, `as const` over `enum`, named exports only, `unknown` over `any`) are in `conduct/policies/policy-artifact-typescript.md` §TS.1 and §TS.8.
