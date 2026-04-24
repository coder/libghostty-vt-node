import { describe, expect, it } from "vitest";
import { getNativeInfo } from "../src/index.js";
import { nativeSupport } from "./native-support.js";

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
});
