# Changelog

All notable user-facing changes to this package will be documented in this file.

## [Unreleased]

## [v0.1.0-beta.2](https://github.com/coder/libghostty-vt-node/releases/tag/v0.1.0-beta.2) - 2026-10-30

## Added
- `encodeMouse(event, options)` on every terminal, backed by Ghostty's mouse-protocol encoder with validation of grid geometry, surface coordinates, and pressed-button state. It reads each caller field once, so the value it validates is the value it encodes. In UTF-8 mouse mode (1005), rows whose encoded value is above U+FFFF encode as 4-byte UTF-8, and cells whose encoded value would be a Unicode surrogate throw a `RangeError`. A new `supportsMouseInput` capability marker lets consumers probe at import time ([#12](https://github.com/coder/libghostty-vt-node/pull/12), [#41](https://github.com/coder/libghostty-vt-node/pull/41), [#42](https://github.com/coder/libghostty-vt-node/pull/42)).
- `SnapshotCell` now exposes `faint`, `inverse`, `invisible`, and `strikethrough` SGR attributes, following the same "present only when set" convention as `bold`/`italic`/`underline`. Note that `inverse` is the raw attribute: `foreground`/`background` are not swapped ([#17](https://github.com/coder/libghostty-vt-node/pull/17)).
- `TerminalSnapshot.cursorVisible: boolean` reflects DECTCEM state (`ESC[?25h` / `ESC[?25l`). The field is required, so code that constructs its own `TerminalSnapshot` objects must set it ([#17](https://github.com/coder/libghostty-vt-node/pull/17), [#38](https://github.com/coder/libghostty-vt-node/pull/38)).
- EGM contract READMEs for `src/`, `native/`, `scripts/`, and `examples/`, plus Blueprint sections appended to the root README. `native/README.md` and `scripts/README.md` are shipped in the npm tarball ([#29](https://github.com/coder/libghostty-vt-node/pull/29)).

## Changed
- Pinned Ghostty to `v1.4.0` (and Zig to `0.17.0` for source builds). DECSTR soft resets (`ESC[!p`) now apply, and consumers inherit upstream Ghostty 1.4.0 behavior changes including reflow cursor placement, C0/C1 control characters no longer printing as cells, Unicode 18 width tables, origin-relative CHA/VPA/HPR/VPR, and `formatHtml` no longer appending a trailing newline per page ([#43](https://github.com/coder/libghostty-vt-node/pull/43)).
- Release scripts now fail closed: tag creation stops on `git ls-remote` failures, prebuild assembly stages into a sibling directory before swapping, and `verify-prebuilds.mjs` sets `PREBUILDS_ONLY=1` and asserts the loaded addon came from `prebuilds/` rather than a stale local build ([#31](https://github.com/coder/libghostty-vt-node/pull/31)).
- Documentation no longer lists macOS x64 as a published prebuild target ([#4](https://github.com/coder/libghostty-vt-node/pull/4)).

## Fixed
- Keep the `TerminalWrap` class reference per Node environment so `createTerminal` works correctly from `worker_threads` Workers and from the main thread after a worker that loaded the addon exits. The previous process-wide static could cause V8 aborts (`Cannot create a handle without a HandleScope`) or segfaults ([#23](https://github.com/coder/libghostty-vt-node/pull/23)).
- Range-check `cols`, `rows`, and `scrollbackLimit` for `NaN`, infinities, and out-of-range values before casting in the native layer, replacing undefined behavior with a `RangeError` ([#30](https://github.com/coder/libghostty-vt-node/pull/30)).

## Security
- Upgraded the repo Node toolchain to 26.12.1 for CVE-2026-111497 (Node2Shell). The published package's `engines.node` floor (`>=20.19`) is unchanged ([#21](https://github.com/coder/libghostty-vt-node/pull/21)).

## [v0.1.0-beta.1](https://github.com/coder/libghostty-vt-node/releases/tag/v0.1.0-beta.1) - 2026-04-24

## Added
- Trusted npm publishing automation: merged `release/v*` PRs (or pushed `v*.*.*` tags) now build per-platform prebuilds, assemble them into the npm package layout, verify the local prebuild, and publish to npm with a version-derived dist-tag (`beta`/`rc`/`latest`) ([#1](https://github.com/coder/libghostty-vt-node/pull/1), [#2](https://github.com/coder/libghostty-vt-node/pull/2)).
- `CHANGELOG.md` is now included in the published npm tarball ([#2](https://github.com/coder/libghostty-vt-node/pull/2)).

## Changed
- Published prebuild matrix for this release covers `linux-x64`, `linux-arm64`, and `macos-arm64`. Other platforms must build from source via `npm run build:native` ([#2](https://github.com/coder/libghostty-vt-node/pull/2)).
