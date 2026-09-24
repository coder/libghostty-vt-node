import { describe, expect, it } from "vitest";
import { createTerminal, supportsMouseInput } from "../src/index.js";
import { nativeSupport } from "./native-support.js";

const support = nativeSupport();
const describeIfNative = support.available ? describe : describe.skip;

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

      for (const invalidCall of invalidCalls) {
        expect(invalidCall).toThrow();
      }
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
