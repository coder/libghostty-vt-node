#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const explicitTag = process.env.NPM_PUBLISH_TAG?.trim();
const githubRefType = process.env.GITHUB_REF_TYPE;
const githubRefName = process.env.GITHUB_REF_NAME;
const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
const distTagPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;

function printTag(tag) {
  process.stdout.write(`${tag}\n`);
}

assert.equal(typeof version, "string", "package.json version must be a string");
const match = semverPattern.exec(version);
assert.notEqual(match, null, `package.json version must be valid semver: ${version}`);

if (githubRefType === "tag") {
  assert.equal(typeof githubRefName, "string", "GITHUB_REF_NAME must be set for tag releases");
  assert.equal(
    githubRefName,
    `v${version}`,
    `Git tag ${githubRefName} must match package.json version v${version}`,
  );
}

if (explicitTag) {
  assert.match(explicitTag, distTagPattern, `invalid npm dist-tag: ${explicitTag}`);
  printTag(explicitTag);
  process.exit(0);
}

const prerelease = match.groups?.prerelease;
if (prerelease === undefined) {
  printTag("latest");
  process.exit(0);
}

const [channel] = prerelease.split(".");
assert.match(channel, distTagPattern, `invalid prerelease channel for npm dist-tag: ${channel}`);
printTag(channel.toLowerCase());
