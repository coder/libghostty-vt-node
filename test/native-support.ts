import { getNativeInfo } from "../src/index.js";

export interface NativeSupport {
  available: boolean;
  error?: unknown;
}

let cached: NativeSupport | undefined;

export function nativeSupport(): NativeSupport {
  if (cached !== undefined) return cached;
  try {
    getNativeInfo();
    cached = { available: true };
  } catch (error) {
    cached = { available: false, error };
  }
  return cached;
}
