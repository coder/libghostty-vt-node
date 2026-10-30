import { describe, expect, it } from "vitest";
import { createTerminal, supportsMouseInput, type SnapshotCell, type TerminalSnapshot } from "../src/index.js";
import { loadNative } from "../src/loader.js";
import type { CreateTerminalOptions } from "../src/types.js";
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

const unitGeometry = {
  screenWidth: 80,
  screenHeight: 24,
  cellWidth: 1,
  cellHeight: 1,
};

describe("createTerminal validation", () => {
  it("advertises mouse-input support without allocating a terminal", () => {
    expect(supportsMouseInput).toBe(true);
  });

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

  it("shows the cursor and resets the pen on DECSTR, keeping the screen", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?25l\x1b[7mA\x1b[!pX");
      const snapshot = term.snapshot({ includeCells: true });
      const cells = cellsByText(snapshot);
      expect(snapshot.cursorVisible).toBe(true);
      expect(cells.get("A")?.inverse).toBe(true);
      expect(cells.get("X")).not.toHaveProperty("inverse");
      expect(snapshot.visibleLines[0]?.text).toBe("AX");
    } finally {
      term.dispose();
    }
  });

  it.each([
    { scrollbackLimit: undefined, keepsHistory: false },
    { scrollbackLimit: 0, keepsHistory: false },
    { scrollbackLimit: 1, keepsHistory: true },
  ])("keeps scrollback only for a nonzero scrollbackLimit ($scrollbackLimit)", ({ scrollbackLimit, keepsHistory }) => {
    const options: CreateTerminalOptions = { cols: 80, rows: 24 };
    if (scrollbackLimit !== undefined) options.scrollbackLimit = scrollbackLimit;
    const term = createTerminal(options);
    try {
      term.feed(Array.from({ length: 200 }, (_, i) => `line ${i}\r\n`).join(""));
      const scrollback = term.snapshot({ includeScrollback: true }).scrollbackLines ?? [];
      expect(scrollback.length > 0).toBe(keepsHistory);
    } finally {
      term.dispose();
    }
  });

  it("pulls history back when one resize makes the terminal narrower and taller", () => {
    const resized = (steps: [number, number][]) => {
      const term = createTerminal({ cols: 80, rows: 24, scrollbackLimit: 10_000 });
      try {
        term.feed(Array.from({ length: 40 }, (_, i) => `out ${i}\r\n`).join("") + "$ ");
        for (const [cols, rows] of steps) term.resize(cols, rows);
        return term.snapshot({ includeScrollback: true });
      } finally {
        term.dispose();
      }
    };
    const oneStep = resized([[80, 10], [60, 30]]);
    expect(oneStep.cursorRow).toBe(29);
    expect(oneStep.visibleLines[29]?.text).toBe("$");
    expect(oneStep).toEqual(resized([[80, 10], [80, 30], [60, 30]]));
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

  it("encodes press, release, motion, modifiers, and wheel buttons using negotiated SGR mode", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1003h\x1b[?1006h");

      const cases = [
        {
          event: { action: "press", button: "left", x: 4, y: 5 } as const,
          expected: "\x1b[<0;5;6M",
        },
        {
          event: { action: "release", button: "right", x: 4, y: 5 } as const,
          expected: "\x1b[<2;5;6m",
        },
        {
          event: { action: "motion", x: 1, y: 2 } as const,
          expected: "\x1b[<35;2;3M",
        },
        {
          event: {
            action: "press",
            button: "left",
            x: 2,
            y: 3,
            modifiers: { shift: true, alt: true, ctrl: true },
          } as const,
          expected: "\x1b[<28;3;4M",
        },
        ...(["four", "five", "six", "seven"] as const).map((button, index) => ({
          event: { action: "press" as const, button, x: 0, y: 0 },
          expected: `\x1b[<${64 + index};1;1M`,
        })),
        ...(["eight", "nine"] as const).map((button, index) => ({
          event: { action: "press" as const, button, x: 0, y: 0 },
          expected: `\x1b[<${128 + index};1;1M`,
        })),
        ...(["ten", "eleven"] as const).map((button) => ({
          event: { action: "press" as const, button, x: 0, y: 0 },
          expected: "",
        })),
      ];

      for (const { event, expected } of cases) {
        expect(term.encodeMouse(event, { geometry: unitGeometry })).toEqual(Buffer.from(expected));
      }
    } finally {
      term.dispose();
    }
  });

  it("encodes the same event across every Ghostty mouse wire format", () => {
    const cases = [
      {
        mode: "\x1b[?9h",
        expected: Buffer.from([0x1b, 0x5b, 0x4d, 0x20, 0x23, 0x24]),
      },
      {
        mode: "\x1b[?1000h",
        expected: Buffer.from([0x1b, 0x5b, 0x4d, 0x3c, 0x23, 0x24]),
      },
      {
        mode: "\x1b[?1000h\x1b[?1005h",
        expected: Buffer.from([0x1b, 0x5b, 0x4d, 0x3c, 0x23, 0x24]),
      },
      { mode: "\x1b[?1000h\x1b[?1015h", expected: Buffer.from("\x1b[60;3;4M") },
      { mode: "\x1b[?1000h\x1b[?1006h", expected: Buffer.from("\x1b[<28;3;4M") },
      { mode: "\x1b[?1000h\x1b[?1016h", expected: Buffer.from("\x1b[<28;2;3M") },
    ];

    for (const testCase of cases) {
      const term = createTerminal({ cols: 80, rows: 24 });
      try {
        term.feed(testCase.mode);
        expect(
          term.encodeMouse(
            {
              action: "press",
              button: "left",
              x: 2,
              y: 3,
              modifiers: { shift: true, alt: true, ctrl: true },
            },
            { geometry: unitGeometry },
          ),
        ).toEqual(testCase.expected);
      } finally {
        term.dispose();
      }
    }
  });

  it("refreshes mouse mode after terminal output changes state", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      const event = { action: "press", button: "left", x: 4, y: 5 } as const;
      expect(term.encodeMouse(event, { geometry: unitGeometry })).toHaveLength(0);

      term.feed("\x1b[?1000h\x1b[?1006h");
      expect(term.encodeMouse(event, { geometry: unitGeometry })).toEqual(
        Buffer.from("\x1b[<0;5;6M"),
      );

      term.feed("\x1b[?1000l");
      expect(term.encodeMouse(event, { geometry: unitGeometry })).toHaveLength(0);
    } finally {
      term.dispose();
    }
  });

  it("encodes the event and geometry values it validated when getters change", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1000h\x1b[?1006h");
      const expected = Buffer.from("\x1b[<0;4;4M");

      let xReads = 0;
      const event = {
        action: "press",
        button: "left",
        get x() {
          return xReads++ === 0 ? 3 : 1e30;
        },
        y: 3,
      } as const;
      expect(term.encodeMouse(event, { geometry: unitGeometry })).toEqual(expected);

      let widthReads = 0;
      const geometry = {
        ...unitGeometry,
        get screenWidth() {
          return widthReads++ === 0 ? 80 : 0;
        },
      };
      expect(
        term.encodeMouse({ action: "press", button: "left", x: 3, y: 3 }, { geometry }),
      ).toEqual(expected);
    } finally {
      term.dispose();
    }
  });

  it("reads every event, modifier, option, and geometry field once", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1000h\x1b[?1006h");
      const reads: Record<string, number> = {};
      const counted = <T extends object>(values: T): T => {
        const target = {};
        for (const [key, value] of Object.entries(values)) {
          reads[key] = 0;
          Object.defineProperty(target, key, {
            enumerable: true,
            get: () => {
              reads[key] = (reads[key] ?? 0) + 1;
              return value;
            },
          });
        }
        return target as T;
      };
      const geometry = counted({
        screenWidth: 80, screenHeight: 24, cellWidth: 1, cellHeight: 1,
        paddingTop: 0, paddingBottom: 0, paddingRight: 0, paddingLeft: 0,
      });
      const options = counted({ geometry, anyButtonPressed: false, trackLastCell: false });
      const modifiers = counted({ shift: true, ctrl: false, alt: true });
      const event = counted({ action: "press", button: "left", x: 3, y: 5, modifiers } as const);

      expect(term.encodeMouse(event, options)).toEqual(Buffer.from("\x1b[<12;4;6M"));
      expect(reads).toEqual({
        geometry: 1, anyButtonPressed: 1, trackLastCell: 1,
        screenWidth: 1, screenHeight: 1, cellWidth: 1, cellHeight: 1,
        paddingTop: 1, paddingBottom: 1, paddingRight: 1, paddingLeft: 1,
        action: 1, button: 1, x: 1, y: 1, modifiers: 1,
        shift: 1, ctrl: 1, alt: 1,
      });
    } finally {
      term.dispose();
    }
  });

  it("covers button tracking, legacy releases, X10 limits, and UTF-8 coordinates", () => {
    const cases = [
      { mode: "\x1b[?1002h\x1b[?1006h", action: "motion", button: "left", x: 2, expected: Buffer.from("\x1b[<32;3;4M") },
      { mode: "\x1b[?1002h\x1b[?1006h", action: "motion", x: 2, expected: Buffer.alloc(0) },
      { mode: "\x1b[?1000h", action: "release", button: "left", x: 2, expected: Buffer.from("\x1b[M##$") },
      { mode: "\x1b[?1000h\x1b[?1015h", action: "release", button: "left", x: 2, expected: Buffer.from("\x1b[35;3;4M") },
      { mode: "\x1b[?9h", action: "release", button: "left", x: 2, expected: Buffer.alloc(0) },
      { mode: "\x1b[?9h", action: "press", button: "four", x: 2, expected: Buffer.alloc(0) },
      { mode: "\x1b[?1000h", action: "press", button: "left", x: 222, expected: Buffer.from([27, 91, 77, 32, 255, 36]) },
      { mode: "\x1b[?1000h", action: "press", button: "left", x: 223, expected: Buffer.alloc(0) },
      { mode: "\x1b[?1000h\x1b[?1005h", action: "press", button: "left", x: 99, expected: Buffer.from([27, 91, 77, 32, 0xc2, 0x84, 36]) },
    ] as const;
    for (const { mode, expected, ...event } of cases) {
      const term = createTerminal({ cols: 300, rows: 24 });
      try {
        term.feed(mode);
        expect(term.encodeMouse({ ...event, y: 3 }, {
          geometry: { ...unitGeometry, screenWidth: 300 },
        })).toEqual(expected);
      } finally {
        term.dispose();
      }
    }
  });

  it("applies tracking-mode, pressed-button, viewport, and motion-dedup classifiers", () => {
    const cases = [
      {
        name: "normal mode suppresses motion",
        mode: "\x1b[?1000h\x1b[?1006h",
        event: { action: "motion", button: "left", x: 2, y: 3 } as const,
        options: { geometry: unitGeometry },
        expected: [""],
      },
      {
        name: "any mode deduplicates motion in one cell",
        mode: "\x1b[?1003h\x1b[?1006h",
        event: { action: "motion", x: 2, y: 3 } as const,
        options: { geometry: unitGeometry, trackLastCell: true },
        expected: ["\x1b[<35;3;4M", ""],
      },
      {
        name: "out-of-viewport motion requires a pressed button",
        mode: "\x1b[?1003h\x1b[?1006h",
        event: { action: "motion", button: "left", x: 100, y: 30 } as const,
        options: { geometry: unitGeometry, anyButtonPressed: false },
        expected: [""],
      },
      {
        name: "pressed drag outside viewport clamps to the final cell",
        mode: "\x1b[?1003h\x1b[?1006h",
        event: { action: "motion", button: "left", x: 100, y: 30 } as const,
        options: { geometry: unitGeometry, anyButtonPressed: true },
        expected: ["\x1b[<32;80;24M"],
      },
    ];

    for (const testCase of cases) {
      const term = createTerminal({ cols: 80, rows: 24 });
      try {
        term.feed(testCase.mode);
        const actual = testCase.expected.map(() =>
          term.encodeMouse(testCase.event, testCase.options),
        );
        expect(actual, testCase.name).toEqual(testCase.expected.map((value) => Buffer.from(value)));
      } finally {
        term.dispose();
      }
    }
  });

  it("keeps pixel geometry explicit when the child negotiates SGR pixels", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      term.feed("\x1b[?1000h\x1b[?1016h");
      const bytes = term.encodeMouse(
        { action: "press", button: "left", x: 50, y: 40 },
        {
          geometry: {
            screenWidth: 800,
            screenHeight: 600,
            cellWidth: 10,
            cellHeight: 20,
          },
        },
      );
      expect(bytes).toEqual(Buffer.from("\x1b[<0;50;40M"));
    } finally {
      term.dispose();
    }
  });

  it("rejects invalid mouse events and geometry as sets", () => {
    const term = createTerminal({ cols: 80, rows: 24 });
    try {
      expect(typeof term.encodeMouse).toBe("function");
      const invalidCalls = [
        () =>
          term.encodeMouse(
            { action: "click" as never, button: "left", x: 0, y: 0 },
            { geometry: unitGeometry },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "primary" as never, x: 0, y: 0 },
            { geometry: unitGeometry },
          ),
        () => term.encodeMouse({ action: "press", x: 0, y: 0 }, { geometry: unitGeometry }),
        () =>
          term.encodeMouse(
            { action: "release", x: 0, y: 0 },
            { geometry: unitGeometry },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: Number.NaN, y: 0 },
            { geometry: unitGeometry },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: 0, y: Number.POSITIVE_INFINITY },
            { geometry: unitGeometry },
          ),
        () =>
          term.encodeMouse(
            {
              action: "press",
              button: "left",
              x: 0,
              y: 0,
              modifiers: { shift: "yes" as never },
            },
            { geometry: unitGeometry },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: 0, y: 0 },
            { geometry: { ...unitGeometry, cellWidth: 0 } },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: 0, y: 0 },
            { geometry: { ...unitGeometry, screenWidth: 2 ** 32 } },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: 0, y: 0 },
            { geometry: { ...unitGeometry, paddingLeft: -1 } },
          ),
        () =>
          term.encodeMouse(
            { action: "press", button: "left", x: 0, y: 0 },
            { geometry: unitGeometry, anyButtonPressed: "yes" as never },
          ),
      ];

      const errors = [/action/, /button/, /button/, /button/, /mouse x/, /mouse y/,
        /shift/, /cellWidth/, /screenWidth/, /paddingLeft/, /anyButtonPressed/];
      for (const [index, invalidCall] of invalidCalls.entries()) {
        expect(invalidCall).toThrow(errors[index]);
      }
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

  it.each<[string, () => unknown, RegExp]>([
    ["Uint16Array", () => new Uint16Array([0x4241]), /^feed typed array must be Uint8Array$/],
    ["Float32Array", () => new Float32Array([1]), /^feed typed array must be Uint8Array$/],
    ["Uint8ClampedArray", () => new Uint8ClampedArray([65, 66]), /^feed typed array must be Uint8Array$/],
    ["DataView", () => new DataView(new Uint8Array([65, 66]).buffer), /^feed data must be a string, Buffer, or Uint8Array$/],
  ])("rejects a %s in the addon feed with a TypeError", (_name, makeData, message) => {
    const term = loadNative().createTerminal({ cols: 10, rows: 1 });
    let thrown: unknown;
    try {
      term.feed(makeData() as Uint8Array);
    } catch (error) {
      thrown = error;
    } finally {
      term.dispose();
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(message);
  });

  it.each<[string, () => Uint8Array]>([
    ["Buffer", () => Buffer.from("AB")],
    ["Uint8Array", () => new Uint8Array([65, 66])],
    ["Buffer slice with a byte offset", () => Buffer.from("xxABxx").subarray(2, 4)],
  ])("writes a %s in the addon feed", (_name, makeData) => {
    const term = loadNative().createTerminal({ cols: 10, rows: 1 });
    try {
      term.feed(makeData());
      expect(term.getVisibleText()).toBe("AB");
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
    expect(() =>
      term.encodeMouse(
        { action: "press", button: "left", x: 0, y: 0 },
        { geometry: unitGeometry },
      ),
    ).toThrow(/disposed/);
  });
});
