# examples

## Overview

`examples/` holds one file, `smoke.ts`. It is a smoke script for the package API in [`src/`](../src/README.md). It creates one 80x24 terminal, feeds it plain text, an SGR color sequence, a cursor-position sequence, and the mouse modes 1000 and 1006, encodes one mouse press, and prints the native info, the visible text, the mouse bytes, and a snapshot summary to stdout. The mise task `ci` runs it as its last step.

`smoke.ts` defines no symbols, so the citations below use line numbers.

## Interface

- `npm run smoke` runs `tsx examples/smoke.ts` [package.json:scripts.smoke].
- Callers: the mise task `ci` runs `npm run smoke` after `npm ci`, `npm run build:libghostty`, `npm run build:native`, `npm run build`, and `npm test` [mise.toml:tasks.ci]. `npm run verify` runs it after `npm run typecheck && npm test` [package.json:scripts.verify].
- `smoke.ts` imports `createTerminal` and `getNativeInfo` from the TypeScript source `../src/index.js`, not from `dist/` [examples/smoke.ts:1].
- Calls, in order: `createTerminal({ cols: 80, rows: 24, scrollbackLimit: 100 })` [examples/smoke.ts:3], then `term.feed` four times (`"hello\n"`, `"\x1b[31mred text\x1b[0m\n"`, `"\x1b[3;5Hcursor"`, `"\x1b[?1000h\x1b[?1006h"`) [examples/smoke.ts:5], then `term.encodeMouse({ action: "press", button: "left", x: 4, y: 5 }, { geometry: { screenWidth: 80, screenHeight: 24, cellWidth: 1, cellHeight: 1 } })` [examples/smoke.ts:11], then `term.snapshot({ includeCells: true })` [examples/smoke.ts:23], `getNativeInfo()` [examples/smoke.ts:25], and `term.getVisibleText()` [examples/smoke.ts:27], and `term.dispose()` in `finally` [examples/smoke.ts:46].

## Invariants

- `smoke.ts` has no assertions. It does not compare output with expected values, and it fails only when a call throws [examples/smoke.ts:5].
- `term.dispose()` runs in `finally`, after the `try` body succeeds or throws. The error is not caught, so it ends the script [examples/smoke.ts:46].
- `createTerminal` runs before the `try`. If it throws, no dispose runs [examples/smoke.ts:3].
- The most likely failure is a missing addon: `createTerminal` then throws `"Failed to load @coder/libghostty-vt-node native addon. ..."`, which names `npm run build:native`, a matching prebuild, and `npm run build:libghostty` or `LIBGHOSTTY_VT_PREFIX` [src/loader.ts:loadNative].

## Side Effects

- Prints `native info` and the `getNativeInfo()` JSON (the addon's info plus `packageVersion`, `platform`, and `arch`), `visible text` and the visible text, `mouse bytes` and the encoded bytes as a JSON array of numbers, and `snapshot summary` with a JSON object of `cols`, `rows`, `cursorRow`, `cursorCol`, `isAltScreen`, `visibleLineCount`, and `cellCount` [examples/smoke.ts:24] [src/loader.ts:decorateNativeInfo].
- Loads the native addon through `loadNative()` on the first API call, `createTerminal` [src/index.ts:createTerminal].
- An uncaught error ends the process with a non-zero exit code, which fails `npm run smoke` and the mise task `ci`. `smoke.ts` writes no files [examples/smoke.ts:46].

## Verification

- Run (after `npm ci`): `npm run build:libghostty && npm run build:native && npm run smoke`
