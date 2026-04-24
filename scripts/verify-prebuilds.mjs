#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const prebuildsDir = join(root, "prebuilds");

let platforms;
try {
  platforms = readdirSync(prebuildsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  throw new Error("No prebuilds directory found. Run npm run prebuild first.");
}

if (platforms.length === 0) {
  throw new Error("No prebuild platform directories found.");
}

const { getNativeInfo } = await import("../dist/index.js");
const info = getNativeInfo();
console.log(JSON.stringify({ platforms, nativeInfo: info }, null, 2));
