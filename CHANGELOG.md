# Changelog

All notable user-facing changes to this package will be documented in this file.

## [Unreleased]

## [v0.1.0-beta.1](https://github.com/coder/libghostty-vt-node/releases/tag/v0.1.0-beta.1) - 2026-04-24

## Added
- Trusted npm publishing automation: merged `release/v*` PRs (or pushed `v*.*.*` tags) now build per-platform prebuilds, assemble them into the npm package layout, verify the local prebuild, and publish to npm with a version-derived dist-tag (`beta`/`rc`/`latest`) ([#1](https://github.com/coder/libghostty-vt-node/pull/1), [#2](https://github.com/coder/libghostty-vt-node/pull/2)).
- `CHANGELOG.md` is now included in the published npm tarball ([#2](https://github.com/coder/libghostty-vt-node/pull/2)).

## Changed
- Published prebuild matrix for this release covers `linux-x64`, `linux-arm64`, and `macos-arm64`. Other platforms must build from source via `npm run build:native` ([#2](https://github.com/coder/libghostty-vt-node/pull/2)).
