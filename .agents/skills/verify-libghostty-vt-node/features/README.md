# libghostty-vt-node verification map

This directory is the maintained source for verifying what a user of `@coder/libghostty-vt-node` sees. Read this index before you drive the package. Then use the matching feature file as the recipe.

## Baseline preconditions

- Run every command from the repo root.
- `RUN_ROOT` is a directory outside the checkout that `launch.sh` made for this run. Never drive a `RUN_ROOT` that another run made.
- `doctor.sh "$RUN_ROOT"` exits `0`. Run it again after any change to the checkout: it fails with `STALE` when the build no longer matches the code.
- `S=.agents/skills/verify-libghostty-vt-node/scripts`.

## Driving conventions

- Each journey is an ES module that `drive.sh` runs in the consumer project. It imports `@coder/libghostty-vt-node` by name, the way a user does.
- Each journey asserts its own result with `node:assert/strict`, so the exit code is the verdict. It also prints what it saw, so stdout shows the result.
- Copy each command literally. Give each run a new journey name: `drive.sh` refuses to overwrite evidence. Add a suffix such as `-2` for a second run.
- Each journey creates its own terminals and disposes them. No journey depends on another one.

## Proof and skip reporting

- A journey's proof is its directory in `$RUN_ROOT/evidence/`: `journey.mjs`, `command.txt`, `stdout.txt`, `stderr.txt`, and `exit-code.txt`. Also keep `$RUN_ROOT/evidence/instance.json`, which names the commit and tarball.
- Report the journey name and its exit code with every claim.
- Report a failed journey with its stderr. Do not change a journey's assertions to make it pass.
- When a precondition fails, report the command and the unmet precondition. Do not report a skipped sub-feature as verified through another one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes what the user sees. It then has exactly four H2 sections in this order.

1. `Sub-features` lists short IDs, one line for each behavior. Each ID is also the journey name.
2. `How to get to it (user POV)` lists each public API call or install step that reaches the feature.
3. `Driving it with drive.sh` starts with `Preconditions:` and pairs each action with a literal command and its observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

## Features

- [Feed bytes and read text](./terminal-text.md) covers `feed` input kinds, escape handling, split UTF-8, and the debug formatters.
- [Structured snapshot](./snapshot.md) covers size, cursor, styled cells, scrollback, and the alternate screen.
- [Resize](./resize.md) covers new sizes, reflow, and invalid sizes.
- [Lifecycle and errors](./lifecycle.md) covers `dispose`, garbage collection, invalid input, and worker threads.
- [Install, load, and native info](./native-info.md) covers the installed package, `getNativeInfo`, and the missing-addon error.
