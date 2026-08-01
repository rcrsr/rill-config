# Contributing to rill-config

Thanks for your interest in `@rcrsr/rill-config`. This guide covers setup, the change process, and the standards a pull request must meet before review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow the [Security Policy](SECURITY.md) instead of the process below.

## Before you write code

**Open an issue first for anything non-trivial.** Bug fixes and typo corrections can go straight to a pull request. Everything else starts as an issue so the design gets settled before you invest in an implementation.

Use the templates under `.github/ISSUE_TEMPLATE/`. Pick the one that matches: bug, feature, chore, security, or idea. `.github/labeler.yml` is the one-stop reference for the label taxonomy.

For a change to the `loadProject()` pipeline or the public surface, expect a design discussion in the issue. That discussion produces an agreed contract: which step the code hooks into, what the public surface looks like, and how the work splits across pull requests. Wait for that agreement before writing the implementation.

**Follow the agreed design.** If you find a reason to depart from it while implementing, say so in the issue or the pull request description. An unflagged deviation costs a review cycle and sometimes a rewrite. A flagged one usually just updates the plan.

**Security work follows the [Security Policy](SECURITY.md).** Its [threat model](SECURITY.md#threat-model) covers what counts as a vulnerability, from specifier resolution escape to load-time cleanup failure.

Report a vulnerability in a published release privately through the [Security tab](https://github.com/rcrsr/rill-config/security/advisories/new), not as a public issue. Hardening work on unreleased code uses the Security issue template.

## Setup

Node and pnpm floors are the `engines` field in `package.json`; `.nvmrc` and `.node-version` name the version this repository develops against.

```bash
git clone https://github.com/rcrsr/rill-config.git
cd rill-config
corepack enable
pnpm bootstrap
```

`pnpm bootstrap` verifies the toolchain, installs with a frozen lockfile, and builds. It is safe to re-run. Installing also wires the git hooks through `prepare`.

## Repository layout

`src/` is flat: one concern per module, no subdirectories, so every stage is one hop from the barrel in `src/index.ts`. `tests/` mirrors it one file per module, with fixtures under `tests/fixtures/`.

`loadProject()` in `src/project.ts` is the top-level orchestrator. The `// Step N` comments in that file are the authority on step numbering.

`scripts/` holds the one shared script that cannot be a dependency: `bootstrap.sh` performs the install, so it cannot ship inside a package that install fetches.

The rest of the shared dev assets — the conformance checker, the custom oxlint rules, and `REPO-STANDARDS.md` — come from the `@rcrsr/rill-dev` devDependency. **They are not in this tree, and nothing here should copy them into it.** A fix goes to `rcrsr/rill` under `packages/dev` and arrives here as a version bump.

## Commands

Full detail is in [CLAUDE.md](CLAUDE.md). The ones a contributor needs:

```bash
pnpm check                 # the complete check set; must pass before review
pnpm test                  # vitest run
pnpm test tests/loader.test.ts   # one file
pnpm check:standards       # repository conformance
pnpm test:rules            # the custom oxlint rules' own unit tests
pnpm fix:format            # oxfmt
```

`pnpm exec rill-check-standards --remote` adds the merge gates and repository settings, which live on GitHub and so are invisible to `pnpm check:standards`. It needs `gh` authenticated; without it those elements report as unchecked rather than failing.

Vitest arguments pass straight through with no `--` separator. `pnpm test -- tests/loader.test.ts` silently runs the *whole* suite, and a full green run looks just like a passing filtered one, so check the reported file count when filtering.

Always go through the package scripts. `npx <tool>` and `pnpm exec <tool>` bypass the versions pinned in `devDependencies`.

## The bar for a pull request

**`pnpm check` must pass locally before you request review.** This is the single most common reason a pull request stalls. Do not rely on CI to find a broken build for you.

Two failure modes worth calling out, because neither is obvious:

1. **A test file that fails to import reports as a file-level failure, not as failing tests.** A suite that never collects can read as "no failures" at a glance. Confirm your tests actually execute and that the count is what you expect.
2. **`pnpm check:standards` is part of `pnpm check`.** A change to a workflow, a manifest field, or a lint setting can fail conformance without touching any TypeScript.

Other expectations:

- **Wire the change end to end.** Code that nothing calls is not a reviewable increment.
- **Export new public API from `src/index.ts`, and add it to the README tables in the same change.** Hosts like rill-cli cannot reach deep paths, and every pipeline step is exported so they can run partial pipelines.
- **Throw a `ConfigError` subclass, never a bare `Error`.** Hosts dispatch on `instanceof ConfigError` and `.code`. A new class lands in `src/errors.ts`, `src/index.ts`, and the README error table together.
- **Respect cleanup on failure.** Anything that can throw while `disposes` is non-empty belongs inside `loadProject()`'s try/catch, or extension handles and timers leak on a failed load.
- **Let the formatter handle style.** `oxfmt` runs on commit. Do not hand-format, and do not fight it.

## Tests

Each test file opens with a `Covers:` spec header and imports the public package rather than `../src/*.js`, unless the symbol is `@internal`.

### Write tests that could fail

A test that passes before your implementation exists is measuring something else. Before opening a pull request, check that each new test fails for the right reason when the change is reverted.

This matters most for tests of the happy path. "The valid config loads" often passes against untouched default behaviour and demonstrates nothing.

### Test the adversarial case

For anything that gates, filters, validates, or resolves, cover the bypass rather than only the intended use:

- **Every input form reaches the same rule.** A specifier can be relative, absolute, `file://`, or bare. A form that skips a check is a bypass, not an edge case.
- **Resolution stays inside its boundary.** A bare specifier must not escape the `prefix`, whatever the config names.
- **Defaults fail closed.** Test what happens with a missing field, an unrecognised shape, and no configuration at all. An unhandled shape must not silently pass through.
- **The failure path disposes.** For anything that can throw after extensions have loaded, assert that the dispose callbacks ran. A leak on the error path is invisible to a happy-path test.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with an area scope drawn from `.github/labeler.yml`:

```
feat(loader): accept caller-supplied preloaded extension modules
fix(resolve): keep bare specifiers inside the resolution prefix
docs: document the VariableProvider seam
chore: release vX.Y.Z
```

Write the subject as a description of the change. State what the code does now, not how many files you touched.

`lefthook` runs formatting then lint with auto-fix before each commit, and typecheck plus the full test suite before each push. Skip with `LEFTHOOK=0` only when you have a specific reason.

## Pull requests

1. Branch from `main`. Name it for the work, for example `fix/loader-dispose` or `docs/contributing-guide`.
2. Keep it scoped to one concern. A large change splits into a sequence of pull requests, agreed in the issue.
3. Describe the change in terms of source files, exported APIs, and behaviour. Link the issue it implements. `.github/PULL_REQUEST_TEMPLATE.md` has the shape.
4. Area labels apply automatically from the paths you touched, via `.github/labeler.yml`.
5. CI runs `pnpm check` across every Node version in the matrix in `.github/workflows/ci.yml`, plus CodeQL, dependency review, and the `dev/` drift check. All must pass.

Expect review comments to cite specific lines and to include the command or grep that verifies the claim. Reply in the same register. If you disagree with a finding, say why and show the evidence.

## Documentation

`README.md` carries the API and error tables and is the published surface. Every public API addition belongs in those tables in the same release. `CLAUDE.md` carries repository conventions and the recorded conformance exceptions.

## Releases

Maintainers publish `@rcrsr/rill-config` by tagging a release commit on `main`. The tag must match `package.json`'s version; the release workflow fails otherwise. The `@rcrsr/rill` peer range is pinned in lockstep to the matching rill minor.

Contributors do not need to bump versions in a pull request.

## License

`@rcrsr/rill-config` is MIT licensed. By contributing, you agree that your contributions are licensed under the same terms. See [LICENSE](LICENSE).
