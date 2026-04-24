import { createTerminal, getNativeInfo } from "../src/index.js";

const term = createTerminal({ cols: 80, rows: 24, scrollbackLimit: 100 });

try {
  term.feed("hello\n");
  term.feed("\x1b[31mred text\x1b[0m\n");
  term.feed("\x1b[3;5Hcursor");

  const snapshot = term.snapshot({ includeCells: true });
  console.log("native info");
  console.log(JSON.stringify(getNativeInfo(), null, 2));
  console.log("visible text");
  console.log(term.getVisibleText());
  console.log("snapshot summary");
  console.log(
    JSON.stringify(
      {
        cols: snapshot.cols,
        rows: snapshot.rows,
        cursorRow: snapshot.cursorRow,
        cursorCol: snapshot.cursorCol,
        isAltScreen: snapshot.isAltScreen,
        visibleLineCount: snapshot.visibleLines.length,
        cellCount: snapshot.cells?.length ?? 0,
      },
      null,
      2,
    ),
  );
} finally {
  term.dispose();
}
