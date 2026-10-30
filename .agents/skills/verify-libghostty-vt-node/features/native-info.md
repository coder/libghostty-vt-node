# Install, load, and native info

A user installs the npm package and imports it. The package loads the prebuilt addon for the user's platform without a compiler. `getNativeInfo()` reports the package version, Node-API version, platform, the libghostty-vt version, and the Ghostty commit the addon was built from. When no addon fits, the import works and the first native call throws a clear setup error.

## Sub-features

- `info-fields` reports the package version, Node-API version, platform, arch, libghostty-vt version, and Ghostty commit (`ghosttyCommit`).
- `info-package-contents` ships `dist/` and the prebuild, and leaves sources and tests out.
- `info-load-error` throws the setup error when the addon is missing.

## How to get to it (user POV)

- `npm install @coder/libghostty-vt-node`, then `import { getNativeInfo, createTerminal } from "@coder/libghostty-vt-node"`.
- `getNativeInfo()`.

## Driving it with drive.sh

Preconditions:

- `launch.sh` printed `READY RUN_ROOT=...`, and `doctor.sh "$RUN_ROOT"` exits `0`.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`, run from the repo root.

- **Native info.** Run `info-fields`. Exit `0`. Stdout is one JSON object with `packageVersion` equal to `package.json`'s version, `napiVersion` 8 or more, `platform` and `arch` of this machine, `ghosttyCommit` equal to the default `GHOSTTY_COMMIT` in the installed `scripts/build-libghostty-vt.sh`, and `ghosttyVersion` ending with `+` and that commit.

```sh
$S/drive.sh "$RUN_ROOT" info-fields <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNativeInfo } from "@coder/libghostty-vt-node";
const info = getNativeInfo();
const pkg = JSON.parse(readFileSync("node_modules/@coder/libghostty-vt-node/package.json", "utf8"));
const buildScript = readFileSync("node_modules/@coder/libghostty-vt-node/scripts/build-libghostty-vt.sh", "utf8");
const pinned = buildScript.match(/^GHOSTTY_COMMIT="\$\{GHOSTTY_COMMIT:-([0-9a-f]{40})\}"$/m)?.[1];
assert.ok(pinned, "no default GHOSTTY_COMMIT in scripts/build-libghostty-vt.sh");
console.log(JSON.stringify(info));
assert.equal(info.packageVersion, pkg.version);
assert.ok(info.napiVersion >= 8);
assert.deepEqual([info.platform, info.arch], [process.platform, process.arch]);
assert.equal(info.ghosttyCommit, pinned);
assert.ok(info.ghosttyVersion.endsWith(`+${pinned}`), info.ghosttyVersion);
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

- `ghosttyCommit` is the full Ghostty commit only when `scripts/build-libghostty-vt.sh` built libghostty-vt. A prebuild from a build with `GHOSTTY_COMMIT` overridden fails `info-fields`.
- `ghosttyVersion` is libghostty-vt's version with the commit as build metadata, `0.1.0-dev+<commit>` at the current pin. It is not the Ghostty release (1.4.0) and not this package's version.
- The import itself never fails for a missing addon. The loader runs on the first native call (`createTerminal` or `getNativeInfo`).
- `info-load-error` writes `instance/no-addon/`. `cleanup.sh` removes it with the instance.
