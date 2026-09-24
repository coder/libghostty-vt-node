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
function normalizeMouseEvent(event: MouseInputEvent): MouseInputEvent {
  assertObject("mouse event", event);
  if (!mouseActions.has(event.action)) throw new TypeError("mouse action is invalid");
  if (event.button !== undefined && !mouseButtons.has(event.button)) {
    throw new TypeError("mouse button is invalid");
  }
  if (event.action !== "motion" && event.button === undefined) {
    throw new TypeError(`${event.action} mouse event requires a button`);
  }
  assertFiniteNumber("mouse x", event.x);
  assertFiniteNumber("mouse y", event.y);

  let modifiers: MouseModifiers | undefined;
  if (event.modifiers !== undefined) {
    assertObject("mouse modifiers", event.modifiers);
    modifiers = {
      shift: optionalBoolean("mouse modifiers.shift", event.modifiers.shift),
      ctrl: optionalBoolean("mouse modifiers.ctrl", event.modifiers.ctrl),
      alt: optionalBoolean("mouse modifiers.alt", event.modifiers.alt),
    };
  }

  return {
    action: event.action,
    ...(event.button === undefined ? {} : { button: event.button }),
    x: event.x,
    y: event.y,
    ...(modifiers === undefined ? {} : { modifiers }),
  };
}

// Fill stable defaults while preserving explicit renderer geometry for both
// cell-based and pixel-based terminal protocols.
function normalizeMouseOptions(options: MouseEncoderOptions): MouseEncoderOptions {
  assertObject("mouse encoder options", options);
  assertObject("mouse geometry", options.geometry);
  const geometry = options.geometry;
  assertPositiveInteger("mouse geometry.screenWidth", geometry.screenWidth);
  assertPositiveInteger("mouse geometry.screenHeight", geometry.screenHeight);
  assertPositiveInteger("mouse geometry.cellWidth", geometry.cellWidth);
  assertPositiveInteger("mouse geometry.cellHeight", geometry.cellHeight);

  const normalizedGeometry: MouseGeometry = {
    screenWidth: geometry.screenWidth,
    screenHeight: geometry.screenHeight,
    cellWidth: geometry.cellWidth,
    cellHeight: geometry.cellHeight,
  };
  for (const key of ["paddingTop", "paddingBottom", "paddingRight", "paddingLeft"] as const) {
    const value = geometry[key];
    if (value !== undefined) assertNonNegativeInteger(`mouse geometry.${key}`, value);
    normalizedGeometry[key] = value ?? 0;
  }

  return {
    geometry: normalizedGeometry,
    anyButtonPressed: optionalBoolean("anyButtonPressed", options.anyButtonPressed),
    trackLastCell: optionalBoolean("trackLastCell", options.trackLastCell),
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
    return this.#native.encodeMouse(normalizeMouseEvent(event), normalizeMouseOptions(options));
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
