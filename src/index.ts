import assert from "node:assert/strict";
import { decorateNativeInfo, loadNative } from "./loader.js";
import type {
  CreateTerminalOptions,
  GhosttyVtTerminal,
  MouseAction,
  MouseButton,
  MouseEncoderOptions,
  MouseGeometry,
  MouseInputEvent,
  MouseModifiers,
  NativeInfo,
  NativeTerminal,
  SnapshotOptions,
  TerminalSnapshot,
} from "./types.js";

export type {
  CreateTerminalOptions,
  GhosttyVtTerminal,
  MouseAction,
  MouseButton,
  MouseEncoderOptions,
  MouseGeometry,
  MouseInputEvent,
  MouseModifiers,
  NativeInfo,
  SnapshotCell,
  SnapshotOptions,
  TerminalSnapshot,
  VisibleLine,
} from "./types.js";

/** Import-time capability marker for consumers which must avoid native allocation. */
export const supportsMouseInput = true;

function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(name: string, value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function normalizeCreateOptions(options: CreateTerminalOptions): CreateTerminalOptions {
  assert.equal(typeof options, "object", "options must be an object");
  assert.notEqual(options, null, "options must not be null");
  assertPositiveInteger("cols", options.cols);
  assertPositiveInteger("rows", options.rows);

  const normalized: CreateTerminalOptions = {
    cols: options.cols,
    rows: options.rows,
  };

  if (options.scrollbackLimit !== undefined) {
    assertNonNegativeInteger("scrollbackLimit", options.scrollbackLimit);
    normalized.scrollbackLimit = options.scrollbackLimit;
  }

  return normalized;
}

function normalizeSnapshotOptions(options?: SnapshotOptions): SnapshotOptions {
  if (options === undefined) return {};
  assert.equal(typeof options, "object", "snapshot options must be an object");
  assert.notEqual(options, null, "snapshot options must not be null");
  return {
    includeScrollback: options.includeScrollback === true,
    includeCells: options.includeCells === true,
  };
}

function assertFeedData(data: Uint8Array | Buffer | string): void {
  if (typeof data === "string") return;
  if (data instanceof Uint8Array) return;
  throw new TypeError("feed data must be a string, Buffer, or Uint8Array");
}

const mouseActions = new Set<MouseAction>(["press", "release", "motion"]);
const mouseButtons = new Set<MouseButton>([
  "left",
  "right",
  "middle",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
]);

function assertObject(name: string, value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertFiniteNumber(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function optionalBoolean(name: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

// Reject ambiguous input before native allocation and retain only the fields
// that Ghostty's mouse event model can represent.
function normalizeMouseEvent(event: MouseInputEvent, geometry: MouseGeometry): MouseInputEvent {
  assertObject("mouse event", event);
  const { action, button, x, y, modifiers } = event;
  if (!mouseActions.has(action)) throw new TypeError("mouse action is invalid");
  if (button !== undefined && !mouseButtons.has(button)) {
    throw new TypeError("mouse button is invalid");
  }
  if (action !== "motion" && button === undefined) {
    throw new TypeError(`${action} mouse event requires a button`);
  }
  assertFiniteNumber("mouse x", x);
  assertFiniteNumber("mouse y", y);
  assertMouseCoordinate("mouse x", x, geometry.paddingLeft ?? 0, geometry.cellWidth);
  assertMouseCoordinate("mouse y", y, geometry.paddingTop ?? 0, geometry.cellHeight);

  let normalizedModifiers: MouseModifiers | undefined;
  if (modifiers !== undefined) {
    assertObject("mouse modifiers", modifiers);
    const { shift, ctrl, alt } = modifiers;
    normalizedModifiers = {
      shift: optionalBoolean("mouse modifiers.shift", shift),
      ctrl: optionalBoolean("mouse modifiers.ctrl", ctrl),
      alt: optionalBoolean("mouse modifiers.alt", alt),
    };
  }

  return {
    action,
    ...(button === undefined ? {} : { button }),
    x,
    y,
    ...(normalizedModifiers === undefined ? {} : { modifiers: normalizedModifiers }),
  };
}

// Ghostty stores positions as f32 before converting to u16 cells and i32 pixels.
// Check the rounded representation, including off-screen releases and drags.
function assertMouseCoordinate(name: string, value: number, padding: number, cell: number): void {
  const position = Math.fround(value) - padding;
  if (position < -2147483648 || position > 2147483647 || position / cell >= 65536) {
    throw new RangeError(`${name} is outside Ghostty's cell or pixel coordinate range`);
  }
}

function assertMouseAxis(name: string, screen: number, cell: number, padding: number): void {
  if (padding > screen) throw new RangeError(`mouse geometry padding exceeds ${name}`);
  const cells = Math.fround(Math.fround(screen - padding) / Math.fround(cell));
  if (cells >= 65536) throw new RangeError(`mouse geometry.${name} exceeds the 65535-cell limit`);
}

// Fill stable defaults while preserving explicit renderer geometry for both
// cell-based and pixel-based terminal protocols.
function normalizeMouseOptions(options: MouseEncoderOptions): MouseEncoderOptions {
  assertObject("mouse encoder options", options);
  const { geometry, anyButtonPressed, trackLastCell } = options;
  assertObject("mouse geometry", geometry);
  const {
    screenWidth, screenHeight, cellWidth, cellHeight,
    paddingTop, paddingBottom, paddingRight, paddingLeft,
  } = geometry;
  assertPositiveInteger("mouse geometry.screenWidth", screenWidth);
  assertPositiveInteger("mouse geometry.screenHeight", screenHeight);
  assertPositiveInteger("mouse geometry.cellWidth", cellWidth);
  assertPositiveInteger("mouse geometry.cellHeight", cellHeight);
  for (const [key, value] of Object.entries({ paddingTop, paddingBottom, paddingRight, paddingLeft })) {
    if (value !== undefined) assertNonNegativeInteger(`mouse geometry.${key}`, value);
  }

  const normalizedGeometry = {
    screenWidth,
    screenHeight,
    cellWidth,
    cellHeight,
    paddingTop: paddingTop ?? 0,
    paddingBottom: paddingBottom ?? 0,
    paddingRight: paddingRight ?? 0,
    paddingLeft: paddingLeft ?? 0,
  };
  for (const [key, value] of Object.entries(normalizedGeometry)) {
    if (value > 0xffffffff) throw new RangeError(`mouse geometry.${key} exceeds the 32-bit limit`);
  }
  assertMouseAxis("screenWidth", screenWidth, cellWidth,
    normalizedGeometry.paddingLeft + normalizedGeometry.paddingRight);
  assertMouseAxis("screenHeight", screenHeight, cellHeight,
    normalizedGeometry.paddingTop + normalizedGeometry.paddingBottom);

  return {
    geometry: normalizedGeometry,
    anyButtonPressed: optionalBoolean("anyButtonPressed", anyButtonPressed),
    trackLastCell: optionalBoolean("trackLastCell", trackLastCell),
  };
}

class Terminal implements GhosttyVtTerminal {
  readonly #native: NativeTerminal;
  #disposed = false;

  constructor(native: NativeTerminal) {
    assert.equal(typeof native, "object", "native terminal must be an object");
    assert.notEqual(native, null, "native terminal must not be null");
    this.#native = native;
  }

  feed(data: Uint8Array | Buffer | string): void {
    this.#assertUsable();
    assertFeedData(data);
    this.#native.feed(data);
  }

  resize(cols: number, rows: number): void {
    this.#assertUsable();
    assertPositiveInteger("cols", cols);
    assertPositiveInteger("rows", rows);
    this.#native.resize(cols, rows);
  }

  encodeMouse(event: MouseInputEvent, options: MouseEncoderOptions): Buffer {
    this.#assertUsable();
    const normalizedOptions = normalizeMouseOptions(options);
    return this.#native.encodeMouse(normalizeMouseEvent(event, normalizedOptions.geometry), normalizedOptions);
  }

  snapshot(options?: SnapshotOptions): TerminalSnapshot {
    this.#assertUsable();
    return this.#native.snapshot(normalizeSnapshotOptions(options));
  }

  getVisibleText(): string {
    this.#assertUsable();
    return this.#native.getVisibleText();
  }

  formatPlain(): string {
    this.#assertUsable();
    return this.#native.formatPlain();
  }

  formatHtml(): string {
    this.#assertUsable();
    return this.#native.formatHtml();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#native.dispose();
    this.#disposed = true;
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("GhosttyVtTerminal has been disposed");
    }
  }
}

export function createTerminal(options: CreateTerminalOptions): GhosttyVtTerminal {
  const normalized = normalizeCreateOptions(options);
  return new Terminal(loadNative().createTerminal(normalized));
}

export function getNativeInfo(): NativeInfo {
  return decorateNativeInfo(loadNative().getNativeInfo());
}
