# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.19.3] - 2026-07-16

### Fixed

- **Config parsing:** `parseConfig` deep-validates config structure and throws `ConfigValidationError` with a field path instead of a raw `TypeError`. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Mount specifiers:** Absolute and `file://` specifiers containing `@` are no longer mis-split; version ranges are validated with `semver.validRange` at `resolveMounts` time. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Module resolver:** The `module:` scheme rejects dot-paths with empty segments, which could previously resolve outside the configured module directory. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Context validation:** `validateContext` rejects `NaN` and `±Infinity` for `number`-typed fields, which previously produced invalid rill literals. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Error reporting:** All `ConfigError` subclasses now report their class name in `error.name` and stack traces. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Documentation:** `ResolverError` now appears in the README error-class table. ([#10](https://github.com/rcrsr/rill-config/pull/10))

### Changed

- **Relative mount resolution:** Relative specifiers resolve against the `prefix` option, and `loadProject` defaults `prefix` to the config file's directory, matching `modules`. Bare-specifier (npm) resolution also re-anchors from `process.cwd()` to the config directory for `loadProject` callers who omit `prefix`, since it uses the same `prefix` default. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Validation ordering:** Namespace-collision and orphan-key validation runs before any mount package is imported, so failures no longer execute extension module code. ([#10](https://github.com/rcrsr/rill-config/pull/10))
- **Dependencies:** `semver` bumped to 7.8.5; built and tested against `@rcrsr/rill` 0.19.6. `peerDependencies` stays at `~0.19.0`. ([#11](https://github.com/rcrsr/rill-config/pull/11))
- **Dev tooling:** Updated to TypeScript 7, oxlint, oxfmt, lefthook, and knip, matching rill-cli; no runtime changes. ([#9](https://github.com/rcrsr/rill-config/pull/9))
- **Engines:** `engines.node` raised from `>=20.0.0` to `>=22.16.0`, matching rill-cli and the CI matrix. ([#9](https://github.com/rcrsr/rill-config/pull/9))

## [0.19.2] - 2026-05-03

### Fixed

- `loader`: classify transitive `ERR_MODULE_NOT_FOUND` separately from a missing entrypoint package. The error message now names the actual missing specifier and the importing file, and includes a hint pointing at `<projectRoot>/.rill/npm/node_modules/` when that install location exists. Both kinds of misses are aggregated into a single error so a transitive miss late in the mount list does not silently drop earlier entrypoint misses. Previously, a transitive import failure inside a project-relative `.ts` extension was reported as if the entrypoint itself were missing (`Cannot find packages: ./extensions/foo.ts`).
- `loader`: `ExtensionVersionError` message now includes the mount path, the install range, and a stale-`VERSION`-constant hint, so users can distinguish an upstream-published manifest with a hardcoded `VERSION` from a genuinely incompatible install.

## [0.19.1] - 2026-05-03

### Added

- `loadProject`, `loadExtensions`, `loadModules`, and `resolveSpecifier` accept an optional `prefix?: string` parameter. When provided, bare-specifier module resolution anchors `createRequire` at `<prefix>/node_modules/` instead of `process.cwd()/node_modules/`. Omitting `prefix` preserves existing cwd-based behavior, so the change is backward-compatible. Unblocks `rill-cli` consumers that install extensions into a project-local store at `<projectDir>/.rill/npm/`.

## [0.19.0] - 2026-04-27

### Breaking Changes

- Target `@rcrsr/rill` 0.19.0. `peerDependencies` bumped to `~0.19.0`.
- Loader now invokes extension factories with two arguments: `(config, ctx)`. `ctx` is the `ExtensionFactoryCtx` exported from `@rcrsr/rill` and exposes `signal: AbortSignal` (aborted on dispose) and `registerErrorCode(name, kind)`. Existing factories that ignore the second argument continue to work.

### Added

- Re-export `ExtensionFactoryCtx` type from the package root.
- Per-extension `AbortController` whose `signal` is exposed via `ctx.signal`. Extension teardown calls `controller.abort()` before invoking the factory's own `dispose`.
- `LoadedProject.errorCodes` and `ProjectResult.errorCodes` (`ReadonlyMap<string, string>`) carry merged atom-code registrations contributed by extension factories via `ctx.registerErrorCode`. Hosts running a rill runtime must replay these onto the runtime's `RuntimeContext` before script execution.
- `loadExtensions(mounts, config, { signal })` and `loadProject({ ..., signal })` accept an optional parent `AbortSignal` that cascades into every extension's `ctx.signal`.

### Changed

- When any extension factory fails after others have initialized, already-built extensions are aborted and disposed in reverse order (errors swallowed) before the load error propagates.
- `registerErrorCode` is enforced across all extensions of a project: declaring the same atom name with a different kind in any factory throws.
- CLI bool param coercion now accepts only `''` (presence flag), `'true'`, or `'false'` (case-insensitive). Any other string throws `HandlerArgError`; previously any non-empty string coerced to `true`.

### Notes

- 0.19.0 script-runtime changes in `@rcrsr/rill` (`:code`→`:atom`, collection-callable forms, `@`-loop removal, `:>` removal, `RuntimeHaltSignal`) do not affect rill-config's API surface.
- `pnpm.overrides` pins `@rcrsr/rill` to `link:../rill/packages/core` for local development; remove or override before publishing if working outside the rill monorepo layout.

## [0.18.5] - 2026-04-06

### Added

- Support variable resolution with `${VAR}` environment and `@{VAR}` session variables

### Changed

- `parseConfig` no longer interpolates values during parsing; callers must perform variable resolution separately
- `loadProject` no longer accepts an `env` override argument

## [0.18.4] - 2026-04-05

### Changed

- Update all dependencies to latest versions (typescript 5.9.3 → 6.0.2, vitest 4.0.18 → 4.1.2)
- Add `"types": ["node"]` to tsconfig.json for TypeScript 6.0 compatibility

## [0.18.3] - 2026-04-05

### Added

- Extract `@rcrsr/rill-config` from the [rill monorepo](https://github.com/rcrsr/rill) as a standalone repository
