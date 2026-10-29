#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseBranchName = process.env.RELEASE_BRANCH_NAME;
const releaseTargetSha = process.env.RELEASE_TARGET_SHA;
// SemVer 2.0.0 (semver.org): no leading zeros in numeric identifiers, no empty identifiers.
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function git(args) {
  assert.ok(Array.isArray(args), "git args must be an array");
  assert.ok(args.every((arg) => typeof arg === "string"), "git args must be strings");
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

assert.equal(typeof version, "string", "package.json version must be a string");
assert.match(version, semverPattern, `package.json version must be semver: ${version}`);

const tagName = `v${version}`;

if (releaseBranchName !== undefined && releaseBranchName !== "") {
  assert.equal(
    releaseBranchName,
    `release/${tagName}`,
    `release branch ${releaseBranchName} must match package version ${tagName}`,
  );
}

const targetSha = releaseTargetSha?.trim() || git(["rev-parse", "HEAD"]);
assert.match(targetSha, /^[0-9a-f]{40}$/i, `release target SHA must be a full commit SHA: ${targetSha}`);

const currentHead = git(["rev-parse", "HEAD"]);
assert.equal(currentHead, targetSha, "checked-out HEAD must match the release target SHA");

// Empty output means the tag is absent. A failed ls-remote (network, auth) throws and stops
// the release before it tags, instead of counting as "absent".
const remoteTagSha = git(["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]);
if (remoteTagSha) {
  const [existingSha, existingRef] = remoteTagSha.split(/\s+/, 2);
  assert.equal(existingRef, `refs/tags/${tagName}`, `unexpected remote tag ref for ${tagName}`);
  assert.equal(existingSha, targetSha, `remote tag ${tagName} already exists at ${existingSha}, not ${targetSha}`);
  console.log(JSON.stringify({ tagName, targetSha, created: false }, null, 2));
  process.exit(0);
}

git(["tag", tagName, targetSha]);
git(["push", "origin", `refs/tags/${tagName}`]);
console.log(JSON.stringify({ tagName, targetSha, created: true }, null, 2));
