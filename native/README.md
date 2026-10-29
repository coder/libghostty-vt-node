# native

## Overview

`native/` holds the C++ source of the Node-API addon. node-gyp builds it as the target `libghostty_vt_node` from `addon.cc`, `libghostty_vt_shim.cc`, and `terminal.cc`, with `node-addon-api`, and links it statically against `libghostty-vt` ([`binding.gyp`](../binding.gyp)). The ObjectWrap class `TerminalWrap` owns one libghostty-vt `GhosttyTerminal`. JavaScript sees it as `GhosttyVtTerminal`. The addon exports `createTerminal` and `getNativeInfo`. [`src/`](https://github.com/coder/libghostty-vt-node/blob/main/src/README.md) loads the addon and wraps it. The shim files turn libghostty-vt result codes into error text and encode UTF-8 and hex colors.

## Interface

Build ([`binding.gyp`](../binding.gyp)):

- Target `libghostty_vt_node` with sources `native/addon.cc`, `native/libghostty_vt_shim.cc`, and `native/terminal.cc` [binding.gyp:target_name]
- Include dirs: `require('node-addon-api').include` and the output of `node scripts/resolve-libghostty-vt.mjs include`. Dependency: `require('node-addon-api').gyp` [binding.gyp:include_dirs]
- Library: the output of `node scripts/resolve-libghostty-vt.mjs library`, the path of the static archive (`libghostty-vt.a`, or `ghostty-vt-static.lib` on win32). See [`scripts/`](../scripts/README.md) [binding.gyp:libraries]
- Defines `NAPI_VERSION=8`, `NAPI_CPP_EXCEPTIONS`, and `GHOSTTY_STATIC`. C++ flags are `-std=c++17 -fexceptions` (on macOS through `xcode_settings`, with `libc++`) [binding.gyp:defines]

JavaScript exports:

- Module init `InitAll(env, exports)` runs `TerminalWrap::Init` and sets `exports.getNativeInfo`. `NODE_API_MODULE(libghostty_vt_node, InitAll)` registers it [native/addon.cc:InitAll]
- `TerminalWrap::Init` defines the class `GhosttyVtTerminal` with the instance methods `feed`, `resize`, `snapshot`, `getVisibleText`, `formatPlain`, `formatHtml`, and `dispose`, and sets `exports.createTerminal`. It does not put the class constructor on `exports` [native/terminal.cc:TerminalWrap::Init]
- `createTerminal(options: { cols, rows, scrollbackLimit? })`: returns a new `GhosttyVtTerminal` [native/terminal.cc:CreateTerminal]
- `getNativeInfo()`: returns `{ napiVersion, ghosttyVersion?, ghosttyCommit? }`. `napiVersion` comes from `napi_get_version` at run time, not from the compiled `NAPI_VERSION`. `ghosttyVersion` comes from `GHOSTTY_BUILD_INFO_VERSION_STRING` and `ghosttyCommit` from `GHOSTTY_BUILD_INFO_VERSION_BUILD` [native/terminal.cc:GetNativeInfo]
- `feed(data: string | Buffer | Uint8Array)`: writes the bytes (a string as UTF-8) [native/terminal.cc:TerminalWrap::Feed]
- `resize(cols, rows)`: calls `ghostty_terminal_resize(terminal, cols, rows, 0, 0)` [native/terminal.cc:TerminalWrap::Resize]
- `snapshot(options?: { includeScrollback?, includeCells? })`: returns `{ cols, rows, cursorRow, cursorCol, cursorVisible, isAltScreen, visibleLines, scrollbackLines?, cells? }`. Each entry of `visibleLines` and `scrollbackLines` is `{ row, text }`. `cursorVisible` is always set, from `GHOSTTY_TERMINAL_DATA_CURSOR_VISIBLE` (DECTCEM). `isAltScreen` is true when the active screen is `GHOSTTY_TERMINAL_SCREEN_ALTERNATE` [native/terminal.cc:TerminalWrap::BuildSnapshot]
- A snapshot cell is `{ row, col, text, width }`. A styled cell can also carry `bold`, `italic`, `underline`, `faint`, `inverse`, `invisible`, and `strikethrough` (each set only when true) and `foreground` / `background` as `#rrggbb`. `inverse` is the raw SGR 7 flag: `foreground` and `background` are not swapped [native/terminal.cc:TerminalWrap::BuildCellObject]
- `getVisibleText()`: the active-screen rows joined by `\n` [native/terminal.cc:TerminalWrap::GetVisibleText]
- `formatPlain()` and `formatHtml()`: libghostty-vt formatter output in plain or HTML format, with `trim = true` and `unwrap = false` [native/terminal.cc:TerminalWrap::FormatPlain] [native/terminal.cc:TerminalWrap::FormatHtml] [native/terminal.cc:TerminalWrap::Format]
- `dispose()`: frees the native terminal [native/terminal.cc:TerminalWrap::Dispose]

C++ declarations:

- `class TerminalWrap final : public Napi::ObjectWrap<TerminalWrap>`, with the member `GhosttyTerminal terminal_ = nullptr`, and the free functions `CreateTerminal` and `GetNativeInfo` [native/terminal.hh:TerminalWrap]
- Shim helpers `ResultName`, `ResultMessage`, `GhosttyStringToString`, `BuildInfoString`, `Utf8FromCodepoint`, and `HexColor`. The header defines `GHOSTTY_STATIC` when it is not defined, then includes `<ghostty/vt.h>` [native/libghostty_vt_shim.hh:ResultMessage]
- `ResultMessage(op, result)` returns `"<op> failed: <ResultName>"` [native/libghostty_vt_shim.cc:ResultMessage]. `ResultName` maps unknown codes to `GHOSTTY_UNKNOWN_RESULT` [native/libghostty_vt_shim.cc:ResultName]
- Private helpers: `BuildLines` (rows of one point tag), `ReadLine`, `ReadCellText` (grapheme or single-codepoint text), `ResolveStyleColor`, `OptionBool`, and `ThrowResult` [native/terminal.cc:TerminalWrap::BuildLines] [native/terminal.cc:TerminalWrap::ReadCellText]

## Invariants

- `createTerminal` and the constructor throw `TypeError("createTerminal options must be an object")` unless they get exactly one object argument [native/terminal.cc:CreateTerminal].
- `cols` and `rows`: a non-number throws `TypeError("<name> must be a positive integer")`. `NaN`, an infinity, a value below 1 or above 65535, or a non-integer throws `RangeError("<name> must be a positive 16-bit integer")`. The range check runs before the value is cast to `uint16_t` [native/terminal.cc:PositiveUint16].
- `scrollbackLimit` is skipped when it is absent or `undefined`, and then defaults to 0. A non-number throws `TypeError`. `NaN`, an infinity, a negative value, a non-integer, or a value too large for `size_t` (2^64 or more on 64-bit targets) throws `RangeError`. Both use `"scrollbackLimit must be a non-negative integer"`, and the range check runs before the cast [native/terminal.cc:NonNegativeSize].
- Most failed libghostty-vt calls throw an `Error` with `ResultMessage` text, for example `"ghostty_terminal_new failed: GHOSTTY_OUT_OF_MEMORY"` [native/terminal.cc:ThrowResult]. These do not throw: a failed palette read leaves the color out, a failed `ghostty_build_info` leaves the field out, a first `ghostty_grid_ref_graphemes` call that does not return `GHOSTTY_OUT_OF_SPACE` with `required > 0` falls back to the single codepoint, and the code checks no result from `ghostty_terminal_vt_write` [native/terminal.cc:TerminalWrap::ResolveStyleColor] [native/terminal.cc:TerminalWrap::ReadCellText] [native/terminal.cc:TerminalWrap::Feed].
- Every method except `dispose` calls `RequireTerminal` first. After dispose it throws `Error("GhosttyVtTerminal has been disposed")` [native/terminal.cc:TerminalWrap::RequireTerminal]. With `NAPI_CPP_EXCEPTIONS`, `RequireTerminal` reports a disposed terminal by throwing, so the `env.IsExceptionPending()` checks after it do not see that error.
- `feed` throws `TypeError` for an argument count other than 1 (`"feed expects exactly one argument"`), for a typed array that is not a `Uint8Array` (`"feed typed array must be Uint8Array"`), and for any other value (`"feed data must be a string, Buffer, or Uint8Array"`). Zero-length input returns without a libghostty-vt call [native/terminal.cc:TerminalWrap::Feed].
- `resize` throws `TypeError("resize expects cols and rows")` for an argument count other than 2. It checks `cols` and `rows` as the constructor does [native/terminal.cc:TerminalWrap::Resize].
- `snapshot` throws `TypeError("snapshot options must be an object")` for a defined non-object argument [native/terminal.cc:TerminalWrap::Snapshot]. `includeScrollback` and `includeCells` count only when they are boolean `true` [native/terminal.cc:OptionBool].
- `snapshot`, `getVisibleText`, `formatPlain`, and `formatHtml` catch `std::exception` from the internal helpers and rethrow it as a JavaScript `Error` with the same message [native/terminal.cc:TerminalWrap::Snapshot].
- `dispose` is idempotent. `DisposeNative` returns early when `terminal_` is `nullptr`. Otherwise it frees the terminal and sets `terminal_` to `nullptr` [native/terminal.cc:TerminalWrap::DisposeNative].
- Per-environment state: `Init` keeps the class constructor in the env's instance data, not in a static, so the main thread and each `worker_threads` Worker that loads the addon have their own. `Init` asserts that the instance data is unset before it sets it [native/terminal.cc:TerminalWrap::Init]. `Create` asserts that the constructor is set [native/terminal.cc:TerminalWrap::Create].
- Lines skip wide spacer cells, write `' '` for cells with no text, and drop trailing spaces. A cell that has text but codepoint 0 adds nothing to the line [native/terminal.cc:TerminalWrap::ReadLine] [native/terminal.cc:TerminalWrap::ReadCellText].
- Snapshot cells come from visible rows only, because `BuildLines` passes no cell list for scrollback. They include only cells with text. `width` is 2 for a wide cell and 1 otherwise [native/terminal.cc:TerminalWrap::BuildSnapshot] [native/terminal.cc:TerminalWrap::BuildCellObject].
- `scrollbackLines` rows are numbered from 0 with the history point tag. The count is clamped to the `uint32_t` maximum [native/terminal.cc:TerminalWrap::BuildSnapshot].
- An unknown color tag fails `assert(false)` [native/terminal.cc:TerminalWrap::ResolveStyleColor].
- `getNativeInfo` leaves out `ghosttyVersion` and `ghosttyCommit` when `BuildInfoString` returns an empty string, which it does when `ghostty_build_info` fails [native/terminal.cc:GetNativeInfo] [native/libghostty_vt_shim.cc:BuildInfoString].
- `Utf8FromCodepoint` asserts `codepoint <= 0x10FFFF` [native/libghostty_vt_shim.cc:Utf8FromCodepoint]. `HexColor` asserts that it wrote 7 characters [native/libghostty_vt_shim.cc:HexColor].

## Side Effects

- The constructor allocates a native terminal with `ghostty_terminal_new(nullptr, &created, options)` (default allocator) and stores it in `terminal_` [native/terminal.cc:TerminalWrap::TerminalWrap].
- `DisposeNative` frees it with `ghostty_terminal_free` [native/terminal.cc:TerminalWrap::DisposeNative]. The destructor calls `DisposeNative`, so garbage collection of an undisposed object also frees the terminal [native/terminal.cc:TerminalWrap::~TerminalWrap].
- `feed` changes terminal state through `ghostty_terminal_vt_write` [native/terminal.cc:TerminalWrap::Feed]. `resize` changes the size through `ghostty_terminal_resize` [native/terminal.cc:TerminalWrap::Resize].
- `Format` creates a formatter, calls `ghostty_formatter_format_alloc`, frees the formatter, then frees the output buffer with `ghostty_free(nullptr, ptr, len)` [native/terminal.cc:TerminalWrap::Format].
- `Init` allocates a `Napi::FunctionReference` and stores it with `env.SetInstanceData`. The code comment says Node deletes it when the env shuts down [native/terminal.cc:TerminalWrap::Init].
- The addon links the `libghostty-vt` static library that the resolver script finds [binding.gyp:libraries].

## Verification

- Run (after `npm ci`): `npm run build:libghostty && npm run build:native && npm test`
- Every native test skips when the addon does not load (`test/native-support.ts:nativeSupport`), so check the test output for skips.
- `mise run ci-ubsan` builds the addon with UBSan (Linux, GCC), then runs the tests and smoke. Undefined behavior aborts the run. The task also fails when the addon's object files contain no UBSan checks, which means the flags did not reach g++ (`mise.toml:tasks.ci-ubsan`).
- `test/workers.test.ts` checks the per-environment state in child processes with `worker_threads`. `test/terminal.test.ts` covers `feed`, `snapshot`, `resize`, `dispose`, the `RangeError` cases of the `createTerminal` checks in the addon, `cursorVisible`, and the cell style fields. No vitest test covers `formatPlain`, `formatHtml`, `includeScrollback`, or the typed-array errors.
- For changes to `TerminalWrap` or `InitAll`, also run the TLA+ lifecycle model: [`.agents/skills/verify-native-lifecycle/SKILL.md`](https://github.com/coder/libghostty-vt-node/blob/main/.agents/skills/verify-native-lifecycle/SKILL.md).
