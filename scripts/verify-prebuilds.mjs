#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const prebuildsDir = join(root, "prebuilds");

let platforms;
try {
  platforms = readdirSync(prebuildsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  throw new Error("No prebuilds directory found. Run npm run build:prebuild first.");
}

if (platforms.length === 0) {
  throw new Error("No prebuild platform directories found.");
}

// node-gyp-build tries build/Release before prebuilds/, and prebuildify leaves
// an addon in build/Release. PREBUILDS_ONLY makes it skip build/Release, so this
// check fails unless a prebuild loads. node-gyp-build reads the variable when it
// is first loaded, so set it before dist/index.js loads it.
process.env.PREBUILDS_ONLY = "1";
const { getNativeInfo } = await import("../dist/index.js");
const info = getNativeInfo();

const addon = createRequire(import.meta.url)("node-gyp-build").resolve(root);
const fromPrebuilds = relative(prebuildsDir, addon);
if (fromPrebuilds.startsWith("..") || isAbsolute(fromPrebuilds)) {
  throw new Error(`Loaded the addon from ${addon}, not from ${prebuildsDir}.`);
}

console.log(JSON.stringify({ platforms, addon, nativeInfo: info }, null, 2));
