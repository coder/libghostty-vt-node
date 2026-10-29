# Resize

A user resizes the terminal when the real terminal window changes size. The snapshot reports the new size, and wrapped text reflows to the new width.

## Sub-features

- `resize-dims` changes `cols` and `rows` in the snapshot.
- `resize-reflow` rewraps a long line when the width shrinks and joins it again when the width grows.
- `resize-invalid` rejects sizes that are not positive 16-bit integers.

## How to get to it (user POV)

- `term.resize(cols, rows)`.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **New size.** Resize 80x24 to 100x30. Run `resize-dims`. Exit `0`, and stdout is `100 30`.

```sh
$S/drive.sh "$RUN_ROOT" resize-dims <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 80, rows: 24 });
t.resize(100, 30);
const s = t.snapshot();
console.log(s.cols, s.rows);
assert.deepEqual([s.cols, s.rows, s.visibleLines.length], [100, 30, 30]);
t.dispose();
JS
```

- **Reflow.** Write `0123456789abc` into a 10-column terminal, shrink it to 5 columns, then widen it to 20. Run `resize-reflow`. Exit `0`. Stdout shows `0123456789/abc`, then `01234/56789/abc`, then `0123456789abc`.

```sh
$S/drive.sh "$RUN_ROOT" resize-reflow <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 3 });
const rows = () => t.snapshot().visibleLines.map((l) => l.text).filter(Boolean).join("/");
t.feed("0123456789abc");
const before = rows(); t.resize(5, 6);
const narrow = rows(); t.resize(20, 3);
const wide = rows();
console.log(before); console.log(narrow); console.log(wide);
assert.deepEqual([before, narrow, wide], ["0123456789/abc", "01234/56789/abc", "0123456789abc"]);
t.dispose();
JS
```

- **Invalid sizes.** Call `resize(0, 1)`, `resize(1.5, 1)`, and `resize(70000, 1)`. Run `resize-invalid`. Exit `0`. The first two throw `TypeError: cols must be a positive integer`. The third throws `RangeError: cols must be a positive 16-bit integer`. The size stays 10x3.

```sh
$S/drive.sh "$RUN_ROOT" resize-invalid <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 10, rows: 3 });
for (const [cols, Err, msg] of [[0, TypeError, /positive integer/], [1.5, TypeError, /positive integer/],
                                 [70000, RangeError, /positive 16-bit integer/]]) {
  try { t.resize(cols, 1); assert.fail(`resize(${cols}) did not throw`); }
  catch (e) { console.log(`resize(${cols}, 1):`, e.constructor.name, e.message);
              assert.ok(e instanceof Err); assert.match(e.message, msg); }
}
const s = t.snapshot();
assert.deepEqual([s.cols, s.rows], [10, 3]);
t.dispose();
JS
```

## Gotchas

- Only wrapped lines reflow. A line that ended with `\r\n` stays its own row.
- The JS layer rejects non-integers and values below 1 with `TypeError`. The native layer rejects values above 65535 with `RangeError`. Both layers are on the user path, so test both.
