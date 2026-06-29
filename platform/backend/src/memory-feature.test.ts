import config from "@/config";
import {
  assertMemoryGloballyEnabled,
  isMemoryGloballyEnabled,
} from "@/memory-feature";
import { describe, expect, test } from "@/test";
import { ApiError } from "@/types";

describe("memory feature config", () => {
  const originalEnabled = config.memory.enabled;

  test("isMemoryGloballyEnabled reflects config.memory.enabled", () => {
    (config.memory as { enabled: boolean }).enabled = true;
    expect(isMemoryGloballyEnabled()).toBe(true);

    (config.memory as { enabled: boolean }).enabled = false;
    expect(isMemoryGloballyEnabled()).toBe(false);

    (config.memory as { enabled: boolean }).enabled = originalEnabled;
  });

  test("assertMemoryGloballyEnabled throws 404 when disabled", () => {
    (config.memory as { enabled: boolean }).enabled = false;
    expect(() => assertMemoryGloballyEnabled()).toThrow(ApiError);
    try {
      assertMemoryGloballyEnabled();
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404 });
    }
    (config.memory as { enabled: boolean }).enabled = originalEnabled;
  });
});
