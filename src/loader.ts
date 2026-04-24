import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBindings, NativeInfo } from "./types.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let cachedBindings: NativeBindings | undefined;

function assertNativeShape(value: unknown): asserts value is NativeBindings {
  assert.equal(typeof value, "object", "native addon export must be an object");
  assert.notEqual(value, null, "native addon export must not be null");
  const candidate = value as Partial<NativeBindings>;
  assert.equal(
    typeof candidate.createTerminal,
    "function",
    "native addon must export createTerminal",
  );
  assert.equal(
    typeof candidate.getNativeInfo,
    "function",
    "native addon must export getNativeInfo",
  );
}

export function loadNative(): NativeBindings {
  if (cachedBindings !== undefined) return cachedBindings;

  try {
    const nodeGypBuild = require("node-gyp-build") as (dir: string) => unknown;
    const addon = nodeGypBuild(packageRoot);
    assertNativeShape(addon);
    cachedBindings = addon;
    return cachedBindings;
  } catch (cause) {
    throw new Error(
      [
        "Failed to load @coder/libghostty-vt-node native addon.",
        "Build it with `npm run build:native`, or use an npm package that includes a matching prebuild.",
        "If building locally, provide libghostty-vt with `npm run build:libghostty` or LIBGHOSTTY_VT_PREFIX.",
      ].join(" "),
      { cause },
    );
  }
}

export function getPackageVersion(): string {
  assert.equal(typeof packageJson.version, "string", "package version must be a string");
  return packageJson.version;
}

export function decorateNativeInfo(
  info: Omit<NativeInfo, "packageVersion" | "platform" | "arch">,
): NativeInfo {
  assert.equal(typeof info.napiVersion, "number", "native napiVersion must be a number");
  return {
    ...info,
    packageVersion: getPackageVersion(),
    platform: process.platform,
    arch: process.arch,
  };
}
