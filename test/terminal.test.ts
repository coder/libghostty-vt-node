import { describe, expect, it } from "vitest";
import { createTerminal } from "../src/index.js";
import { loadNative } from "../src/loader.js";
import type { CreateTerminalOptions } from "../src/types.js";
import { nativeSupport } from "./native-support.js";

const support = nativeSupport();
const describeIfNative = support.available ? describe : describe.skip;

describe("createTerminal validation", () => {
  it("validates positive dimensions before loading native state", () => {
    expect(() => createTerminal({ cols: 0, rows: 24 })).toThrow(/cols/);
    expect(() => createTerminal({ cols: 80, rows: 0 })).toThrow(/rows/);
    expect(() => createTerminal({ cols: 80, rows: 24, scrollbackLimit: -1 })).toThrow(
      /scrollbackLimit/,
    );
  });
});

describeIfNative("GhosttyVtTerminal", () => {
  it("feeds simple text into visible text", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("hello");
      expect(term.getVisibleText()).toContain("hello");
    } finally {
      term.dispose();
    }
  });

  it("keeps SGR escapes out of plain visible text", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[31mred\x1b[0m");
      const snapshot = term.snapshot({ includeCells: true });
      expect(snapshot.visibleLines.map((line) => line.text).join("\n")).toContain("red");
      expect(snapshot.cells?.some((cell) => cell.text === "r")).toBe(true);
    } finally {
      term.dispose();
    }
  });

  it("updates snapshot dimensions on resize", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.resize(100, 30);
      const snapshot = term.snapshot();
      expect(snapshot.cols).toBe(100);
      expect(snapshot.rows).toBe(30);
    } finally {
      term.dispose();
    }
  });

  // src/ checks only Number.isInteger and the sign, so these values reach the
  // addon. NaN and Infinity skip src/ when the addon is called directly.
  it.each<[string, CreateTerminalOptions, RegExp]>([
    ["cols NaN", { cols: Number.NaN, rows: 24 }, /^cols must be a positive 16-bit integer$/],
    ["cols Infinity", { cols: Number.POSITIVE_INFINITY, rows: 24 }, /^cols must be a positive 16-bit integer$/],
    ["cols 65536", { cols: 65536, rows: 24 }, /^cols must be a positive 16-bit integer$/],
    ["cols 1e10", { cols: 1e10, rows: 24 }, /^cols must be a positive 16-bit integer$/],
    ["rows 2^32", { cols: 80, rows: 2 ** 32 }, /^rows must be a positive 16-bit integer$/],
    ["scrollbackLimit NaN", { cols: 80, rows: 24, scrollbackLimit: Number.NaN }, /^scrollbackLimit must be a non-negative integer$/],
    ["scrollbackLimit 2^64", { cols: 80, rows: 24, scrollbackLimit: 2 ** 64 }, /^scrollbackLimit must be a non-negative integer$/],
  ])("rejects %s in the addon with a RangeError", (_name, options, message) => {
    let thrown: unknown;
    try {
      loadNative().createTerminal(options).dispose();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toMatch(message);
  });

  it("makes dispose idempotent and rejects use after dispose", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    term.dispose();
    expect(() => term.dispose()).not.toThrow();
    expect(() => term.feed("after")).toThrow(/disposed/);
    expect(() => term.snapshot()).toThrow(/disposed/);
  });
});
