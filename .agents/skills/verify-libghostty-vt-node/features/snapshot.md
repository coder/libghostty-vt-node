# Structured snapshot

A user calls `term.snapshot()` to read the screen as data: size, cursor position, alternate-screen flag, one entry for each visible row and, on request, the styled cells and the scrollback rows.

## Sub-features

- `snapshot-shape` reports size, cursor, and one `visibleLines` entry for each row.
- `snapshot-cells` reports each cell's text, width, and style when `includeCells` is set.
- `snapshot-scrollback` reports rows that scrolled off when `includeScrollback` is set.
- `snapshot-alt-screen` reports `isAltScreen` and the alternate screen's text.

## How to get to it (user POV)

- `term.snapshot()`, `term.snapshot({ includeCells: true })`, `term.snapshot({ includeScrollback: true })`.
- `createTerminal({ cols, rows, scrollbackLimit })` sets how many rows scrollback keeps.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **Shape and cursor.** Write `hello` on the first row, move the cursor to row 3, column 5 (`ESC[3;5H`), and write `cursor`. Run `snapshot-shape`. Exit `0`. Stdout shows `cols` 80, `rows` 24, `cursorRow` 2, `cursorCol` 10 (both zero-based), the first 3 visible lines, and no `cells` or `scrollbackLines` key. The journey asserts that there are 24 visible lines.

```sh
$S/drive.sh "$RUN_ROOT" snapshot-shape <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 80, rows: 24 });
t.feed("hello\r\n\x1b[3;5Hcursor");
const s = t.snapshot();
console.log(JSON.stringify({ ...s, visibleLines: s.visibleLines.slice(0, 3) }));
assert.deepEqual([s.cols, s.rows, s.cursorRow, s.cursorCol, s.isAltScreen], [80, 24, 2, 10, false]);
assert.equal(s.visibleLines.length, 24);
assert.deepEqual(s.visibleLines[2], { row: 2, text: "    cursor" });
assert.ok(!("cells" in s) && !("scrollbackLines" in s));
t.dispose();
JS
```

- **Styled cells.** Write `S` bold, italic, underlined, red on green, then `R` in RGB `1;2;3`. Run `snapshot-cells`. Exit `0`. The `S` cell has `bold`, `italic`, `underline`, `foreground` `#cc6666`, and `background` `#b5bd68`. The `R` cell has `foreground` `#010203` and no other style keys.

```sh
$S/drive.sh "$RUN_ROOT" snapshot-cells <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 1 });
t.feed("\x1b[1;3;4;31;42mS\x1b[0m\x1b[38;2;1;2;3mR\x1b[0m");
const cells = t.snapshot({ includeCells: true }).cells;
console.log(JSON.stringify(cells));
assert.deepEqual(cells[0], { row: 0, col: 0, text: "S", width: 1, bold: true, italic: true,
  underline: true, foreground: "#cc6666", background: "#b5bd68" });
assert.deepEqual(cells[1], { row: 0, col: 1, text: "R", width: 1, foreground: "#010203" });
t.dispose();
JS
```

- **Scrollback.** Write 6 lines into a 3-row terminal with `scrollbackLimit: 100`. Run `snapshot-scrollback`. Exit `0`. `scrollbackLines` holds `l1`, `l2`, `l3` (rows 0 to 2). The visible rows are `l4`, `l5`, `l6`.

```sh
$S/drive.sh "$RUN_ROOT" snapshot-scrollback <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 3, scrollbackLimit: 100 });
t.feed("l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6");
const s = t.snapshot({ includeScrollback: true });
console.log(JSON.stringify({ scrollbackLines: s.scrollbackLines, visibleLines: s.visibleLines }));
assert.deepEqual(s.scrollbackLines.map((l) => l.text), ["l1", "l2", "l3"]);
assert.deepEqual(s.visibleLines.map((l) => l.text), ["l4", "l5", "l6"]);
t.dispose();
JS
```

- **Alternate screen.** Write `primary`, enter the alternate screen (`ESC[?1049h`), move the cursor home (`ESC[H`), write `alt`, then leave it (`ESC[?1049l`). Run `snapshot-alt-screen`. Exit `0`. Stdout shows `true` with the text `alt`, then `false` with the text `primary`.

```sh
$S/drive.sh "$RUN_ROOT" snapshot-alt-screen <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 20, rows: 2 });
t.feed("primary\x1b[?1049h\x1b[Halt");
const inAlt = t.snapshot();
t.feed("\x1b[?1049l");
const back = t.snapshot();
console.log(inAlt.isAltScreen, JSON.stringify(inAlt.visibleLines[0].text));
console.log(back.isAltScreen, JSON.stringify(back.visibleLines[0].text));
assert.deepEqual([inAlt.isAltScreen, inAlt.visibleLines[0].text], [true, "alt"]);
assert.deepEqual([back.isAltScreen, back.visibleLines[0].text], [false, "primary"]);
t.dispose();
JS
```

## Gotchas

- `cells` lists only cells that have text. Blank cells and the spacer cell after a wide character are not in it.
- Palette colors come from Ghostty's default palette (red is `#cc6666`). A change of the pinned Ghostty commit can change these values. Treat that as a change to check, not as noise.
- `scrollbackLines` is an empty array until a row scrolls off. With `scrollbackLimit: 0` it stays empty.
- Entering the alternate screen keeps the cursor column. Feed `ESC[H` first when the test expects text at column 0.
