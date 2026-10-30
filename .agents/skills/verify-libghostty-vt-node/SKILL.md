---
name: verify-libghostty-vt-node
description: "Drive @coder/libghostty-vt-node the way a user does: build and pack the package from this checkout, install the tarball into a scratch consumer project, run Node journeys that import the package by name, and keep stdout, stderr, and exit codes as evidence. Use to prove a change to the public API (createTerminal, feed, snapshot, resize, dispose, getNativeInfo), the native addon, the loader, or the package contents works for a package user."
---

# Verify libghostty-vt-node as a package user

The user surface is a Node library. A user runs `npm install @coder/libghostty-vt-node` and gets a prebuilt addon for the platform. Then the user imports the package by name and calls `createTerminal`, `feed`, `snapshot`, `resize`, `getVisibleText`, `formatPlain`, `formatHtml`, `dispose`, and `getNativeInfo`. This skill reproduces that path from the current checkout, uncommitted changes included. It does not import `src/` or `dist/` from the checkout.

Other surfaces are out of scope here. The release workflows (`.github/workflows/publish.yml`, `mise run publish-dry-run`) publish to npm. Do not drive them for verification. The worker-thread and dispose lifecycle has a formal check in the `verify-native-lifecycle` skill.

All commands run from the repo root. Set this first, and again in each new shell (agent tool calls often start a new shell, so set `S`, `RUN_ROOT`, and `PATH` in each call):

```sh
S=.agents/skills/verify-libghostty-vt-node/scripts
```

## Requirements

- The toolchain that `mise.toml` pins: Node `26.12.1` and Zig `0.17.0` on `PATH`. `mise install` installs them. If `mise exec` fails on your host, put the two install directories on `PATH` directly, for example `~/.local/share/mise/installs/node/26.12.1/bin` and `~/.local/share/mise/installs/zig/0.17.0`.
- A C++17 compiler and Python for `node-gyp`.
- A checkout that mise trusts. In an untrusted copy, a mise shim that a build step calls fails with `Config files in .../mise.toml are not trusted`, and `launch.sh` exits `1`.
- The network on the first launch: `npm ci`, the Ghostty clone in `npm run build:libghostty`, and the dependency install in the consumer project.

## Launch

```sh
$S/launch.sh                  # makes a new RUN_ROOT with mktemp
$S/launch.sh "$RUN_ROOT"      # or uses a directory that you name, outside the checkout
```

`launch.sh` runs in the checkout: `npm ci` (when `node_modules/` was not built from the current `package-lock.json`), `npm run build:libghostty` (when `vendor/libghostty-vt/` was not built from the current `scripts/build-libghostty-vt.sh` and `GHOSTTY_*` / `LIBGHOSTTY_VT_*` variables), `npm run build` from an empty `dist/`, `npm run build:prebuild`, and `npm pack`. A stamp file with the hash of those inputs records each reuse decision, and `RUN_ROOT/instance/launch.log` lists the steps that ran. It records the commit and tracked diff before the build, and it fails if they change before the end. Then it installs the tarball into `RUN_ROOT/instance/consumer/` with `npm install`. It is ready when the last line is `READY RUN_ROOT=<dir>`. Set the shell variable `RUN_ROOT` to that path. It can differ from the path you gave, because `launch.sh` resolves symlinks. A warm launch takes about 15 seconds. The first one also builds libghostty-vt.

A `RUN_ROOT` that you name must be a real directory (not a symlink) that only you can write. Every directory above it must be owned by you or root, and group or others must not be able to write it, unless it has the sticky bit, like `/tmp`. `launch.sh` creates a missing one with mode `700`. It refuses anything else, because `npm install` runs package scripts from the tarball in `RUN_ROOT`.

`launch.sh` writes `build/`, `dist/`, and `prebuilds/` in the checkout, so only one launch can run per checkout. A second launch exits `2` and names the lock directory `vendor/.verify-launch.lock`. After launch, each `RUN_ROOT` is independent: many runs can drive their own instances at the same time.

There is no server to tear down. Each journey is a short Node process. Teardown is `cleanup.sh`.

## Doctor

```sh
$S/doctor.sh "$RUN_ROOT"
```

It is read-only. Exit `0` means that the instance is worth driving. Each line starts with `ok`, `WARN`, or `FAIL`. It checks that:

1. `instance.json` exists, `launch.sh` made it, and it names this checkout.
2. The checkout has the same `HEAD` and the same tracked diff as at launch. Otherwise it prints `STALE`: run `cleanup.sh`, then `launch.sh` with a new `RUN_ROOT`.
3. `node` on `PATH` is the version that launch used. It warns when that is not the `mise.toml` pin.
4. The package is a real copy in the consumer's `node_modules`, not a symlink to the checkout.
5. `node-gyp-build` picks the packed prebuild (`prebuilds/<platform>-<arch>/@coder+libghostty-vt-node.node`).
6. The bare import resolves inside the consumer, and `getNativeInfo().packageVersion` matches `package.json`.

Run it first, and again whenever a result looks wrong.

## Drive

A journey is an ES module that `drive.sh` reads from stdin and runs with `node` in the consumer project. It imports `@coder/libghostty-vt-node` by name and asserts its own result with `node:assert/strict`, so its exit code is the verdict.

```sh
$S/drive.sh "$RUN_ROOT" my-journey <<'JS'
import assert from "node:assert/strict";
import { createTerminal } from "@coder/libghostty-vt-node";
const t = createTerminal({ cols: 20, rows: 2 });
t.feed("hi");
console.log(JSON.stringify(t.getVisibleText()));
assert.equal(t.getVisibleText(), "hi\n");
t.dispose();
JS
```

Put node flags after the name, for example `$S/drive.sh "$RUN_ROOT" lifecycle-gc --expose-gc`. `drive.sh` prints the journey's stdout, then `--- exit N, evidence in <dir>` on stderr, and it exits with the journey's code. When stdout and stderr share one stream, the exit line can show up out of order: read `exit-code.txt` for the verdict. A crash gives `128 + signal`: `134` for SIGABRT, `139` for SIGSEGV.

The map in [`features/README.md`](features/README.md) has a literal journey for each sub-feature. Read the index, then use the matching feature file.

## Evidence

Each journey writes `RUN_ROOT/evidence/<name>/`: `journey.mjs`, `command.txt` (directory, node flags, time, node version), `stdout.txt`, `stderr.txt`, and `exit-code.txt`. `RUN_ROOT/evidence/instance.json` names the commit, the tracked-diff hash, and the sha256 of the tarball, of the loaded addon, and of the libghostty-vt static library with the hash of its build inputs. One `RUN_ROOT` holds the evidence of one launch: `launch.sh` refuses a `RUN_ROOT` whose `evidence/` is not empty. `drive.sh` refuses to overwrite a journey's directory.

Proof standards:

- Drive the installed package through its public exports. Do not import `src/`, `dist/` in the checkout, the `.node` file, or the native `createTerminal` directly.
- A proof shows the action and the resulting state. Print what the journey saw (text, snapshot fields, error type and message), and assert it.
- Check side effects that a user can see: the files in the installed package (`info-package-contents`), and the addon file that `doctor.sh` reports.
- No mocks. The package has no external system to stand in for.
- A failed journey is a result. Report it with its stderr. Do not change the assertions to make it pass.

## Cleanup

```sh
$S/cleanup.sh "$RUN_ROOT"
```

It removes `RUN_ROOT/instance/` (the tarball, the consumer project, and the `no-addon` copy that `info-load-error` makes). It refuses an `instance/` without the `.verify-libghostty-vt-node` marker that `launch.sh` writes first, so it also cleans up after a failed launch. It keeps `RUN_ROOT/evidence/` and lists it. It does not touch the checkout's `build/`, `dist/`, or `prebuilds/`: those are normal build outputs, and git ignores them. Run cleanup after every run, the failed ones too. Remove `RUN_ROOT` yourself when you no longer need the evidence.

## Gotchas

- `launch.sh` packs whatever is in `prebuilds/`, including directories for other platforms from an earlier `mise run assemble-prebuilds`. `doctor.sh` checks that this platform's prebuild is the one that loads.
- `doctor.sh` hashes only tracked changes. A new untracked source file does not make the instance `STALE`. Relaunch after you add one.
- `RUN_ROOT` must be outside the checkout, so the instance never shows up in `git status` and no import can resolve to the checkout's own files. `launch.sh` refuses a `RUN_ROOT` inside it.
