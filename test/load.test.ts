import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getNativeInfo } from "../src/index.js";
import { nativeSupport } from "./native-support.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prefix = resolve(
  process.env.LIBGHOSTTY_VT_PREFIX ?? join(repoRoot, "vendor", "libghostty-vt"),
);
const ghosttySourcePath = join(prefix, "ghostty-source.json");

describe("native loader", () => {
  it("reports useful native metadata or a clear setup error", () => {
    const support = nativeSupport();
    if (!support.available) {
      expect(String((support.error as Error).message)).toContain(
        "Failed to load @coder/libghostty-vt-node native addon",
      );
      return;
    }

    const info = getNativeInfo();
    expect(info.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.napiVersion).toBeGreaterThan(0);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });

  it.skipIf(!nativeSupport().available || !existsSync(ghosttySourcePath))(
    "reports the Ghostty commit that libghostty-vt was built from",
    () => {
      const { commit } = JSON.parse(readFileSync(ghosttySourcePath, "utf8")) as {
        commit: string;
      };
      const info = getNativeInfo();
      expect(
        info.ghosttyCommit,
        `ghosttyCommit differs from ${ghosttySourcePath}. Rerun npm run build:libghostty && npm run build:native`,
      ).toBe(commit);
      expect(info.ghosttyVersion).toMatch(new RegExp(`\\+${commit}$`));
    },
  );
});
