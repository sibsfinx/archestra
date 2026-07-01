import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "@/lib/memory.query";
import {
  browseMemories,
  countCoreMemoriesInScope,
  filterMemoriesBySearch,
  filterMemoriesByTeam,
  filterMemoriesByTier,
} from "./memory-page-utils";

function makeMemory(
  overrides: Partial<MemoryEntry> & { id: string },
): MemoryEntry {
  return {
    organizationId: "org-1",
    tier: "core",
    visibility: "team",
    userId: null,
    teamId: "team-a",
    content: "fact",
    createdBy: "user-1",
    taintedAtWrite: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("memory-page-utils", () => {
  const memories = [
    makeMemory({
      id: "1",
      teamId: "team-a",
      content: "alpha core",
      tier: "core",
    }),
    makeMemory({
      id: "2",
      teamId: "team-a",
      content: "beta archival",
      tier: "archival",
    }),
    makeMemory({
      id: "3",
      teamId: "team-b",
      content: "other team",
      tier: "core",
    }),
  ];

  it("filters by team before tier and search", () => {
    const result = browseMemories({
      memories,
      teamId: "team-a",
      tierFilter: "core",
      searchTerm: "alpha",
      page: 1,
    });

    expect(result.pageItems.map((memory) => memory.id)).toEqual(["1"]);
    expect(result.coreCount).toBe(1);
  });

  it("counts core memories in the selected team scope", () => {
    const teamScoped = filterMemoriesByTeam(memories, "team-a");
    expect(countCoreMemoriesInScope(teamScoped)).toBe(1);
  });

  it("filters archival tier only", () => {
    const filtered = filterMemoriesByTier(memories, "archival");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.content).toBe("beta archival");
  });

  it("searches case-insensitively", () => {
    const filtered = filterMemoriesBySearch(memories, "ALPHA");
    expect(filtered).toHaveLength(1);
  });
});
