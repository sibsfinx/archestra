import { describe, expect, test } from "@/test";
import type { Memory } from "@/types/memory";
import {
  MEMORY_INJECTION_TOTAL_CAP,
  mergeCoreMemoriesForInjection,
} from "./memory-injection";

function makeMemory(overrides: {
  id: string;
  content: string;
  createdAt: Date;
}): Memory {
  return {
    id: overrides.id,
    organizationId: "org-1",
    tier: "core",
    visibility: "personal",
    userId: "user-1",
    teamId: null,
    content: overrides.content,
    createdBy: "user-1",
    taintedAtWrite: false,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  };
}

describe("mergeCoreMemoriesForInjection", () => {
  test("includes at least one memory from each non-empty bucket", () => {
    const personal = makeMemory({
      id: "p1",
      content: "personal-fact",
      createdAt: new Date("2020-01-01"),
    });
    const org = makeMemory({
      id: "o1",
      content: "org-fact",
      createdAt: new Date("2026-01-01"),
    });

    const merged = mergeCoreMemoriesForInjection([[personal], [org], []]);
    expect(merged.map((m) => m.content)).toEqual(
      expect.arrayContaining(["personal-fact", "org-fact"]),
    );
  });

  test("caps total results at MEMORY_INJECTION_TOTAL_CAP", () => {
    const buckets = Array.from({ length: 60 }, (_, index) => [
      makeMemory({
        id: `id-${index}`,
        content: `fact-${index}`,
        createdAt: new Date(2026, 0, index + 1),
      }),
    ]);

    expect(mergeCoreMemoriesForInjection(buckets)).toHaveLength(
      MEMORY_INJECTION_TOTAL_CAP,
    );
  });
});
