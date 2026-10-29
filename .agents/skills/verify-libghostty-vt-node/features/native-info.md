# Install, load, and native info

A user installs the npm package and imports it. The package loads the prebuilt addon for the user's platform without a compiler. `getNativeInfo()` reports the package version, Node-API version, platform, and Ghostty version. When no addon fits, the import works and the first native call throws a clear setup error.

## Sub-features

- `info-fields` reports the package version, Node-API version, platform, arch, and Ghostty version.
- `info-package-contents` ships `dist/` and the prebuild, and leaves sources and tests out.
- `info-load-error` throws the setup error when the addon is missing.

## How to get to it (user POV)

- `npm install @coder/libghostty-vt-node`, then `import { getNativeInfo, createTerminal } from "@coder/libghostty-vt-node"`.
- `getNativeInfo()`.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **Native info.** Run `info-fields`. Exit `0`. Stdout is one JSON object with `packageVersion` equal to `package.json`'s version, `napiVersion` 8 or more, `platform` and `arch` of this machine, and a `ghosttyVersion` string.

```sh
$S/drive.sh "$RUN_ROOT" info-fields <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNativeInfo } from "@coder/libghostty-vt-node";
const info = getNativeInfo();
const pkg = JSON.parse(readFileSync("node_modules/@coder/libghostty-vt-node/package.json", "utf8"));
console.log(JSON.stringify(info));
assert.equal(info.packageVersion, pkg.version);
assert.ok(info.napiVersion >= 8);
assert.deepEqual([info.platform, info.arch], [process.platform, process.arch]);
assert.equal(typeof info.ghosttyVersion, "string");
JS
```

- **Package contents.** List the installed package. Run `info-package-contents`. Exit `0`. Stdout lists `dist/index.js`, `dist/index.d.ts`, and `prebuilds/<platform>-<arch>/@coder+libghostty-vt-node.node`, and no `src/`, `test/`, `vendor/`, or `build/` entry.

```sh
$S/drive.sh "$RUN_ROOT" info-package-contents <<'JS'
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
const dir = "node_modules/@coder/libghostty-vt-node";
const files = readdirSync(dir, { recursive: true }).map(String).sort();
console.log(files.join("\n"));
const addon = `prebuilds/${process.platform}-${process.arch}/@coder+libghostty-vt-node.node`;
for (const f of ["dist/index.js", "dist/index.d.ts", addon]) assert.ok(files.includes(f), `missing ${f}`);
for (const d of ["src", "test", "vendor", "build"]) assert.ok(!files.includes(d), `ships ${d}/`);
JS
```

- **Missing addon.** The journey copies the installed package to `instance/no-addon/` without `prebuilds/`, imports the copy, and calls `getNativeInfo()`. Run `info-load-error`. Exit `0`. Stdout shows that the import worked, then `Failed to load @coder/libghostty-vt-node native addon. Build it with \`npm run build:native\`...`.

```sh
$S/drive.sh "$RUN_ROOT" info-load-error <<'JS'
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const copy = resolve("../no-addon/node_modules/@coder/libghostty-vt-node");
rmSync(resolve("../no-addon"), { recursive: true, force: true });
cpSync("node_modules/@coder/libghostty-vt-node", copy, { recursive: true });
cpSync("node_modules/node-gyp-build", resolve("../no-addon/node_modules/node-gyp-build"), { recursive: true });
rmSync(resolve(copy, "prebuilds"), { recursive: true });
const m = await import(pathToFileURL(resolve(copy, "dist/index.js")).href);
console.log("import worked");
assert.throws(() => m.getNativeInfo(), (e) => { console.log(e.message); return /^Failed to load @coder\/libghostty-vt-node native addon\./.test(e.message); });
JS
```

## Gotchas

- `getNativeInfo()` has no `ghosttyCommit` with the current build (the Ghostty build reports no build string). Do not use it to check the pinned commit.
- `ghosttyVersion` is `0.1.0-dev` at the current pin. It is Ghostty's version, not this package's.
- The import itself never fails for a missing addon. The loader runs on the first native call (`createTerminal` or `getNativeInfo`).
- `info-load-error` writes `instance/no-addon/`. `cleanup.sh` removes it with the instance.
