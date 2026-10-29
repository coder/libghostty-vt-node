# Lifecycle and errors

A user creates terminals, disposes them, and lets the garbage collector free the ones they drop. Bad options and use after `dispose()` throw clear errors. A user can also load the package in `worker_threads`.

## Sub-features

- `lifecycle-dispose` makes `dispose()` idempotent, and every method throws after it.
- `lifecycle-gc` lets V8 collect dropped terminals, disposed or not, without a crash.
- `lifecycle-invalid` rejects bad `createTerminal` options and bad `feed` data.
- `lifecycle-workers` creates terminals in the main thread after a Worker loaded the package.

## How to get to it (user POV)

- `term.dispose()`, then any method on `term`.
- Drop every reference to a terminal and let V8 collect it.
- `createTerminal(options)` with wrong options, and `term.feed(data)` with a wrong type.
- `new Worker(...)` that imports `@coder/libghostty-vt-node`.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **Dispose.** Dispose twice, then call each method. Run `lifecycle-dispose`. Exit `0`. Stdout lists 6 methods, each with `GhosttyVtTerminal has been disposed`.

```sh
$S/drive.sh "$RUN_ROOT" lifecycle-dispose <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 2 });
t.dispose(); t.dispose();
const calls = { feed: () => t.feed("x"), resize: () => t.resize(5, 5), snapshot: () => t.snapshot(),
  getVisibleText: () => t.getVisibleText(), formatPlain: () => t.formatPlain(), formatHtml: () => t.formatHtml() };
for (const [name, call] of Object.entries(calls)) {
  assert.throws(call, /GhosttyVtTerminal has been disposed/);
  console.log(name, "throws: GhosttyVtTerminal has been disposed");
}
JS
```

- **Garbage collection.** Create 200 terminals in a function, dispose every other one, return, and force GC. Run `lifecycle-gc` with `--expose-gc`. Exit `0`, and stdout is `collected 100 disposed and 100 open terminals`. Each count proves that V8 collected the JS `Terminal` objects of that kind and that the process survived. JS cannot see the native `TerminalWrap` finalizer or the freed handle, so this journey does not prove that the handles were freed. The `verify-native-lifecycle` skill covers that.

```sh
$S/drive.sh "$RUN_ROOT" lifecycle-gc --expose-gc <<'JS'
import { createTerminal } from "@coder/libghostty-vt-node";
const freed = new FinalizationRegistry((kind) => { freed.counts[kind]++; });
freed.counts = { disposed: 0, open: 0 };
// Create in a function, so no local variable keeps a terminal alive.
function createAndDrop(n) {
  for (let i = 0; i < n; i++) {
    const t = createTerminal({ cols: 20, rows: 5 });
    t.feed(`t${i}`);
    const kind = i % 2 === 0 ? "disposed" : "open";
    if (kind === "disposed") t.dispose();
    freed.register(t, kind);
  }
}
createAndDrop(200);
for (let i = 0; i < 20 && freed.counts.disposed + freed.counts.open < 200; i++) {
  globalThis.gc(); await new Promise((r) => setTimeout(r, 10));
}
console.log(`collected ${freed.counts.disposed} disposed and ${freed.counts.open} open terminals`);
if (freed.counts.disposed !== 100 || freed.counts.open !== 100) process.exit(1);
JS
```

- **Invalid input.** Run `lifecycle-invalid`. Exit `0`. Stdout shows each call with its error: `null` options give `AssertionError: options must not be null`, `cols: 0` gives `TypeError: cols must be a positive integer`, `scrollbackLimit: -1` gives `TypeError: scrollbackLimit must be a non-negative integer`, `cols: 70000` gives `RangeError: cols must be a positive 16-bit integer`, and `feed(123)` and `feed(new Uint16Array(2))` give `TypeError: feed data must be a string, Buffer, or Uint8Array`.

```sh
$S/drive.sh "$RUN_ROOT" lifecycle-invalid <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 2 });
const cases = [
  ["createTerminal(null)", () => createTerminal(null), "AssertionError", /options must not be null/],
  ["createTerminal({cols:0})", () => createTerminal({ cols: 0, rows: 2 }), "TypeError", /cols must be a positive integer/],
  ["createTerminal({scrollbackLimit:-1})", () => createTerminal({ cols: 2, rows: 2, scrollbackLimit: -1 }), "TypeError", /scrollbackLimit must be a non-negative integer/],
  ["createTerminal({cols:70000})", () => createTerminal({ cols: 70000, rows: 2 }), "RangeError", /positive 16-bit integer/],
  ["feed(123)", () => t.feed(123), "TypeError", /string, Buffer, or Uint8Array/],
  ["feed(Uint16Array)", () => t.feed(new Uint16Array(2)), "TypeError", /string, Buffer, or Uint8Array/],
];
for (const [label, call, type, msg] of cases) {
  try { call(); assert.fail(`${label} did not throw`); }
  catch (e) { console.log(label, "->", e.constructor.name + ":", e.message);
              assert.equal(e.constructor.name, type); assert.match(e.message, msg); }
}
t.feed("still usable"); assert.equal(t.getVisibleText(), "still usab\nle");
t.dispose();
JS
```

- **Worker threads.** The main thread creates a terminal, a Worker loads the package, and the main thread creates another terminal. Run `lifecycle-workers`. Exit `0`, and stdout ends with `main: created a terminal after the worker loaded`. A failure kills the process with a signal, so `drive.sh` exits `134` (SIGABRT, stderr has `Cannot create a handle without a HandleScope`) or `139` (SIGSEGV). That is a regression of finding F1 in the `verify-native-lifecycle` skill: report it, and do not change the journey to make it pass.

```sh
$S/drive.sh "$RUN_ROOT" lifecycle-workers <<'JS'
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { createTerminal } from "@coder/libghostty-vt-node";
createTerminal({ cols: 10, rows: 2 }).dispose();
console.log("main: created a terminal");
const w = new Worker(`import("@coder/libghostty-vt-node").then((m) => {
  m.createTerminal({ cols: 10, rows: 2 }).dispose();
  import("node:worker_threads").then(({ parentPort }) => parentPort.postMessage("loaded"));
});`, { eval: true });
await once(w, "message");
console.log("worker: loaded the package and created a terminal");
createTerminal({ cols: 10, rows: 2 }).dispose();
console.log("main: created a terminal after the worker loaded");
await w.terminate();
JS
```

## Gotchas

- `lifecycle-workers` checks one order of events. The `verify-native-lifecycle` skill checks every order within its bounds, and `test/workers.test.ts` covers an exited worker and two workers.
- `lifecycle-gc` needs `--expose-gc` after the journey name. Without it, `globalThis.gc` is undefined and the journey throws.
- GC timing varies. The journey retries 20 times. A count below 100 for either kind after that is a failure to report, not a reason to raise the retry count. Create terminals inside a function as the journey does: a terminal held by a top-level variable or array is never collected.
- A Worker's `eval` code resolves `@coder/libghostty-vt-node` from the consumer project, because `drive.sh` runs node in that directory.
