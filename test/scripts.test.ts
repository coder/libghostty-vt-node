import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Each test copies one release script into a temporary package root and runs
// it there, so the script resolves package.json, prebuilds/ and dist/ against
// that root. Nothing touches the network or this checkout.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(script: string, version: string): string {
  // realpath: on macOS tmpdir() is a symlink, and Node realpaths the script it runs.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ghostty-vt-scripts-")));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  cpSync(join(repoRoot, "scripts", script), join(root, "scripts", script));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version }));
  return root;
}

// Git must not read the user's or the runner's configuration.
const gitEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};

// The parent's environment must not steer the scripts or git in the fixtures.
function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ["PREBUILDS_ONLY", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return env;
}

function run(root: string, script: string, args: string[] = [], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...baseEnv(),
      GITHUB_REF_TYPE: "",
      GITHUB_REF_NAME: "",
      NPM_PUBLISH_TAG: "",
      RELEASE_BRANCH_NAME: "",
      RELEASE_TARGET_SHA: "",
      ...gitEnv,
      ...env,
    },
  });
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...baseEnv(), ...gitEnv } });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe("semver checks in the release scripts", () => {
  // SemVer 2.0.0 forbids leading zeros in numeric prerelease identifiers and
  // empty identifiers.
  const invalid = ["1.0.0-01", "1.0.0-alpha.01", "1.0.0-alpha.", "1.0.0+foo..bar", "1.0.0-", "01.0.0"];

  it.each(invalid)("create-release-tag rejects %s", (version) => {
    const root = makeRoot("create-release-tag.mjs", version);
    const result = run(root, "create-release-tag.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`package.json version must be semver: ${version}`);
  });

  it.each(invalid)("resolve-npm-publish-tag rejects %s", (version) => {
    const root = makeRoot("resolve-npm-publish-tag.mjs", version);
    const result = run(root, "resolve-npm-publish-tag.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`package.json version must be valid semver: ${version}`);
  });

  it.each([
    ["1.0.0", "latest"],
    ["0.1.0-beta.1", "beta"],
    ["1.0.0-alpha.0", "alpha"],
    ["1.0.0-RC.1+build.5", "rc"],
    ["1.0.0+20261029", "latest"],
  ])("resolve-npm-publish-tag maps %s to %s", (version, tag) => {
    const root = makeRoot("resolve-npm-publish-tag.mjs", version);
    const result = run(root, "resolve-npm-publish-tag.mjs");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${tag}\n`);
  });
});

describe("create-release-tag.mjs", () => {
  function makeRepo(origin: string): { root: string; sha: string } {
    const root = makeRoot("create-release-tag.mjs", "1.2.3");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture");
    git(root, "remote", "add", "origin", origin);
    return { root, sha: git(root, "rev-parse", "HEAD") };
  }

  it("fails without tagging when git ls-remote fails", () => {
    const parent = mkdtempSync(join(tmpdir(), "ghostty-vt-no-origin-"));
    roots.push(parent);
    const { root } = makeRepo(join(parent, "missing"));
    const result = run(root, "create-release-tag.mjs");
    expect(result.status).not.toBe(0);
    expect(git(root, "tag", "--list", "v1.2.3")).toBe("");
  });

  it("pushes a new tag, then reports an existing tag at the same commit", () => {
    const origin = mkdtempSync(join(tmpdir(), "ghostty-vt-origin-"));
    roots.push(origin);
    git(origin, "init", "-q", "--bare");
    const { root, sha } = makeRepo(origin);

    const first = run(root, "create-release-tag.mjs");
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({ tagName: "v1.2.3", targetSha: sha, created: true });
    expect(git(root, "ls-remote", "--tags", "origin", "refs/tags/v1.2.3")).toBe(`${sha}\trefs/tags/v1.2.3`);

    const second = run(root, "create-release-tag.mjs");
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({ tagName: "v1.2.3", targetSha: sha, created: false });
  });
});

describe("assemble-prebuilds.mjs", () => {
  function makeArtifacts(): string {
    const root = makeRoot("assemble-prebuilds.mjs", "1.2.3");
    mkdirSync(join(root, ".release-artifacts", "prebuilds-linux-x64", "linux-x64"), { recursive: true });
    writeFileSync(join(root, ".release-artifacts", "prebuilds-linux-x64", "linux-x64", "addon.node"), "");
    mkdirSync(join(root, "prebuilds"));
    writeFileSync(join(root, "prebuilds", "previous.txt"), "kept until a run succeeds");
    return root;
  }

  it("leaves the existing prebuilds/ untouched when a check fails", () => {
    const root = makeArtifacts();
    const result = run(root, "assemble-prebuilds.mjs", [], { EXPECTED_PREBUILD_PLATFORMS: "linux-x64,darwin-arm64" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing expected prebuild platform: darwin-arm64");
    expect(readdirSync(join(root, "prebuilds"))).toEqual(["previous.txt"]);
    expect(readdirSync(root).sort()).toEqual([".release-artifacts", "package.json", "prebuilds", "scripts"]);
  });

  it("replaces prebuilds/ when every check passes", () => {
    const root = makeArtifacts();
    const result = run(root, "assemble-prebuilds.mjs", [], { EXPECTED_PREBUILD_PLATFORMS: "linux-x64" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).platforms).toEqual(["linux-x64"]);
    expect(readdirSync(join(root, "prebuilds"))).toEqual(["linux-x64"]);
    expect(existsSync(join(root, "prebuilds", "linux-x64", "addon.node"))).toBe(true);
    expect(readdirSync(root).sort()).toEqual([".release-artifacts", "package.json", "prebuilds", "scripts"]);
  });
});

describe("verify-prebuilds.mjs", () => {
  const platform = `${process.platform}-${process.arch}`;

  // The stub stands in for the built dist/index.js. Like src/loader.ts, it
  // asks node-gyp-build for the addon under the package root, but it only
  // resolves the path, because the fixture .node files are empty.
  function makePackage(): string {
    const root = makeRoot("verify-prebuilds.mjs", "1.2.3");
    cpSync(join(repoRoot, "node_modules", "node-gyp-build"), join(root, "node_modules", "node-gyp-build"), { recursive: true });
    mkdirSync(join(root, "dist"));
    writeFileSync(
      join(root, "dist", "index.js"),
      [
        'import { createRequire } from "node:module";',
        'import { fileURLToPath } from "node:url";',
        "const require = createRequire(import.meta.url);",
        'const root = fileURLToPath(new URL("..", import.meta.url));',
        'export function getNativeInfo() { return { addon: require("node-gyp-build").resolve(root) }; }',
      ].join("\n"),
    );
    mkdirSync(join(root, "build", "Release"), { recursive: true });
    writeFileSync(join(root, "build", "Release", "ghostty_vt_node.node"), "");
    return root;
  }

  it("names the build:prebuild script when prebuilds/ is missing", () => {
    const root = makePackage();
    const result = run(root, "verify-prebuilds.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No prebuilds directory found. Run npm run build:prebuild first.");
  });

  it("fails when only build/Release has an addon for this platform", () => {
    const root = makePackage();
    mkdirSync(join(root, "prebuilds", "other-platform"), { recursive: true });
    writeFileSync(join(root, "prebuilds", "other-platform", "node.napi.node"), "");
    const result = run(root, "verify-prebuilds.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No native build was found");
  });

  it("reports the prebuild it loaded for this platform", () => {
    const root = makePackage();
    mkdirSync(join(root, "prebuilds", platform), { recursive: true });
    writeFileSync(join(root, "prebuilds", platform, "node.napi.node"), "");
    const result = run(root, "verify-prebuilds.mjs");
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.platforms).toEqual([platform]);
    expect(output.addon).toBe(join(root, "prebuilds", platform, "node.napi.node"));
  });
});
