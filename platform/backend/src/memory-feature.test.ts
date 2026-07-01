import config from "@/config";
import { assertMemoryEnabledForOrganization } from "@/memory-feature";
import { afterEach, describe, expect, test } from "@/test";
import { ApiError } from "@/types";

describe("memory feature config", () => {
  const originalEnabled = config.memory.enabled;

  afterEach(() => {
    (config.memory as { enabled: boolean }).enabled = originalEnabled;
  });

  test("assertMemoryEnabledForOrganization throws 404 when globally disabled", async () => {
    (config.memory as { enabled: boolean }).enabled = false;
    await expect(
      assertMemoryEnabledForOrganization("organization-id"),
    ).rejects.toThrow(ApiError);
    try {
      await assertMemoryEnabledForOrganization("organization-id");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404 });
    }
  });
});
