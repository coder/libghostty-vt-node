# Feed bytes and read text

A user creates a terminal, feeds it the bytes a program wrote (a string, a `Buffer`, or a `Uint8Array`), and reads the screen back as plain text. Escape sequences change the screen but never show up in the text. `formatPlain()` and `formatHtml()` export the same screen for debugging.

## Sub-features

- `text-feed-kinds` accepts a string, a `Buffer`, and a `Uint8Array`.
- `text-sgr-hidden` keeps color escapes out of the visible text.
- `text-utf8-split` joins a UTF-8 character that arrives split across feeds.
- `text-formatters` exports the screen as plain text and as HTML.

## How to get to it (user POV)

- `createTerminal({ cols, rows })`, then `term.feed(data)` and `term.getVisibleText()`.
- `term.formatPlain()` and `term.formatHtml()` on the same terminal.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **Feed each kind and read the text.** Run `text-feed-kinds`. Exit `0`, and stdout is `"hello\nbuf\nu8\n"`: one line for each feed, then the empty fourth row.

```sh
$S/drive.sh "$RUN_ROOT" text-feed-kinds <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 20, rows: 4 });
t.feed("hello\r\n");
t.feed(Buffer.from("buf\r\n"));
t.feed(new Uint8Array([0x75, 0x38, 0x0d, 0x0a]));
const text = t.getVisibleText();
console.log(JSON.stringify(text));
assert.equal(text, "hello\nbuf\nu8\n");
t.dispose();
JS
```

- **Color escapes stay out of the text.** Run `text-sgr-hidden`. Exit `0`, and stdout is `"red text"`.

```sh
$S/drive.sh "$RUN_ROOT" text-sgr-hidden <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 20, rows: 1 });
t.feed("\x1b[31mred\x1b[0m \x1b[1;4mtext\x1b[0m");
console.log(JSON.stringify(t.getVisibleText()));
assert.equal(t.getVisibleText(), "red text");
t.dispose();
JS
```

- **A split UTF-8 character.** Feed the three bytes of `界` in three calls, then `x`. Run `text-utf8-split`. Exit `0`. Stdout shows the text `"界x"` and two cells: `界` at col 0 with width 2, and `x` at col 2.

```sh
$S/drive.sh "$RUN_ROOT" text-utf8-split <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 1 });
const bytes = Buffer.from("界x");
t.feed(bytes.subarray(0, 1)); t.feed(bytes.subarray(1, 2)); t.feed(bytes.subarray(2));
const cells = t.snapshot({ includeCells: true }).cells;
console.log(JSON.stringify(t.getVisibleText()), JSON.stringify(cells));
assert.equal(t.getVisibleText(), "界x");
assert.deepEqual(cells.map((c) => [c.text, c.col, c.width]), [["界", 0, 2], ["x", 2, 1]]);
t.dispose();
JS
```

- **Debug formatters.** Run `text-formatters`. Exit `0`. `formatPlain` prints `"hello\nred"`. The HTML starts with `<div style="font-family: monospace; white-space: pre;">` and colors red with `var(--vt-palette-1)`.

```sh
$S/drive.sh "$RUN_ROOT" text-formatters <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 20, rows: 3 });
t.feed("hello\r\n\x1b[31mred\x1b[0m");
const plain = t.formatPlain(), html = t.formatHtml();
console.log(JSON.stringify(plain)); console.log(html);
assert.equal(plain, "hello\nred");
assert.ok(html.startsWith('<div style="font-family: monospace; white-space: pre;">'));
assert.match(html, /color: var\(--vt-palette-1\);[^>]*>red</);
t.dispose();
JS
```

## Gotchas

- `\n` alone moves down without a carriage return. Feed `\r\n` when the test expects each line to start at column 0.
- `getVisibleText()` returns every row, with trailing spaces trimmed, joined by `\n`. Empty rows give trailing `\n` characters.
- `formatPlain()` trims trailing empty rows. `getVisibleText()` does not. Do not compare the two strings directly.
- The HTML uses CSS variables (`--vt-palette-N`) for palette colors, not hex values. A snapshot gives hex values.
