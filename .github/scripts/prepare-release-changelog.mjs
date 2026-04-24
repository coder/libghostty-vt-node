#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [baseRefArg] = process.argv.slice(2);
const baseRef = baseRefArg?.trim();
const releaseBranchName = process.env.RELEASE_BRANCH_NAME?.trim();
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/;

assert.ok(baseRef, "base git ref argument is required");

function git(args) {
  assert.ok(Array.isArray(args), "git args must be an array");
  assert.ok(args.every((arg) => typeof arg === "string"), "git args must be strings");
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function parsePackageJson(contents, description) {
  assert.equal(typeof contents, "string", `${description} package.json contents must be a string`);
  const parsed = JSON.parse(contents);
  assert.equal(typeof parsed, "object", `${description} package.json must parse to an object`);
  assert.notEqual(parsed, null, `${description} package.json must not be null`);
  assert.equal(typeof parsed.version, "string", `${description} package.json version must be a string`);
  assert.match(parsed.version, semverPattern, `${description} package.json version must be semver`);
  return parsed;
}

function hasChangelogEntry(tagName) {
  const changelogPath = join(root, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    return false;
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const version = tagName.replace(/^v/, "");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entryPattern = new RegExp(String.raw`^##\s+(?:\[?(?:${escapedVersion}|${escapedTag})\]?)(?:\s|$)`, "m");
  return entryPattern.test(changelog);
}

function writeOutput(values) {
  for (const [key, value] of Object.entries(values)) {
    assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/, `invalid GitHub output key: ${key}`);
    const stringValue = String(value);
    if (process.env.GITHUB_OUTPUT) {
      execFileSync("sh", ["-c", "printf '%s=%s\\n' \"$1\" \"$2\" >> \"$GITHUB_OUTPUT\"", "sh", key, stringValue], {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
      });
    } else {
      console.log(`${key}=${stringValue}`);
    }
  }
}

const headPackage = parsePackageJson(readFileSync(join(root, "package.json"), "utf8"), "head");
const basePackage = parsePackageJson(git(["show", `${baseRef}:package.json`]), "base");
const tagName = `v${headPackage.version}`;

if (releaseBranchName) {
  assert.equal(
    releaseBranchName,
    `release/${tagName}`,
    `release branch ${releaseBranchName} must match package version ${tagName}`,
  );
}

let shouldGenerate = "true";
let reason = "version-changed";

if (headPackage.version === basePackage.version) {
  shouldGenerate = "false";
  reason = "no-version-change";
} else if (hasChangelogEntry(tagName)) {
  shouldGenerate = "false";
  reason = "changelog-entry-exists";
}

writeOutput({
  should_generate: shouldGenerate,
  reason,
  base_version: basePackage.version,
  package_version: headPackage.version,
  tag_name: tagName,
});

console.log(
  JSON.stringify(
    {
      baseVersion: basePackage.version,
      packageVersion: headPackage.version,
      tagName,
      shouldGenerate: shouldGenerate === "true",
      reason,
    },
    null,
    2,
  ),
);
