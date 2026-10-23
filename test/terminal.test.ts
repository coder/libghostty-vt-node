import { describe, expect, it } from "vitest";
import { createTerminal, type SnapshotCell, type TerminalSnapshot } from "../src/index.js";
import { nativeSupport } from "./native-support.js";

const support = nativeSupport();
const describeIfNative = support.available ? describe : describe.skip;

function cellsByText(snapshot: TerminalSnapshot): Map<string, SnapshotCell> {
  const cells = new Map<string, SnapshotCell>();
  for (const cell of snapshot.cells ?? []) {
    expect(cells.has(cell.text), `duplicate cell text ${cell.text}`).toBe(false);
    cells.set(cell.text, cell);
  }
  return cells;
}

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

  describe.each([
    { name: "inverse", set: 7, reset: 27 },
    { name: "strikethrough", set: 9, reset: 29 },
    { name: "faint", set: 2, reset: 22 },
    { name: "invisible", set: 8, reset: 28 },
  ] as const)("SGR $set/$reset $name cell attribute", ({ name, set, reset }) => {
    it("reports the attribute when set and omits it after its reset or SGR 0", () => {
      const term = createTerminal({ cols: 80, rows: 24 });
      try {
        term.feed(`P\x1b[${set}mA\x1b[${reset}mB\x1b[${set}mC\x1b[0mD`);
        const cells = cellsByText(term.snapshot({ includeCells: true }));
        expect(cells.get("P")).not.toHaveProperty(name);
        expect(cells.get("A")?.[name]).toBe(true);
        expect(cells.get("B")).not.toHaveProperty(name);
        expect(cells.get("C")?.[name]).toBe(true);
        expect(cells.get("D")).not.toHaveProperty(name);
      } finally {
        term.dispose();
      }
    });
  });

  it("reports combined SGR attributes on one cell", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[1;2;3;4;7;8;9mX\x1b[0m");
      const cell = cellsByText(term.snapshot({ includeCells: true })).get("X");
      expect(cell).toMatchObject({
        bold: true,
        faint: true,
        italic: true,
        underline: true,
        inverse: true,
        invisible: true,
        strikethrough: true,
      });
    } finally {
      term.dispose();
    }
  });

  it("reports inverse as a raw attribute without swapping colors", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[31;42mN\x1b[7mI\x1b[0m");
      const cells = cellsByText(term.snapshot({ includeCells: true }));
      const normal = cells.get("N");
      const inverse = cells.get("I");
      expect(normal?.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(normal?.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(normal?.foreground).not.toBe(normal?.background);
      expect(inverse?.inverse).toBe(true);
      expect(inverse?.foreground).toBe(normal?.foreground);
      expect(inverse?.background).toBe(normal?.background);
    } finally {
      term.dispose();
    }
  });

  it("reports DECTCEM cursor visibility", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      expect(term.snapshot().cursorVisible).toBe(true);
      term.feed("\x1b[?25l");
      expect(term.snapshot().cursorVisible).toBe(false);
      expect(term.snapshot({ includeCells: true }).cursorVisible).toBe(false);
      term.feed("\x1b[?25h");
      expect(term.snapshot().cursorVisible).toBe(true);
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
