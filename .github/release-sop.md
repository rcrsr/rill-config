# Release SOP

The written procedure for cutting a `@rcrsr/rill-config` release. `/conduct:cut-release`
reads this file and follows it wherever it is more specific than the skill's defaults.
Derived from the 0.19.1 through 0.20.0 releases (PRs #6, #8, #11, #17) and `release.yml`.

## Shape of the repository

- One package, published from the root `package.json`. No `VERSION` file, no workspace
  members, no sync script. The `version` field in `package.json` is the single source of
  truth; nothing else carries the version.
- One changelog, `CHANGELOG.md` at the root, Keep a Changelog 1.1.0 format.
- `.github/workflows/release.yml` fires on a `v*` tag push. It verifies the tag matches
  `package.json`, builds, tests, publishes to npm with provenance, then creates the GitHub
  Release with `--generate-notes`.

## Versioning rule

The minor version tracks the `@rcrsr/rill` minor this package is pinned to in
`peerDependencies`. When the peer range moves (`~0.20.0` to `~0.21.0`), the package
version moves to the same minor (`0.20.x` to `0.21.0`) and the changelog carries a
**Breaking Changes** entry for the peer bump. Patch releases (`0.19.1`, `0.19.2`,
`0.19.3`) are free to cut between rill minors.

Before choosing `{version}`, read `peerDependencies["@rcrsr/rill"]` in `package.json`.
If its minor is ahead of the current `version` minor, the release is a minor bump to
match it, not a patch.

## Branch, commit, tag, PR names

| Item | Form | Example |
|---|---|---|
| Branch | `release/{version}` | `release/0.20.0` |
| Commit | `chore(release): {version}` | `chore(release): 0.21.0` |
| PR title | `Release {version}` | `Release 0.21.0` |
| Squash subject | `chore(release): {version} (#{pr})` | `chore(release): 0.21.0 (#53)` |
| Tag | `v{version}`, annotated | `v0.21.0` |

Earlier releases used `chore: bump to X, stamp changelog` and `chore: release X, ...`
subjects. Use the `chore(release):` form from here on so the log greps cleanly.

The 0.20.0 tag was pushed lightweight by hand; every other tag is annotated. Always
create the tag with `git tag -a`.

## Files the release commit touches

1. `package.json`: `version` only. Do not touch `peerDependencies` in the release
   commit; the peer bump lands in its own PR before the release (see #52 for 0.21.0,
   #16 for 0.20.0) so the suite runs against the new rill before the version moves.
2. `CHANGELOG.md`: rename `## [Unreleased]` to `## [{version}] - {YYYY-MM-DD}` and
   insert a fresh empty `## [Unreleased]` above it. The file uses bracketed headings
   and has **no** link-reference block at the bottom; do not add one.
3. Nothing else. `pnpm-lock.yaml` does not change on a version-only bump. README
   examples reference `rillVersion`, not the package version, and are updated with the
   peer bump, not the release.

## Procedure

1. Working tree clean, on `main`, `git pull --ff-only`.
2. Confirm the Unreleased section is non-empty and that every entry links its PR
   (`([#NN](https://github.com/rcrsr/rill-config/pull/NN))`). Entries without a PR link
   are a defect in the source PR, fix them in the release PR.
3. `git checkout -b release/{version}`.
4. Bump `package.json` `version`. Stamp `CHANGELOG.md`.
5. `pnpm check` locally. This is what CI runs across the Node matrix; a red run here
   means the release is not ready.
6. Commit the two files, push, open the PR. Body: a prose narrative of the release
   (lead sentence, then one short paragraph per theme), followed by `## Changes`
   reproducing the stamped entries grouped by Keep a Changelog category. The PR
   template's Summary/Why/Approach/Verification sections do not apply to a release PR.
7. Wait for CI (`check` matrix) and CodeQL to go green. Branch protection requires every
   `check` leg with `strict` on, so a stale branch must be rebased, not merged around.
8. Squash-merge. Subject `chore(release): {version} (#{pr})`.
9. `git checkout main && git pull --ff-only`, then
   `git tag -a v{version} -m "Release {version}"` and `git push origin v{version}`.
10. **Stop.** Do not run `gh release create`. `release.yml` publishes to npm and creates
    the GitHub Release from the tag. Watch the run:
    `gh run watch --workflow=release.yml` or `gh run list --workflow=release.yml`.
11. After the run succeeds, verify `npm view @rcrsr/rill-config@{version} version` and
    `gh release view v{version}`. Optionally replace the auto-generated release notes
    with the PR narrative: `gh release edit v{version} --notes-file <file>`.

## Things that have gone wrong before

- **Tag on the wrong commit.** `release.yml` fails at "Verify tag matches the manifest
  version" and publishes nothing. Delete the tag (`git push origin :v{version}`, then
  `git tag -d v{version}`), tag the squash-merge commit on `main`, push again.
- **Partial publish.** The workflow never cancels in progress (`cancel-in-progress:
  false`) because a cancelled publish leaves the registry holding a half-release that
  the next run's existence check reads as done. If a run is stuck, let it finish or
  fail on its own.
- **Release PR opened before the peer bump landed.** The suite passes against the old
  rill and the changelog claims a peer range the lockfile does not have. Land the peer
  bump PR first, then cut.

## What `/conduct:cut-release` must do differently here

- Skip the plan-confirmation prompt; this file is the plan.
- `{deploy-tag}` is true: `release.yml` both publishes and auto-generates release notes.
  Name that in the publish confirmation and skip Phase 8 step 8.3 entirely.
- Tag is annotated (`git tag -a`), as the skill already does.
- The version-drift grep in Phase 4 is scoped to `package.json` only.
