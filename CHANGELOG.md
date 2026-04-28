# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
