export interface CreateTerminalOptions {
  cols: number;
  rows: number;
  scrollbackLimit?: number;
}

export interface SnapshotOptions {
  includeScrollback?: boolean;
  includeCells?: boolean;
}

export type MouseAction = "press" | "release" | "motion";

export type MouseButton =
  | "left"
  | "right"
  | "middle"
  | "four"
  | "five"
  | "six"
  | "seven"
  | "eight"
  | "nine"
  | "ten"
  | "eleven";

export interface MouseModifiers {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

export interface MouseInputEvent {
  action: MouseAction;
  button?: MouseButton;
  x: number;
  y: number;
  modifiers?: MouseModifiers;
}

export interface MouseGeometry {
  screenWidth: number;
  screenHeight: number;
  cellWidth: number;
  cellHeight: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingRight?: number;
  paddingLeft?: number;
}

export interface MouseEncoderOptions {
  geometry: MouseGeometry;
  anyButtonPressed?: boolean;
  trackLastCell?: boolean;
}

export interface VisibleLine {
  row: number;
  text: string;
}

export interface SnapshotCell {
  row: number;
  col: number;
  text: string;
  width: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  foreground?: string;
  background?: string;
}

export interface TerminalSnapshot {
  cols: number;
  rows: number;
  cursorRow: number;
  cursorCol: number;
  isAltScreen: boolean;
  visibleLines: VisibleLine[];
  scrollbackLines?: VisibleLine[];
  cells?: SnapshotCell[];
}

export interface GhosttyVtTerminal {
  feed(data: Uint8Array | Buffer | string): void;
  resize(cols: number, rows: number): void;
  encodeMouse(event: MouseInputEvent, options: MouseEncoderOptions): Buffer;
  snapshot(options?: SnapshotOptions): TerminalSnapshot;
  getVisibleText(): string;
  formatPlain?(): string;
  formatHtml?(): string;
  dispose(): void;
}

export interface NativeInfo {
  packageVersion: string;
  napiVersion: number;
  ghosttyVersion?: string;
  ghosttyCommit?: string;
  platform: string;
  arch: string;
}

export interface NativeTerminal {
  feed(data: Uint8Array | Buffer | string): void;
  resize(cols: number, rows: number): void;
  encodeMouse(event: MouseInputEvent, options: MouseEncoderOptions): Buffer;
  snapshot(options?: SnapshotOptions): TerminalSnapshot;
  getVisibleText(): string;
  formatPlain(): string;
  formatHtml(): string;
  dispose(): void;
}

export interface NativeBindings {
  createTerminal(options: CreateTerminalOptions): NativeTerminal;
  getNativeInfo(): Omit<NativeInfo, "packageVersion" | "platform" | "arch">;
}
