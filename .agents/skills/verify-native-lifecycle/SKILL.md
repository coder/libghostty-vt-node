---
name: verify-native-lifecycle
description: "Model-check, with TLA+, how the libghostty-vt-node native addon keeps state across Node environments (the main thread and worker_threads Workers) and across one terminal's life (createTerminal, use, dispose, garbage collection). Use when a change touches TerminalWrap or InitAll in native/, the Terminal class or createTerminal in src/index.ts, loadNative in src/loader.ts, or the node-addon-api version, or when someone adds or tests worker-thread support."
---

# Verify the native addon lifecycle

This skill checks a TLA+ model of the addon's native state against five rules. A model checker (TLC) tries every order of steps in the model, within the bounds below. Tests only try the orders that someone wrote.

## The rules

| Rule | In plain words | Harm when it breaks |
|---|---|---|
| `CreateUsesOwnClass` | `createTerminal` in a thread uses the class reference that this thread made. | The process aborts or segfaults when it creates a terminal. |
| `LoadDeletesOnlyOwnRef` | Loading the addon in a thread never deletes another thread's reference. | One thread frees V8 state that belongs to another thread (a data race). |
| `HandleFreedOnce` | libghostty frees each terminal handle at most once. | A double free corrupts the heap. |
| `EncoderFreedOnce` | libghostty frees each mouse encoder handle at most once. | A double free corrupts the heap. |
| `NoCallOnDeadHandle` | No libghostty call reaches a freed or null terminal or mouse encoder handle. | Use after free: a crash, wrong terminal output, or mouse bytes from another terminal. |

## History: finding F1, fixed

This check found F1 in the code before `4aa7039`. The addon kept its class in one `static Napi::FunctionReference constructor` for the whole process, and each environment's `TerminalWrap::Init` overwrote it. After the main thread and a Worker both loaded the addon, the main thread's `createTerminal` used the worker's reference: V8 aborted with `Cannot create a handle without a HandleScope`, or the process segfaulted after the worker exited. The fix keeps one reference for each environment in its instance data. `model/mutant-process-static.cfg` is the old code, and `run.sh` checks at each run that it still breaks `CreateUsesOwnClass` and `LoadDeletesOnlyOwnRef`.

## History: finding F2, fixed

This check found F2 in `encodeMouse` while #12 was in review, so the bug never reached main. #12 landed with the fix as `7366b75`. `TerminalWrap::EncodeMouse` copied `terminal_` and `mouse_encoder_` into locals, and then read its arguments with `Get()`. `Get()` runs getters, including a getter on `Object.prototype` for a key that `src/index.ts` leaves out of the object it passes (`button`, `modifiers`). A getter that called `dispose()` made the libghostty calls use freed handles. Through the package API, the call then encoded with another terminal's encoder state. Through the raw native object, the process crashed. The fix reads every argument first, then takes the handles, and runs no JS until the call returns. `model/mutant-handles-before-reads.cfg` is the old code, and `run.sh` checks at each run that it still breaks `NoCallOnDeadHandle`. `test/mouse-safety.test.ts` replays the getter cases in child processes.

## Does my change touch the verified code?

Run this skill when the diff since the sync commit changes any covered code:

```sh
git diff --stat c54051ec9a4d2eeed2ebf09533ac2e9175fcc79c -- native/ test/workers.test.ts test/mouse-safety.test.ts src/index.ts src/loader.ts package.json package-lock.json
```

Also run it when a change adds a new place that stores a `Napi::Reference`, `Napi::FunctionReference`, or other static or global state in `native/`, or a new path that frees or uses `terminal_` or `mouse_encoder_`. Static or global JS-facing state is the F1 bug class: keep it in the environment's instance data. A native method that copies a handle and then calls `Get()` is the F2 bug class: read every argument before you take the handles.

## Coverage record

Sync commit: `c54051ec9a4d2eeed2ebf09533ac2e9175fcc79c`. At this commit the model describes the code below. Move the sync commit forward only after you confirm that the model still describes the covered code at the new commit.

| Code | Model |
|---|---|
| `native/terminal.cc` `TerminalWrap::Init` and `TerminalWrap::Create` keep the class reference in `env.SetInstanceData` / `env.GetInstanceData` | `CtorStorage = "per_env"`, variable `slot` |
| `native/addon.cc` `InitAll`, `NODE_API_MODULE`; `native/terminal.cc` `TerminalWrap::Init` (asserts an empty instance-data slot, then `env.SetInstanceData`) | `LoadAddon(e)` |
| `src/loader.ts` `loadNative` (caches the addon, so each env loads it once) | `LoadAddon` is enabled only while `env[e] = "idle"` |
| `src/index.ts` `createTerminal`; `native/terminal.cc` `CreateTerminal`, `TerminalWrap::Create` (`constructor->New`), `TerminalWrap::TerminalWrap` (`ghostty_terminal_new`, `ghostty_terminal_set` for the scrollback byte limit, then `ghostty_mouse_encoder_new`) | `CreateTerminal(e, t)` |
| `native/terminal.cc` `TerminalWrap::TerminalWrap` when `ghostty_terminal_set` fails (it frees the terminal before it sets `terminal_`) or `ghostty_mouse_encoder_new` fails (it frees the terminal and sets `terminal_ = nullptr`), and throws, so `~TerminalWrap` does not run | `CreateFails(e, t)` |
| `src/index.ts` `feed`, `resize`, `snapshot`, `getVisibleText`, `formatPlain`, `formatHtml`, `#assertUsable`; `native/terminal.cc` the same methods and `RequireTerminal`. `Resize` can call `ghostty_terminal_resize` twice, with no JS between | `Use(t)`, constants `TsDisposedGuard`, `NativeNullGuard` |
| `src/index.ts` `encodeMouse` (`#assertUsable`, then `normalizeMouseOptions` and `normalizeMouseEvent` read the caller's objects) | `EncodeTs(t)` |
| `native/terminal.cc` `TerminalWrap::EncodeMouse`: `Get()` reads of geometry, `x`, `y`, `action`, `button`, `modifiers`, `anyButtonPressed`, `trackLastCell`; then `RequireTerminal`, `RequireMouseEncoder`, `ghostty_terminal_get(GHOSTTY_TERMINAL_DATA_MODE)`, `ghostty_mouse_encoder_*` | `EncodeEnter(t)` (enter, reads), `EncodeCall(t)` (handles and libghostty calls), `EncodeThrows(t)`, constants `JsInNativeRead`, `TakeHandlesLast`, `NativeNullGuard` |
| `src/index.ts` `dispose`; `native/terminal.cc` `TerminalWrap::Dispose`, `DisposeNative` (frees `mouse_encoder_`, then `terminal_`, and sets each to `nullptr`) | `Dispose(t)`, `DisposeNative(r)`, constants `DisposeClearsPtr`, `EncoderClearsPtr` |
| `native/terminal.cc` `TerminalWrap::~TerminalWrap` (ObjectWrap finalizer) | `Drop(t)`, `Finalize(t)` |
| Node environment teardown when a Worker exits | `WorkerExit(w)` |
| node-addon-api 8.9.2 `FunctionReference::New` (uses the env stored in the reference) and `Reference::~Reference` / `operator=` (run `napi_delete_reference` with the stored env) | `CreateTerminal` sets `refUse` with the slot's owner; `LoadAddon` sets `refUse` with the old owner |

## Run

Requirements: Java 11 or later on `PATH` (or `JAVA=/path/to/java`), and `curl` for the first run. The first run downloads tla2tools v1.7.4 to `vendor/tla2tools/` (git ignores `vendor/`) and checks its sha256. Set `TLA2TOOLS_JAR` to use a jar that you already have.

```sh
.agents/skills/verify-native-lifecycle/run.sh            # logs go to a new mktemp dir
.agents/skills/verify-native-lifecycle/run.sh "$OUT_DIR" # or to a dir you name
```

It takes about 20 seconds. It runs TLC once for each config and rule, and prints one row for each with `RESULT`, `EXPECT`, and the log path. Exit `0` means that every result matches `EXPECT`. Exit `1` means that a row is marked `DIFFERS`. Exit `2` means that TLC or the model failed: read the error.

| Config | What it is | Expected breaks |
|---|---|---|
| `model/current.cfg` | The current code. Main thread, 2 workers, 2 terminals. | none |
| `model/mutant-process-static.cfg` | The old code: one class reference for the whole process (F1). | `CreateUsesOwnClass`, `LoadDeletesOnlyOwnRef` |
| `model/mutant-dispose-keeps-pointer.cfg` | Current code, but `DisposeNative` does not set `terminal_ = nullptr`. | `HandleFreedOnce` |
| `model/mutant-no-use-guards.cfg` | Current code, but no `#assertUsable` and no native null checks. | `NoCallOnDeadHandle` |
| `model/mutant-no-native-guard.cfg` | Current code, but no `RequireTerminal` or `RequireMouseEncoder` null check. `#assertUsable` stays. | `NoCallOnDeadHandle` |
| `model/mutant-keeps-encoder-pointer.cfg` | Current code, but `DisposeNative` does not set `mouse_encoder_ = nullptr`. | `EncoderFreedOnce` |
| `model/mutant-handles-before-reads.cfg` | The old code: `EncodeMouse` copies the handles, then reads its arguments (F2). | `NoCallOnDeadHandle` |

The mutant configs prove at each run that each rule can fail. Removing only `#assertUsable` breaks nothing, because the native null checks still stop the call. Removing only the native null checks breaks `NoCallOnDeadHandle`: a getter that the `encodeMouse` normalizers or the native `Get()` reads run can dispose the terminal after `#assertUsable` passed.

`test/workers.test.ts` replays the worker counterexamples against the real addon, in child processes: a live worker, a worker that exited, and two workers. `npm test` runs it. It crashed in all three scenarios before the F1 fix.

## Read the result

Read every result with the `/statechart` skill when your agent has it (it ships with the pstack plugin, not with this repo). Copy `model/AddonEnvLifecycle.tla`, a config, and `model/statechart-view.mjs` to a scratch folder outside the repo, and give `/statechart` that config and the view. `model/chart.cfg` has small bounds (one worker, one terminal) so that the chart fits. For a broken rule, `/statechart` gives the shortest path in plain words. For a pass, it draws how the system moves between states. If the view no longer fits `/statechart`'s view interface, rewrite it from that skill's instructions.

Without `/statechart`, read the log that the row names. For a broken rule, TLC prints `Error: Invariant <rule> is violated` and then the shortest path as `State 1:`, `State 2:`, ... blocks. Each block names the action that made it (for example `<LoadAddon line 98 ...>`) and the value of every variable after that step. Tell the path as one sentence for each action, in the words of the coverage record.

When a row says `DIFFERS`:

1. A rule breaks that `EXPECT` says holds. Open the log that the row names and read the counterexample. Replay each step against the real code, as `test/workers.test.ts` does for F1, or with a short script in `$TMPDIR`. If each step can happen in the code, it is a bug: report it with the steps in the code's words. Do not change the model or `EXPECT` to make it pass. If a step cannot happen in the code, the model is wrong: fix the action and say what was wrong.
2. A rule holds that `EXPECT` says breaks. The model lost the power to catch that break. Fix the model.
3. `TypeOK` breaks, or TLC reports an error. The model is wrong. Fix it before you read any other result.

## Update after an intended change

Change the model from the code, before you rerun. Do not shape it by what makes the check pass.

1. For each changed function in the coverage record, update its action so that the action again does what the code does. Keep one step without other JS in between as one action.
2. When new code stores a reference or frees or uses `terminal_`, add an action for it and a row in the coverage record.
3. When the change is meant to break a rule, the promise changed. Change the rule only with evidence (a doc comment, a test, the changelog), and write down the old and the new wording.
4. Rerun `run.sh` and `npm test`. Then break the new code the way a rule guards against, in a scratch change, and confirm that the check catches it. Drop the scratch change.
5. Update the coverage record and move the sync commit to the commit that you checked.

## Bounds and assumptions

- Bounds: the main thread and 2 workers, 2 terminals. `current.cfg` has 8,661 distinct states.
- Each action is atomic. Different envs run on different threads. With one class reference for each env, two envs share no addon state, so treating each step as atomic hides no interleaving of addon state. With a shared slot (`mutant-process-static`), the threads also race on it: that adds bad behaviors, and the model already finds the slot bugs without it.
- Assumption: when a Worker exits, Node runs the finalizers of its wrapped objects and invalidates the references that its env made. The model does not model the main thread's exit.
- Assumption: each env loads the addon once. Node gives each load of the addon its own `napi_env`, even two `process.dlopen` calls in one thread, so `TerminalWrap::Init` asserts that the slot is empty. The model does not explore a second load.
- JS can run where code reads a caller's values. The model has these points: the `encodeMouse` normalizers after `#assertUsable` (`EncodeTs`), and the native `Get()` reads in `EncodeMouse` (`EncodeEnter` to `EncodeCall`, while `JsInNativeRead`). A getter there can run any step of the model, for example `Dispose` of the same terminal. `snapshot` has the same window as `EncodeTs`: `normalizeSnapshotOptions` reads the caller's getters after `#assertUsable`, and the native null check covers it. `feed` has it too: `assertFeedData` runs `data instanceof Uint8Array`, which runs a Proxy's `getPrototypeOf` trap after `#assertUsable`, and the native null check covers it. The model keeps `snapshot` and `feed` in the one-step `Use`.
- Assumption: no JS runs inside the other native methods after they take `terminal_`. `Snapshot` reads its options with `Get()` before `RequireTerminal`, and it builds its result with `DefineValue` and `DefineIndex`, which run no setter. `Feed` and `Resize` call `RequireTerminal` first, but after that they only test argument types and read strings, bytes, and numbers, which runs no JS. `GetVisibleText`, `FormatPlain`, and `FormatHtml` read no arguments. Until #46 this was false for `snapshot`: it read its options after `RequireTerminal`, and `src/index.ts` sends `{}` when the caller passes no options, so `OptionBool` could run an `Object.prototype` getter after the check. `Set()` also ran `Object.prototype` setters while `BuildSnapshot` used `terminal_`. A getter or setter that called `dispose()` aborted or segfaulted Node (`test/snapshot-safety.test.ts`). The constructor reads `scrollbackLimit` with `Get()` before `ghostty_terminal_new`, so a getter there cannot reach a handle.
- Assumption: while a call runs on a terminal, the program cannot drop that terminal, and its Worker cannot exit: the call keeps the object reachable, and a terminating Worker first unwinds its stack (`EncodeThrows`).

## Not covered

- libghostty itself: VT parsing and every `ghostty_*` call are trusted.
- The content of snapshots and visible text (`ReadLine`, `ReadCellText`, `BuildCellObject`, `ResolveStyleColor`).
- Argument validation (the mouse geometry and coordinate checks included), the encoded mouse bytes, the mouse mode cache (`mouse_modes_dirty_`), `getNativeInfo`, prebuild loading, and packaging.
- More than one load of the addon in one env, for example two copies of the package at different paths.
