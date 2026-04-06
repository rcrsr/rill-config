# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
