import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { nativeSupport } from "./native-support.js";

const support = nativeSupport();
const describeIfNative = support.available ? describe : describe.skip;

const childArgs = ["--import", "tsx", "--input-type=module", "-e"];

// Object.prototype accessors run inside native code whenever it assigns or
// reads a key that the object lacks. Such JS can dispose the terminal while
// snapshot() builds its result. Run in a child: a regression can crash.
describeIfNative.each(["public", "native"] as const)("%s snapshot safety", (name) => {
  const run = (body: string) => spawnSync(process.execPath, [...childArgs, `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const { createTerminal } = ${name === "public"
      ? 'await import("./src/index.ts")'
      : 'require("node-gyp-build")(process.cwd())'};
    ${body}
  `], { encoding: "utf8" });

  it("runs no Object.prototype setter while it builds the snapshot", () => {
    const child = run(`
      const keys = ["row", "text", "col", "width", "bold", "faint", "foreground", "cols", "cursorVisible",
        "visibleLines", "scrollbackLines", "cells", "0"];
      for (const key of keys) {
        const term = createTerminal({ cols: 20, rows: 3, scrollbackLimit: 1 });
        term.feed("\\x1b[1;2;31mAB\\x1b[0m\\r\\none\\r\\ntwo\\r\\nthree\\r\\n");
        let fired = 0;
        Object.defineProperty(Object.prototype, key, { configurable: true, set() { fired++; term.dispose(); } });
        let snapshot;
        try {
          snapshot = term.snapshot({ includeScrollback: true, includeCells: true });
        } finally {
          delete Object.prototype[key];
        }
        assert.equal(fired, 0, key);
        assert.equal(snapshot.cols, 20, key);
        assert.equal(snapshot.visibleLines.length, 3, key);
        assert.ok(Object.hasOwn(snapshot.visibleLines, "0"), key);
        assert.ok(snapshot.scrollbackLines.some((line) => line.text === "AB"), key);
        term.dispose();
      }
    `);
    expect({ status: child.status, signal: child.signal, stderr: child.stderr })
      .toEqual({ status: 0, signal: null, stderr: "" });
  });

  // The public wrapper sends {} for snapshot(), so both paths read missing keys.
  it("checks for dispose after it reads the snapshot options", () => {
    const child = run(`
      for (const key of ["includeScrollback", "includeCells"]) {
        const term = createTerminal({ cols: 20, rows: 3 });
        Object.defineProperty(Object.prototype, key, { configurable: true, get() { term.dispose(); return undefined; } });
        try {
          assert.throws(() => term.snapshot(${name === "public" ? "" : "{}"}), /disposed/, key);
        } finally {
          delete Object.prototype[key];
        }
      }
    `);
    expect({ status: child.status, signal: child.signal, stderr: child.stderr })
      .toEqual({ status: 0, signal: null, stderr: "" });
  });
});
