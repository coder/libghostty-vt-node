import { describe, expect, it } from "vitest";
import { createTerminal } from "../src/index.js";
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

  it("makes dispose idempotent and rejects use after dispose", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    term.dispose();
    expect(() => term.dispose()).not.toThrow();
    expect(() => term.feed("after")).toThrow(/disposed/);
    expect(() => term.snapshot()).toThrow(/disposed/);
  });
});
