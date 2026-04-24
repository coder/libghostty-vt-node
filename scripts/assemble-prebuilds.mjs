#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = resolve(process.argv[2] ?? join(root, ".release-artifacts"));
const targetRoot = resolve(process.argv[3] ?? join(root, "prebuilds"));
const expectedPlatforms = (
  process.env.EXPECTED_PREBUILD_PLATFORMS ?? "darwin-arm64,linux-arm64,linux-x64"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

assert.notEqual(sourceRoot, targetRoot, "prebuild source and target must differ");
assert.ok(expectedPlatforms.length > 0, "expected prebuild platform list must not be empty");

function assertDirectory(path, description) {
  assert.ok(existsSync(path), `${description} must exist: ${path}`);
  assert.ok(statSync(path).isDirectory(), `${description} must be a directory: ${path}`);
}

function listDirectories(path) {
  assertDirectory(path, "directory");
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function hasNodeAddon(path) {
  assertDirectory(path, "prebuild platform directory");
  return readdirSync(path, { recursive: true, withFileTypes: true }).some((entry) => {
    return entry.isFile() && entry.name.endsWith(".node");
  });
}

assertDirectory(sourceRoot, "release artifact directory");

const artifactDirs = listDirectories(sourceRoot).filter((name) => name.startsWith("prebuilds-"));
assert.ok(
  artifactDirs.length > 0,
  `release artifact directory must contain prebuilds-* directories: ${sourceRoot}`,
);

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });

const copiedPlatforms = new Set();
for (const artifactDir of artifactDirs) {
  const artifactPath = join(sourceRoot, artifactDir);
  for (const platformDir of listDirectories(artifactPath)) {
    const source = join(artifactPath, platformDir);
    const target = join(targetRoot, platformDir);
    assert.ok(hasNodeAddon(source), `artifact platform directory has no .node addon: ${source}`);
    assert.ok(!copiedPlatforms.has(platformDir), `duplicate prebuild platform: ${platformDir}`);
    cpSync(source, target, { recursive: true, errorOnExist: true });
    copiedPlatforms.add(platformDir);
  }
}

for (const platform of expectedPlatforms) {
  assert.ok(copiedPlatforms.has(platform), `missing expected prebuild platform: ${platform}`);
}

for (const platform of [...copiedPlatforms].sort()) {
  const platformPath = join(targetRoot, platform);
  assert.ok(hasNodeAddon(platformPath), `assembled platform directory has no .node addon: ${platformPath}`);
}

console.log(
  JSON.stringify(
    {
      sourceRoot,
      targetRoot,
      platforms: [...copiedPlatforms].sort(),
    },
    null,
    2,
  ),
);
