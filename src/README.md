# src

## Overview

`src/` is the TypeScript layer of `@coder/libghostty-vt-node`. `tsc` compiles it to `dist/` (`tsconfig.json` sets `rootDir: src` and `outDir: dist`), and `package.json` `exports["."]` points at `./dist/index.js` and `./dist/index.d.ts`. `index.ts` checks arguments and wraps each native terminal in a `Terminal` object that tracks disposal. `loader.ts` loads the addon that [`native/`](../native/README.md) builds, on first use. `types.ts` holds the public type contracts and the shape that the loader expects from the addon.

## Interface

Package API (exported by `index.ts`):

- `createTerminal(options: CreateTerminalOptions): GhosttyVtTerminal` [src/index.ts:createTerminal]
- `getNativeInfo(): NativeInfo`: the addon's info plus `packageVersion`, `platform`, and `arch` [src/index.ts:getNativeInfo]
- `CreateTerminalOptions`: `{ cols: number; rows: number; scrollbackLimit?: number }` [src/types.ts:CreateTerminalOptions]
- `SnapshotOptions`: `{ includeScrollback?: boolean; includeCells?: boolean }` [src/types.ts:SnapshotOptions]
- `VisibleLine`: `{ row: number; text: string }` [src/types.ts:VisibleLine]
- `SnapshotCell`: `{ row; col; text; width; bold?; italic?; underline?; foreground?; background? }` [src/types.ts:SnapshotCell]
- `TerminalSnapshot`: `{ cols; rows; cursorRow; cursorCol; isAltScreen; visibleLines; scrollbackLines?; cells? }` [src/types.ts:TerminalSnapshot]
- `GhosttyVtTerminal`: `feed(data)`, `resize(cols, rows)`, `snapshot(options?)`, `getVisibleText()`, optional `formatPlain()` and `formatHtml()`, and `dispose()` [src/types.ts:GhosttyVtTerminal]. The object that `createTerminal` returns has both format methods [src/index.ts:Terminal].
- `NativeInfo`: `{ packageVersion; napiVersion; ghosttyVersion?; ghosttyCommit?; platform; arch }` [src/types.ts:NativeInfo]

Internal (not exported by the package):

- `class Terminal implements GhosttyVtTerminal`: holds a private `#native: NativeTerminal` and a `#disposed` flag [src/index.ts:Terminal]
- `loader.ts` module exports `loadNative(): NativeBindings`, `getPackageVersion(): string`, and `decorateNativeInfo(info): NativeInfo`. `index.ts` imports `loadNative` and `decorateNativeInfo` and does not re-export them [src/loader.ts:loadNative] [src/loader.ts:getPackageVersion] [src/loader.ts:decorateNativeInfo]
- `NativeTerminal`: the methods that the addon's terminal object has, with `formatPlain` and `formatHtml` required [src/types.ts:NativeTerminal]
- `NativeBindings`: the addon exports that the loader expects (`createTerminal`, `getNativeInfo`) [src/types.ts:NativeBindings]
- Private helpers: `assertPositiveInteger`, `assertNonNegativeInteger`, `normalizeCreateOptions`, `normalizeSnapshotOptions`, and `assertFeedData` in `index.ts`, and `assertNativeShape`, `packageJson`, `packageRoot`, and `cachedBindings` in `loader.ts` [src/index.ts:assertFeedData] [src/loader.ts:assertNativeShape]

## Invariants

- `createTerminal` checks its options before it loads the addon. Invalid options throw even when no addon is built [src/index.ts:createTerminal].
- `cols` and `rows` (in `createTerminal` and `resize`) must be integers greater than 0. Otherwise the code throws `TypeError("<name> must be a positive integer")` [src/index.ts:assertPositiveInteger]. This layer sets no upper bound. The addon rejects values above 65535 with a `RangeError` [native/terminal.cc:PositiveUint16].
- `scrollbackLimit`, when it is not `undefined`, must be an integer of 0 or more. Otherwise the code throws `TypeError("scrollbackLimit must be a non-negative integer")` [src/index.ts:assertNonNegativeInteger].
- `createTerminal` options must be a non-null object. Otherwise `node:assert/strict` throws an `AssertionError` with `"options must be an object"` or `"options must not be null"`. The addon receives a new object with `cols`, `rows`, and `scrollbackLimit` (only when defined). Other properties are dropped [src/index.ts:normalizeCreateOptions].
- `snapshot()` with no options passes `{}`. Other options must be a non-null object, or an `AssertionError` says `"snapshot options must be an object"` or `"snapshot options must not be null"`. `includeScrollback` and `includeCells` become `true` only when they are strictly `=== true` [src/index.ts:normalizeSnapshotOptions].
- `feed` accepts a string or a `Uint8Array` (a `Buffer` is one). Any other value throws `TypeError("feed data must be a string, Buffer, or Uint8Array")` [src/index.ts:assertFeedData].
- The `Terminal` constructor asserts that the addon returned a non-null object (`"native terminal must be an object"`, `"native terminal must not be null"`) [src/index.ts:Terminal].
- After `dispose()`, `feed`, `resize`, `snapshot`, `getVisibleText`, `formatPlain`, and `formatHtml` throw `Error("GhosttyVtTerminal has been disposed")`. The disposed check runs before the argument checks [src/index.ts:Terminal].
- `dispose()` is idempotent: a second call returns without calling the addon. `#disposed` becomes `true` after the native `dispose()` returns [src/index.ts:Terminal].
- The addon export must be a non-null object with the functions `createTerminal` and `getNativeInfo`. The loader checks only these two exports, not the methods of the terminal object [src/loader.ts:assertNativeShape].
- A failed load or a bad addon shape throws an `Error` that starts with `"Failed to load @coder/libghostty-vt-node native addon."`, names `npm run build:native`, a matching prebuild, and `npm run build:libghostty` or `LIBGHOSTTY_VT_PREFIX`, and carries the original error (for a bad shape, the `AssertionError`) as `cause`. A failure is not cached, so the next call tries again [src/loader.ts:loadNative].
- `getNativeInfo` asserts that the addon's `napiVersion` is a number (`"native napiVersion must be a number"`) [src/loader.ts:decorateNativeInfo] and that the `package.json` `version` is a string (`"package version must be a string"`) [src/loader.ts:getPackageVersion]. These checks run after `loadNative` returns, so the load error does not wrap them and the addon stays cached.

## Side Effects

- Importing the module reads `../package.json` synchronously through `createRequire(import.meta.url)`, relative to the compiled file [src/loader.ts:packageJson].
- `packageRoot` is the parent of the module's directory, which is the package root for both `dist/` and `src/` [src/loader.ts:packageRoot].
- The addon loads on the first `createTerminal` or `getNativeInfo` call, not at import, through `require("node-gyp-build")(packageRoot)` [src/loader.ts:loadNative].
- A successful load is cached in the module-level `cachedBindings` [src/loader.ts:cachedBindings].
- `getNativeInfo` reads `process.platform` and `process.arch` [src/loader.ts:decorateNativeInfo].
- `src/` reads no environment variables. `LIBGHOSTTY_VT_PREFIX` appears only in the load-error text [src/loader.ts:loadNative].
- Each `createTerminal` call allocates one native terminal, and `dispose()` frees it. See [`native/`](../native/README.md) for the native side [src/index.ts:createTerminal].

## Verification

- Run (after `npm ci`): `npm run typecheck && npm test`
- Without a built addon, only the `createTerminal validation` suite in `test/terminal.test.ts` runs, and `test/load.test.ts` accepts the load error instead. The native suite in `test/terminal.test.ts` and all of `test/workers.test.ts` skip (`test/native-support.ts:nativeSupport`). `test/workers.test.ts` loads the addon directly, so it tests `native/`, not `src/`. To run the native suite, build the addon first: `npm run build:libghostty && npm run build:native`.
