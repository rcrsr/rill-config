# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@rcrsr/rill-config` is a shared library for the [rill](https://rill.run) scripting runtime. It parses `rill-config.json`, validates it, loads extensions, and generates bindings and resolvers. It is a pure library: no CLI, no `process.exit()`, all failures throw a `ConfigError` subclass from `src/errors.ts`.

`@rcrsr/rill` is a peer dependency pinned in lockstep to the matching rill minor version (see `peerDependencies` in `package.json`). Version bumps here track rill releases.

Full project conventions live in `conduct/policies/` and are the source of truth: `policy-domain-node.md` (§NOD: layout, boundaries, errors, testing, commands), `policy-artifact-typescript.md` (§TS: code style), `policy-product-rill.md` (§RILL: product tenets). This file summarizes only what an everyday edit needs; the policies carry the detail.

## Commands

Package manager is pnpm (via Corepack); the supported Node range is the `engines` field in `package.json`.

```bash
pnpm bootstrap             # verify toolchain, install, build (fresh clone entry point)
pnpm install               # install deps (also installs lefthook git hooks)
pnpm build                 # tsc --build, emits to dist/
pnpm test                  # vitest run (all tests)
pnpm test tests/loader.test.ts              # single test file
pnpm test -t "pattern"                      # single test by name
pnpm check:types           # tsc --noEmit -p tsconfig.typecheck.json
pnpm check:lint            # oxlint on src/ and tests/
pnpm fix:lint              # oxlint --fix
pnpm check:format          # oxfmt --check
pnpm fix:format            # oxfmt
pnpm check:deps            # knip (unused deps/exports)
pnpm check:standards       # rill-check-standards (add --remote for host settings)
pnpm test:rules            # rill-test-rules (the lint rules' own unit tests)
pnpm check                 # the complete check set (what CI runs across the Node matrix)
```

This package is a single package, so it uses the root script vocabulary
throughout: `check:types` and `check:lint`, not bare `typecheck` and `lint`.
See `REPO-STANDARDS.md` §4.

Vitest arguments pass straight through, with no `--` separator. `pnpm test -- tests/loader.test.ts` silently runs the *whole* suite instead of the one file, and a full green run looks just like a passing filtered one, so check the reported file count when filtering.

Linting and formatting use oxlint and oxfmt, not ESLint or Prettier. Lefthook runs format then lint on pre-commit, in that order because the reverse lets the formatter undo a lint fix, and typecheck+test on pre-push (`LEFTHOOK=0` or `--no-verify` skips).

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
- Host-injection seams are data (a value or map) when sources are closed and the host can compute them eagerly. They are provider interfaces when sources are open-ended and discovered mid-pipeline; never ship a provider interface with one implementation (§NOD.8.1).
- `exactOptionalPropertyTypes` is on: forward optional fields with a conditional spread, `...(signal !== undefined ? { signal } : {})`, not `signal ?? undefined` (§NOD.7, §TS.2.3).
- Source files use `// ===` banner comments to group sections; new exports go under the matching banner in `src/index.ts` (§NOD.2.2).
- Tests live in `tests/` (one file per `src/` module) with fixtures under `tests/fixtures/`; knip ignores fixtures. Each test file opens with a `Covers: HP-*, EC-* (AC-*)` spec header (§NOD.5.2), and imports the public package rather than `../src/*.js` unless the symbol is `@internal` (§NOD.5.1).
- Naming and style rules (function prefixes, `as const` over `enum`, named exports only, `unknown` over `any`) are in `conduct/policies/policy-artifact-typescript.md` §TS.1 and §TS.8.

## Repository standards

This repository conforms to the ecosystem baseline in `REPO-STANDARDS.md`,
which arrives through the `@rcrsr/rill-dev` devDependency rather than as a file
in this tree. Read the installed copy at
`node_modules/@rcrsr/rill-dev/REPO-STANDARDS.md`, or upstream at
[rcrsr/rill](https://github.com/rcrsr/rill/blob/main/packages/dev/REPO-STANDARDS.md).

```bash
pnpm check:standards                        # elements readable from the tree
pnpm exec rill-check-standards --remote     # adds §1 merge gates and §13 repo settings
```

Read the summary line, not the exit code. `--` means an element was **not**
checked; it still applies. A green run covers only the checked subset.

### CI checks the tree; `--remote` is a maintainer task

CI runs `check:standards` as the last leg of `pnpm run check`, without
`--remote`. **Do not add it back.** Two independent reasons:

- **A pull request cannot change host state.** Branch protection and repository
  settings are altered out of band by an admin. Gating merges on them means one
  settings change turns every open PR red for a reason no author can fix, which
  teaches everyone to ignore the job.
- **CI credentials cannot read them anyway.** `GITHUB_TOKEN` gets a repository
  object with the administrative fields omitted and a 404 from
  `branches/*/protection`, so both element groups report as unchecked. The CI
  element count is identical with and without the flag; the step implied
  coverage it did not have. Making it decide anything means a long-lived
  admin-scoped PAT or a GitHub App sitting in the PR path, to check settings a
  PR cannot alter.

Run `pnpm exec rill-check-standards --remote` yourself, from a `gh`-authenticated
shell, when repository settings change. It decides strictly more elements than
any CI run can.

**The shared dev assets are a dependency, not a copy.** `@rcrsr/rill-dev` ships
the checker (`rill-check-standards`), the lint rules
(`@rcrsr/rill-dev/lint-rules`, plus `rill-test-rules` for their own suite), and
`REPO-STANDARDS.md`. A fix to any of them goes to `rcrsr/rill` under
`packages/dev` and arrives here as a version bump. Do not vendor
`REPO-STANDARDS.md` back into the tree; there is nothing to keep in sync and a
copy would only go stale.

`rill-check-standards` resolves the repository under test with
`git rev-parse --show-toplevel`, never from its own location, which is what
makes it correct from inside `node_modules/`. If it looks like it is reading
the wrong tree, the working directory is the cause, not the script. It exits 2
rather than reporting on a directory with no manifest.

`scripts/bootstrap.sh` stays a local file: it performs the install that fetches
`@rcrsr/rill-dev`, so it cannot ship inside its own prerequisite.

### Recorded N/A

Each entry names the element ID and the stated condition from
`REPO-STANDARDS.md` that it meets. An N/A claimed without a matching stated
condition is a defect, not a decision.

| ID | Stated condition it meets |
|---|---|
| STD-CHK-7 | "The repository publishes exactly one package and has no root-versus-package version split to reconcile." One package, published from the root manifest. There is no root-vs-package pair to reconcile, so there is no version gate for CI to run. Tag-vs-manifest consistency is a different assertion and is enforced by STD-REL-2 in `release.yml`. |
| STD-SCRIPT-3 | "The same condition as STD-CHK-7." No `check:versions` / `fix:versions`, for the reason above. |
| STD-SCRIPT-7 | "The repository is a single package." There are no workspace packages to carry the atomic vocabulary. The single package is the root and takes the root vocabulary from STD-SCRIPT-1 (`check:types`, `check:lint`), not the bare package names. |
| STD-PM-7 | **Satisfied vacuously, not N/A by the stated condition.** That condition reads "single package with no workspace file", and this repository *does* have a `pnpm-workspace.yaml`: it declares no `packages:` key and carries pnpm settings only, which pnpm reads either way. So the file exists, there are zero globs, and "every workspace glob matches" holds with nothing to check. The checker reports it as `--`. Do not read this row as meeting the written condition; a settings-only workspace file is a shape that condition does not describe. |
| STD-DEP-4 | "The repository is a single package." Vitest is declared once, in the only manifest, so there is no per-package consistency to keep. |

Two elements are always-applicable and satisfied rather than N/A. Both are
machine-checked and report `ok`; the notes stay because they carry the reasoning
for the shape the checker accepts, which a passing line does not:

- **STD-PM-6.** Verified against the pinned major, pnpm 11.18.0: it no longer
  reads `pnpm.onlyBuiltDependencies` from `package.json` and warns "Ignored
  build scripts" when the allowlist is absent. The allowlist is `allowBuilds` in
  `pnpm-workspace.yaml`, which is where 11 expects it. As of rill-dev 0.2.0 the
  checker decides this from the tree, reading the pinned pnpm major to know
  which of the two locations is load-bearing; before then it reported `--`.
- **STD-SUP-4.** `minimumReleaseAgeExclude` names `@rcrsr/rill` and
  `@rcrsr/rill-dev` by name, not by exact version, so both survive the next
  release with no hand edit. Both are first-party; the rationale for each is in
  `pnpm-workspace.yaml`.

### Which `rill/*` lint rules are on

Loading `@rcrsr/rill-dev/lint-rules` through `jsPlugins` registers the rules
without enabling any of them, so each is a deliberate opt-in in
`.oxlintrc.json`. Both are on, scoped to `src/**/*.ts`.

- **`rill/no-spec-id-reference`.** `src/` is what anyone reading the published
  package sees, and `conduct/` identifiers are unresolvable there. Tests are
  excluded on purpose: their `Covers:` headers are spec IDs by design.
- **`rill/no-duplicate-error-id`.** This one matches nothing today: it binds to
  the bare identifier `RuntimeError` and to `RuntimeError.fromNode`, and this
  package constructs only `ConfigError` subclasses. It is on anyway. A no-op
  rule costs nothing, whereas switching it off fails silently — the day a module
  imports rill's `RuntimeError`, nobody will remember the rule existed.

Verify the plugin resolves through `node_modules` rather than a path:

```bash
node -e "import('@rcrsr/rill-dev/lint-rules').then(m => console.log(Object.keys(m.default.rules)))"
# [ 'no-duplicate-error-id', 'no-spec-id-reference' ]
```

Note `m.default.rules`, not `m.rules`: the plugin is a default export
(`export default { meta, rules }`), so the module namespace carries `default`.

### Host settings, which no checkout can enforce

Merge gates (§1) and repository settings (§13) live on GitHub, so nothing in a
diff reveals a change to them. Re-check with:

```bash
gh api repos/rcrsr/rill-config/branches/main/protection \
  --jq '.required_status_checks | {strict, contexts}'
gh api repos/rcrsr/rill-config \
  --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit,
         rebase: .allow_rebase_merge, wiki: .has_wiki,
         delete_branch: .delete_branch_on_merge}'
```

The intent: `main` protected with admins included and force pushes off; linear
history on; squash the only enabled merge path; `delete_branch_on_merge` on;
every leg of the CI `check` matrix a required context, with `strict` on.
