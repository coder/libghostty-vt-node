import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nativeSupport } from "./native-support.js";

const support = nativeSupport();
const describeIfNative = support.available ? describe : describe.skip;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each scenario runs in a child process: a broken addon aborts or segfaults the
// whole process, which would otherwise kill the test runner.
const prelude = `
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");
const addon = require("node-gyp-build")(process.env.ADDON_ROOT);
function use(label) {
  const t = addon.createTerminal({ cols: 10, rows: 1 });
  t.feed(label);
  const text = t.getVisibleText();
  t.dispose();
  if (text !== label) throw new Error("expected " + label + ", got " + JSON.stringify(text));
}
const workerSource = \`
  const { parentPort } = require("node:worker_threads");
  const addon = require("node-gyp-build")(process.env.ADDON_ROOT);
  function use(label) {
    const t = addon.createTerminal({ cols: 10, rows: 1 });
    t.feed(label);
    const text = t.getVisibleText();
    t.dispose();
    if (text !== label) throw new Error("expected " + label + ", got " + JSON.stringify(text));
  }
  use("w-load");
  parentPort.postMessage("loaded");
  parentPort.on("message", (msg) => {
    if (msg === "exit") { parentPort.close(); return; }
    use(msg);
    parentPort.postMessage("used " + msg);
  });
\`;
async function startWorker() {
  const w = new Worker(workerSource, { eval: true });
  const [msg] = await once(w, "message");
  if (msg !== "loaded") throw new Error("worker did not load: " + msg);
  return w;
}
async function workerUses(w, label) {
  w.postMessage(label);
  const [msg] = await once(w, "message");
  if (msg !== "used " + label) throw new Error("worker failed: " + msg);
}
async function stopWorker(w) {
  w.postMessage("exit");
  await once(w, "exit");
}
`;

// The child gets a bounded run, and the test waits longer than that, so a
// hung child fails with its own output instead of a Vitest timeout.
const CHILD_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

function runScenario(body: string) {
  const script = `${prelude}\n(async () => { ${body}\n console.log("done"); })().catch((err) => { console.error(err); process.exit(1); });`;
  return spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ADDON_ROOT: root },
    timeout: CHILD_TIMEOUT_MS,
  });
}

function expectSurvived(result: ReturnType<typeof runScenario>) {
  // stderr is not asserted (NODE_OPTIONS such as --inspect can print to it),
  // but it is the failure message: it holds the V8 fatal error or the stack.
  expect(
    { signal: result.signal, status: result.status, stdout: result.stdout.trim() },
    result.stderr,
  ).toEqual({ signal: null, status: 0, stdout: "done" });
}

describeIfNative("worker_threads", () => {
  it("creates terminals in the main thread after a worker loads the addon", () => {
    expectSurvived(
      runScenario(`
        use("main-1");
        const w = await startWorker();
        use("main-2");
        await workerUses(w, "w-2");
        await stopWorker(w);`),
    );
  }, TEST_TIMEOUT_MS);

  it("creates terminals in the main thread after a worker that loaded the addon exits", () => {
    expectSurvived(
      runScenario(`
        use("main-1");
        const w = await startWorker();
        await stopWorker(w);
        use("main-2");`),
    );
  }, TEST_TIMEOUT_MS);

  it("creates terminals in each of two workers", () => {
    expectSurvived(
      runScenario(`
        const w1 = await startWorker();
        const w2 = await startWorker();
        await workerUses(w1, "w1-2");
        await workerUses(w2, "w2-2");
        await stopWorker(w1);
        await workerUses(w2, "w2-3");
        await stopWorker(w2);`),
    );
  }, TEST_TIMEOUT_MS);
});
