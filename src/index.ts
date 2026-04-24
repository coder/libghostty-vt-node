import assert from "node:assert/strict";
import { decorateNativeInfo, loadNative } from "./loader.js";
import type {
  CreateTerminalOptions,
  GhosttyVtTerminal,
  NativeInfo,
  NativeTerminal,
  SnapshotOptions,
  TerminalSnapshot,
} from "./types.js";

export type {
  CreateTerminalOptions,
  GhosttyVtTerminal,
  NativeInfo,
  SnapshotCell,
  SnapshotOptions,
  TerminalSnapshot,
  VisibleLine,
} from "./types.js";

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
