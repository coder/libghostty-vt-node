#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const command = process.argv[2];

const prefix = resolve(
  process.env.LIBGHOSTTY_VT_PREFIX ?? join(root, "vendor", "libghostty-vt"),
);
const includeDir = resolve(
  process.env.LIBGHOSTTY_VT_INCLUDE_DIR ?? join(prefix, "include"),
);
const defaultStaticLib =
  process.platform === "win32" ? "ghostty-vt-static.lib" : "libghostty-vt.a";
const libraryPath = resolve(
  process.env.LIBGHOSTTY_VT_STATIC_LIB ??
    process.env.LIBGHOSTTY_VT_LIB ??
    join(prefix, "lib", defaultStaticLib),
);

function fail(message) {
  console.error(`@coder/libghostty-vt-node: ${message}`);
  console.error("");
  console.error("Expected a local libghostty-vt installation. Either:");
  console.error("  1. run `npm run build:libghostty`, or");
  console.error("  2. set LIBGHOSTTY_VT_PREFIX=/path/to/prefix, or");
  console.error("  3. set LIBGHOSTTY_VT_INCLUDE_DIR and LIBGHOSTTY_VT_STATIC_LIB.");
  console.error("");
  console.error(`Checked include dir: ${includeDir}`);
  console.error(`Checked static lib:  ${libraryPath}`);
  process.exit(1);
}

if (command !== "include" && command !== "library") {
  console.error("usage: resolve-libghostty-vt.mjs <include|library>");
  process.exit(2);
}

const header = join(includeDir, "ghostty", "vt.h");
if (!existsSync(header)) {
  fail("missing header ghostty/vt.h");
}

if (!existsSync(libraryPath)) {
  fail(`missing static library ${defaultStaticLib}`);
}

if (command === "include") {
  process.stdout.write(includeDir);
} else {
  process.stdout.write(libraryPath);
}
