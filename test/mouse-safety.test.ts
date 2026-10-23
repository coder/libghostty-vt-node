import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createTerminal } from "../src/index.js";
import { loadNative } from "../src/loader.js";

const geometry = {
  screenWidth: 80, screenHeight: 24, cellWidth: 1, cellHeight: 1,
  paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
};

// Exercise the C++ boundary independently of the public TypeScript normalizer.
describe.each([
  ["public", createTerminal],
  ["native", (options: { cols: number; rows: number }) => loadNative().createTerminal(options)],
] as const)("%s mouse safety", (_name, create) => {
  it("rejects unsafe UTF-8 codepoints without terminating the process", () => {
    // Run untrusted native edge cases in a child so a regression cannot abort
    // the entire suite when Ghostty is built with runtime safety enabled.
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const { createTerminal } = ${_name === "public"
        ? 'await import("./dist/index.js")'
        : 'require("node-gyp-build")(process.cwd())'};
      const term = createTerminal({ cols: 80, rows: 24 });
      term.feed("\\x1b[?1000h\\x1b[?1005h");
      const options = { geometry: ${JSON.stringify({ ...geometry, screenWidth: 65535, screenHeight: 65535 })} };
      for (const [x, y] of [[55263, 0], [0, 55263], [57310, 0], [0, 65503]]) {
        assert.throws(() => term.encodeMouse({ action: "press", button: "left", x, y }, options), RangeError);
      }
      // Clamping happens before UTF-8 conversion: a distant release on a small
      // viewport is safe even when the original coordinate was problematic.
      const bytes = term.encodeMouse({ action: "release", button: "left", x: 55263, y: 65503 },
        { geometry: ${JSON.stringify(geometry)} });
      assert.ok(bytes.length > 0);
      term.dispose();
    `], { encoding: "utf8" });
    expect({ status: child.status, signal: child.signal, stderr: child.stderr })
      .toEqual({ status: 0, signal: null, stderr: "" });
  });

  it("rejects geometry that overflows Ghostty's grid or padding arithmetic", () => {
    const term = create({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1000h\x1b[?1006h");
      const cases = [
        [{ screenWidth: 100000 }, /screenWidth/],
        [{ screenHeight: 65536 }, /screenHeight/],
        [{ paddingLeft: 2 ** 32 - 1, paddingRight: 2 }, /padding/],
        [{ paddingTop: 2 ** 32 - 1, paddingBottom: 2 }, /padding/],
        [{ paddingLeft: 81 }, /padding/],
        [{ paddingTop: 25 }, /padding/],
        // f32 rounding turns this almost-valid ratio into 65536.
        [{ screenWidth: 2 ** 32 - 1, cellWidth: 65536 }, /screenWidth/],
      ] as const;
      for (const [override, error] of cases) {
        expect(() => term.encodeMouse(
          { action: "press", button: "left", x: 0, y: 0 },
          { geometry: { ...geometry, ...override } },
        )).toThrow(error);
      }
    } finally {
      term.dispose();
    }
  });

  it("rejects coordinates before Ghostty's u16 and i32 conversions", () => {
    const term = create({ cols: 80, rows: 24 });
    try {
      for (const mode of [1006, 1016]) {
        term.feed(`\x1b[?1000h\x1b[?${mode}h`);
        for (const axis of ["x", "y"] as const) {
          for (const value of [1e30, 1e12, 65536, 65535.9999, -1e30, Number.MAX_VALUE]) {
            expect(() => term.encodeMouse(
              { action: "release", button: "left", x: 3, y: 3, [axis]: value },
              { geometry },
            )).toThrow(new RegExp(`mouse ${axis}`));
          }
        }
      }
    } finally {
      term.dispose();
    }
  });

  it("preserves representable off-screen releases, drags, padding, and maximum cells", () => {
    const term = create({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1003h\x1b[?1006h");
      const event = { action: "release", button: "left", x: 65535, y: 65535 } as const;
      expect(term.encodeMouse(event, { geometry })).toEqual(Buffer.from("\x1b[<0;80;24m"));
      expect(term.encodeMouse({ ...event, action: "motion" }, {
        geometry, anyButtonPressed: true,
      })).toEqual(Buffer.from("\x1b[<32;80;24M"));
      expect(term.encodeMouse({ ...event, action: "motion" }, { geometry })).toHaveLength(0);
      expect(term.encodeMouse(event, {
        geometry: { ...geometry, screenWidth: 65535, screenHeight: 65535 },
      })).toEqual(Buffer.from("\x1b[<0;65535;65535m"));
      term.feed("\x1b[?1016h");
      expect(term.encodeMouse({ ...event, x: -100, y: -200 }, {
        geometry: { ...geometry, paddingLeft: 5, paddingTop: 3 },
      })).toEqual(Buffer.from("\x1b[<0;-105;-203m"));
    } finally {
      term.dispose();
    }
  });

  it("guards pixel limits even when large cells keep grid indices small", () => {
    const term = create({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1000h\x1b[?1016h");
      const options = { geometry: { ...geometry, cellWidth: 65536, cellHeight: 65536 } };
      for (const axis of ["x", "y"] as const) {
        for (const value of [2147483647, 2147483648, -2147483904]) {
          // Even INT32_MAX rounds up to 2**31 when passed through the f32 C API.
          expect(() => term.encodeMouse({
            action: "release", button: "left", x: 0, y: 0, [axis]: value,
          }, options)).toThrow(new RegExp(`mouse ${axis}`));
        }
      }
      expect(term.encodeMouse({
        action: "release", button: "left", x: 2147483520, y: -2147483648,
      }, options)).toEqual(Buffer.from("\x1b[<0;2147483520;-2147483648m"));
    } finally {
      term.dispose();
    }
  });
});
