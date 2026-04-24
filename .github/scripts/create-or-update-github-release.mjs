#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [tagName, communiqueNotesPath] = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY?.trim();
const githubSha = process.env.GITHUB_SHA?.trim();
const npmDistTag = process.env.NPM_DIST_TAG?.trim();
const githubToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
const distTagPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;

assert.ok(tagName, "tag name argument is required");
assert.ok(communiqueNotesPath, "Communique notes path argument is required");
assert.ok(repository, "GITHUB_REPOSITORY must be set");
assert.ok(githubSha, "GITHUB_SHA must be set");
assert.match(githubSha, /^[0-9a-f]{40}$/i, `GITHUB_SHA must be a full commit SHA: ${githubSha}`);
assert.ok(githubToken, "GH_TOKEN or GITHUB_TOKEN must be set");
assert.ok(npmDistTag, "NPM_DIST_TAG must be set");
assert.match(npmDistTag, distTagPattern, `invalid npm dist-tag: ${npmDistTag}`);

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(typeof packageJson.name, "string", "package.json name must be a string");
assert.equal(typeof packageJson.version, "string", "package.json version must be a string");
assert.equal(typeof packageJson.engines?.node, "string", "package.json engines.node must be a string");
const versionMatch = semverPattern.exec(packageJson.version);
assert.notEqual(versionMatch, null, `package.json version must be semver: ${packageJson.version}`);
assert.equal(tagName, `v${packageJson.version}`, `release tag ${tagName} must match package version`);

function parseCommuniqueNotes(path) {
  const raw = readFileSync(path, "utf8").trim();
  assert.ok(raw.length > 0, "Communique notes file must not be empty");
  const [firstLine, ...bodyLines] = raw.split(/\r?\n/);
  assert.ok(firstLine.startsWith("# "), "Communique notes must start with a level-one title");
  const title = firstLine.slice(2).trim();
  const body = bodyLines.join("\n").trim();
  assert.ok(title.length > 0, "release title must not be empty");
  assert.ok(!title.includes("\n") && !title.includes("\r"), "release title must be one line");
  assert.ok(
    title.startsWith(`${tagName}: `),
    `release title must start with '${tagName}: ' after Communique normalization`,
  );
  assert.ok(body.length > 0, "release body must not be empty");
  return { title, body };
}

function stripAppendedInstallNotes(body) {
  const lines = body.trim().split(/\r?\n/);
  const firstGeneratedSection = lines.findIndex((line) => {
    const heading = line.trim();
    return heading === "## Installation" || heading === "## Platform Support";
  });
  if (firstGeneratedSection === -1) {
    return body.trim();
  }
  return lines.slice(0, firstGeneratedSection).join("\n").trim();
}

function appendInstallNotes(body) {
  const installTarget = `${packageJson.name}@${packageJson.version}`;
  return `${stripAppendedInstallNotes(body)}

## Installation

\`\`\`sh
npm install ${installTarget}
\`\`\`

This release was published to npm as \`${installTarget}\` with the \`${npmDistTag}\` dist-tag.

## Platform Support

The npm package includes Node-API prebuilds for linux-x64, linux-arm64, macos-arm64, and macos-x64. Node.js ${packageJson.engines.node} is required. Native binaries are distributed through npm; this GitHub Release does not attach separate binary assets.`;
}

function gh(args, options = {}) {
  assert.ok(Array.isArray(args), "gh args must be an array");
  assert.ok(args.every((arg) => typeof arg === "string"), "gh args must be strings");
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GH_TOKEN: githubToken,
    },
    stdio: ["ignore", "pipe", options.allowFailure ? "pipe" : "inherit"],
  }).trim();
}

function ghSucceeds(args) {
  try {
    gh(args, { allowFailure: true });
    return true;
  } catch {
    return false;
  }
}

const { title, body } = parseCommuniqueNotes(communiqueNotesPath);
const finalBody = appendInstallNotes(body);
const finalNotesPath = join(mkdtempSync(join(tmpdir(), "libghostty-vt-release-")), "notes.md");
writeFileSync(finalNotesPath, `${finalBody.trimEnd()}\n`);

const prerelease = versionMatch.groups?.prerelease !== undefined;
const releaseExists = ghSucceeds(["release", "view", tagName, "--repo", repository]);

if (releaseExists) {
  const args = [
    "release",
    "edit",
    tagName,
    "--repo",
    repository,
    "--title",
    title,
    "--notes-file",
    finalNotesPath,
    "--verify-tag",
  ];
  if (prerelease) {
    args.push("--prerelease");
  } else {
    args.push("--latest");
  }
  gh(args);
  console.log(JSON.stringify({ tagName, title, updated: true }, null, 2));
} else {
  const args = [
    "release",
    "create",
    tagName,
    "--repo",
    repository,
    "--title",
    title,
    "--notes-file",
    finalNotesPath,
    "--target",
    githubSha,
    "--verify-tag",
  ];
  if (prerelease) {
    args.push("--prerelease", "--latest=false");
  }
  gh(args);
  console.log(JSON.stringify({ tagName, title, created: true }, null, 2));
}
