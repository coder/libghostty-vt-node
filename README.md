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

// The child enables normal mouse tracking plus SGR encoding.
term.feed("\x1b[?1000h\x1b[?1006h");
const mouseBytes = term.encodeMouse(
  { action: "press", button: "left", x: 25, y: 45 },
  {
    geometry: {
      screenWidth: 800,
      screenHeight: 600,
      cellWidth: 10,
      cellHeight: 20,
    },
  },
);
// Write mouseBytes to the child PTY.

console.log(getNativeInfo());
console.log(term.getVisibleText());
console.log(term.snapshot({ includeCells: true }));

term.dispose();
```

The public contract is intentionally small:

- `createTerminal({ cols, rows, scrollbackLimit })`
- `feed(data)`, `resize(cols, rows)`, `snapshot(options)`, `getVisibleText()`
- `encodeMouse(event, options)` for mode-aware terminal mouse bytes
- optional debug formatters `formatPlain()` and `formatHtml()`
- explicit, idempotent `dispose()`
- `getNativeInfo()` for package, Node-API, platform, and Ghostty build metadata

All dimensions are validated as positive integers. Using a terminal after `dispose()` throws.

### Mouse encoding

`encodeMouse` returns a `Buffer` containing the terminal input bytes for one
normalized mouse event. It returns an empty buffer when the child has mouse
tracking disabled or when its negotiated mode suppresses that event. The child
selects X10, UTF-8, SGR, URXVT, or SGR-pixels through the output previously
passed to `feed`; callers do not choose a wire format independently.

Event coordinates are finite surface-space numbers. Geometry is explicit so
SGR-pixels remains accurate and the other formats can map the same position to
a terminal cell. `anyButtonPressed` supplies the caller-owned aggregate button
state needed for drag events outside the viewport. `trackLastCell` asks Ghostty
to suppress duplicate motion events within one unchanged cell.

Buttons `four`, `five`, `six`, and `seven` conventionally represent wheel up,
wheel down, wheel left, and wheel right. The binding keeps Ghostty's names at
this low-level API boundary so consumers can provide their own user-facing
aliases.

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
- mode-aware mouse input: `ghostty_mouse_encoder_*`, `ghostty_mouse_event_*`
- plain/HTML debug formatting: `ghostty_formatter_terminal_new`, `ghostty_formatter_format_alloc`
- structured snapshots: `ghostty_terminal_grid_ref`, `ghostty_grid_ref_cell`, `ghostty_grid_ref_graphemes`, `ghostty_grid_ref_style`, `ghostty_cell_get`

The upstream API is still marked unstable by Ghostty. Keep the pinned commit updated intentionally and rerun the dogfood bundle after each pin change.

## Known Limitations

- No screenshot, PNG, WebM, browser, or GUI rendering API is provided.
- Structured snapshots expose visible cells and optional scrollback lines, not the full Ghostty render-state API.
- Grapheme and style extraction follows the current C API and may need adjustment when Ghostty changes ABI.
- On macOS, Zig native target discovery may require an explicit SDK/sysroot setup depending on the local Xcode/Zig combination.
