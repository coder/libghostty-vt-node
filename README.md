# @coder/libghostty-vt-node

ABI-stable Node-API bindings for Ghostty's `libghostty-vt` terminal state engine.

This package exposes terminal VT/state semantics for Node.js consumers: feed terminal bytes, resize the terminal, read visible plain text, and extract a structured snapshot of visible rows and styled cells.

It is not a screenshot, PNG, video, browser, or GUI renderer. HTML/plain formatting, where exposed, is for debugging and export only. Raster rendering remains outside this package's scope.

## Upstream References

This bootstrap was written against:

- Ghostty repository commit `48ccec182a932c2ec04c344d45a5fc553861cb13`
- go-libghostty commit `542c76ff595ad533348e23aac74489ad095e0b36`, used only as API inspiration
- Ghostty VT docs: <https://ghostty.org/docs/vt>
- libghostty Doxygen: <https://libghostty.tip.ghostty.org/>
- Node-API docs: <https://nodejs.org/api/n-api.html>

The binding talks to `libghostty-vt` directly through the C API. It has no runtime dependency on `go-libghostty`.

## API

```ts
import { createTerminal, getNativeInfo } from "@coder/libghostty-vt-node";

const term = createTerminal({ cols: 80, rows: 24, scrollbackLimit: 1000 });
term.feed("hello\n");
term.feed("\x1b[31mred\x1b[0m");

console.log(getNativeInfo());
console.log(term.getVisibleText());
console.log(term.snapshot({ includeCells: true }));

term.dispose();
```

The public contract is intentionally small:

- `createTerminal({ cols, rows, scrollbackLimit })`
- `feed(data)`, `resize(cols, rows)`, `snapshot(options)`, `getVisibleText()`
- optional debug formatters `formatPlain()` and `formatHtml()`
- explicit, idempotent `dispose()`
- `getNativeInfo()` for package, Node-API, platform, and Ghostty build metadata

All dimensions are validated as positive integers. Using a terminal after `dispose()` throws.

## Native Build

The addon uses `node-addon-api` over Node-API/N-API and is built with `node-gyp`. Runtime loading uses `node-gyp-build`, so npm packages can ship prebuilt `.node` files.

For local development:

```sh
npm install
npm run build:libghostty
npm run build:native
npm run build
npm test
npm run smoke
```

`npm run build:libghostty` fetches the pinned Ghostty commit into `vendor/ghostty` and installs a static `libghostty-vt` into `vendor/libghostty-vt`. The default uses `-Dsimd=false` for a dependency-minimal static library. Set `LIBGHOSTTY_VT_SIMD=true` to build SIMD support when your build environment supports it.

You can also provide an existing install:

```sh
LIBGHOSTTY_VT_PREFIX=/path/to/libghostty-vt npm run build:native
```

or:

```sh
LIBGHOSTTY_VT_INCLUDE_DIR=/path/to/include \
LIBGHOSTTY_VT_STATIC_LIB=/path/to/libghostty-vt.a \
npm run build:native
```

If `libghostty-vt` is unavailable, `node-gyp` fails early with a setup message from `scripts/resolve-libghostty-vt.mjs`. If the built addon cannot load, the ESM loader throws a clear error with the expected recovery commands.

## Prebuilds

The intended distribution path is prebuilt binaries bundled in npm packages via `npm run build:prebuild` and loaded by `node-gyp-build`. The script is named `build:prebuild` rather than `prebuild` so `npm run build` does not trigger npm's `prebuild` lifecycle hook.

GitHub Actions run the same mise tasks used in development. Keep build, test, and prebuild commands in `mise.toml`; the workflow YAML should only contain GitHub-specific orchestration such as runner matrices and artifact uploads.

To reset a workflow to the mise-generated baseline:

```sh
mise gen github-action --write --task ci --name ci
mise gen github-action --write --task release-prebuilds --name release-prebuilds
```

If a generated workflow is reset, reapply only the matrix/upload orchestration. Do not duplicate pipeline commands in `.github/workflows/*.yml`; those commands live in the `ci` and `release-prebuilds` mise tasks.

Default published prebuild targets:

- Linux x64
- Linux arm64
- macOS arm64

Windows is documented as unsupported for the initial package. Ghostty has C API support for Windows, but this package should only enable Windows after the build and prebuild path is verified.

## Releases

Publishing is handled by `.github/workflows/publish.yml` with npm Trusted Publishing. The normal release path is a protected-main PR from a branch named `release/v*`:

```sh
git checkout main
git pull --ff-only origin main
git checkout -b release/v0.1.0-beta.1
npm version 0.1.0-beta.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v0.1.0-beta.1"
git push origin release/v0.1.0-beta.1
```

Open that branch as a PR into `main`. When the PR is merged, the publish workflow builds all prebuild artifacts from the merge commit, creates the matching Git tag, assembles the npm package layout, verifies the local platform prebuild, and publishes to npm. The workflow fails if the release branch does not match `package.json` exactly, such as `release/v0.1.0-beta.1`.

The npm dist-tag is derived from the package version:

- `0.1.0-beta.0` publishes with `--tag beta`
- `0.1.0-rc.0` publishes with `--tag rc`
- `0.1.0` publishes with `--tag latest`

Manual dispatch and direct `v*.*.*` tag pushes are available for recovery, but merged `release/v*` PRs should be the default path.

## Development Notes

The native layer currently uses these verified `libghostty-vt` C APIs:

- terminal lifecycle and stream processing: `ghostty_terminal_new`, `ghostty_terminal_vt_write`, `ghostty_terminal_resize`, `ghostty_terminal_free`
- metadata and state: `ghostty_terminal_get`, `ghostty_build_info`
- plain/HTML debug formatting: `ghostty_formatter_terminal_new`, `ghostty_formatter_format_alloc`
- structured snapshots: `ghostty_terminal_grid_ref`, `ghostty_grid_ref_cell`, `ghostty_grid_ref_graphemes`, `ghostty_grid_ref_style`, `ghostty_cell_get`

The upstream API is still marked unstable by Ghostty. Keep the pinned commit updated intentionally and rerun the dogfood bundle after each pin change.

## Known Limitations

- No screenshot, PNG, WebM, browser, or GUI rendering API is provided.
- Structured snapshots expose visible cells and optional scrollback lines, not the full Ghostty render-state API.
- Grapheme and style extraction follows the current C API and may need adjustment when Ghostty changes ABI.
- On macOS, Zig native target discovery may require an explicit SDK/sysroot setup depending on the local Xcode/Zig combination.

## System Overview

The package has four layers:

1. A consumer imports `dist/index.js`, which `tsc` compiles from [`src/`](https://github.com/coder/libghostty-vt-node/blob/main/src/README.md). `src/index.ts` checks arguments, and `src/loader.ts` loads the native addon with `node-gyp-build` on the first API call.
2. The addon in [`native/`](./native/README.md) wraps one libghostty-vt `GhosttyTerminal` per `TerminalWrap` object and exports `createTerminal` and `getNativeInfo`.
3. `libghostty-vt` is a static library that the addon links. `scripts/build-libghostty-vt.sh` builds it from a pinned Ghostty commit, and `binding.gyp` finds it with `scripts/resolve-libghostty-vt.mjs` (see [`scripts/`](./scripts/README.md)).
4. The release scripts in [`scripts/`](./scripts/README.md) assemble per-platform prebuilds, tag the release, and pick the npm dist-tag. [`examples/`](https://github.com/coder/libghostty-vt-node/blob/main/examples/README.md) holds the smoke script that the mise task `ci` runs last.

## Subdirectories & System Boundaries

- `src`: [`src/README.md`](https://github.com/coder/libghostty-vt-node/blob/main/src/README.md) - TypeScript package API (`createTerminal`, `getNativeInfo`, and the snapshot types), argument checks, disposal tracking, and the lazy, cached addon loader.
- `native`: [`./native/README.md`](./native/README.md) - Node-API C++ addon (`TerminalWrap`, JavaScript class `GhosttyVtTerminal`) over the libghostty-vt C API, with per-environment class state for `worker_threads`.
- `scripts`: [`./scripts/README.md`](./scripts/README.md) - libghostty-vt build and path resolver, prebuild assembly and check, release tag creation, and npm dist-tag choice.
- `examples`: [`examples/README.md`](https://github.com/coder/libghostty-vt-node/blob/main/examples/README.md) - `smoke.ts`, run by `npm run smoke`.
- `test` (no contract): vitest suites for the loader, the terminal API, and `worker_threads` loading.
- `dogfood` (no contract): a plain-text proof bundle from the repository bootstrap.

## Global Invariants

- Arguments are checked in both layers. `createTerminal` options: [src/index.ts:normalizeCreateOptions] (before the addon loads) and [native/terminal.cc:TerminalWrap::TerminalWrap]. `resize`: [src/index.ts:Terminal] and [native/terminal.cc:TerminalWrap::Resize]. `feed`: [src/index.ts:assertFeedData] and [native/terminal.cc:TerminalWrap::Feed]. `snapshot` options: [src/index.ts:normalizeSnapshotOptions] and [native/terminal.cc:TerminalWrap::Snapshot].
- The two layers throw different errors for the same input. A non-object option gets an `AssertionError` from `src/` and a `TypeError` from the addon. `src/` sets no upper bound on `cols` and `rows`, and the addon throws a `RangeError` above 65535 [native/terminal.cc:PositiveUint16].
- Both layers track disposal and throw `"GhosttyVtTerminal has been disposed"` after `dispose()`. `dispose()` is idempotent in both layers [src/index.ts:Terminal] [native/terminal.cc:TerminalWrap::DisposeNative].
- The loader requires the addon to export the functions `createTerminal` and `getNativeInfo` [src/loader.ts:assertNativeShape]. The addon sets them in [native/terminal.cc:TerminalWrap::Init] and [native/addon.cc:InitAll].
- The addon can load in the main thread and in each `worker_threads` Worker, because `TerminalWrap::Init` keeps the class constructor in per-env instance data [native/terminal.cc:TerminalWrap::Init].
- The default Ghostty commit in [scripts/build-libghostty-vt.sh:GHOSTTY_COMMIT] is the commit that "Upstream References" names. Change both together.
- Build order: `npm ci`, `npm run build:libghostty`, `npm run build:native`, `npm run build`, `npm test`, `npm run smoke` [mise.toml:tasks.ci]. `npm run build:native` fails early when the libghostty-vt header or static library is missing [scripts/resolve-libghostty-vt.mjs:fail].
- The npm package ships `dist`, `native`, `scripts`, `binding.gyp`, `prebuilds`, `CHANGELOG.md`, `README.md`, and `LICENSE` [package.json:files].
- A release tag is `v<version>` from `package.json`. When `RELEASE_BRANCH_NAME` is set and not empty, it must be `release/v<version>` [scripts/create-release-tag.mjs:releaseBranchName]. The tag must point at the checked-out `HEAD` [scripts/create-release-tag.mjs:releaseTargetSha].
- The npm dist-tag is the lower-cased first prerelease identifier, or `latest` for a plain version. A non-empty `NPM_PUBLISH_TAG` overrides it [scripts/resolve-npm-publish-tag.mjs:prerelease].

## Global Side Effects

- Network and disk: every `npm run build:libghostty` fetches the pinned Ghostty commit, by default into `vendor/ghostty`, and installs `libghostty-vt` and `ghostty-source.json`, by default into `vendor/libghostty-vt`. `GHOSTTY_SOURCE_DIR` and `LIBGHOSTTY_VT_PREFIX` change these paths [scripts/build-libghostty-vt.sh:GHOSTTY_REPO].
- Disk: `npm run build:native` runs `node-gyp rebuild` [package.json:scripts.build:native], and `npm run build` writes `dist/` [tsconfig.json:outDir]. `npm run build:prebuild` runs `prebuildify --napi` [package.json:scripts.build:prebuild]. `npm run assemble:prebuilds` replaces `prebuilds/` after its checks pass [scripts/assemble-prebuilds.mjs:targetRoot].
- Remote state: the release tag script pushes `v<version>` to `origin` [scripts/create-release-tag.mjs:git]. The mise task `publish` runs `npm publish --access public --tag "$(node scripts/resolve-npm-publish-tag.mjs)"` [mise.toml:tasks.publish]. `.github/workflows/publish.yml` also creates or updates a GitHub Release, and `.github/workflows/release-changelog.yml` commits a `CHANGELOG.md` entry to the release PR branch, pushes it, and starts `ci.yml`.
- Runtime memory: each `createTerminal` call allocates a native terminal. `dispose()` or garbage collection frees it [native/terminal.cc:TerminalWrap::~TerminalWrap].

## System Verification

- Run: `mise run ci`
- `.github/workflows/ci.yml` runs the same task. Without mise, run the steps in "Native Build" above.
- Packaged-install journeys: [`.agents/skills/verify-libghostty-vt-node/SKILL.md`](https://github.com/coder/libghostty-vt-node/blob/main/.agents/skills/verify-libghostty-vt-node/SKILL.md)
- TLA+ model of the native lifecycle: [`.agents/skills/verify-native-lifecycle/SKILL.md`](https://github.com/coder/libghostty-vt-node/blob/main/.agents/skills/verify-native-lifecycle/SKILL.md)
