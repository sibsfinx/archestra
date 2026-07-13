import { describe, expect, test } from "@/test";
import {
  allowedVisibilitiesForLevel,
  buildAgentAwareMemoryReadCondition,
  buildAgentTargetedSharedReadCondition,
  buildCallerPersonalReadCondition,
  buildMemoryReadScopeCondition,
  intersectReadableTeamIds,
  isVisibilityAllowedForLevel,
  resolveAgentMemoryTargetMode,
} from "./memory-scope-access";

describe("memory-scope-access", () => {
  test("allowedVisibilitiesForLevel maps access levels to visibility scopes", () => {
    expect(allowedVisibilitiesForLevel("personal")).toEqual(["personal"]);
    expect(allowedVisibilitiesForLevel("team")).toEqual(["personal", "team"]);
    expect(allowedVisibilitiesForLevel("organization")).toEqual([
      "personal",
      "team",
      "org",
    ]);
  });

  test("isVisibilityAllowedForLevel enforces level gates", () => {
    expect(isVisibilityAllowedForLevel("personal", "personal")).toBe(true);
    expect(isVisibilityAllowedForLevel("personal", "team")).toBe(false);
    expect(isVisibilityAllowedForLevel("personal", "org")).toBe(false);

    expect(isVisibilityAllowedForLevel("team", "team")).toBe(true);
    expect(isVisibilityAllowedForLevel("team", "org")).toBe(false);

    expect(isVisibilityAllowedForLevel("organization", "org")).toBe(true);
  });

  test("resolveAgentMemoryTargetMode falls back to agent scope", () => {
    expect(
      resolveAgentMemoryTargetMode({
        memoryTargetMode: null,
        scope: "org",
      }),
    ).toBe("org");
    expect(
      resolveAgentMemoryTargetMode({
        memoryTargetMode: "team",
        scope: "org",
      }),
    ).toBe("team");
  });

  test("intersectReadableTeamIds keeps only teams the user belongs to", () => {
    expect(
      intersectReadableTeamIds(["team-a", "team-b"], ["team-b", "team-c"]),
    ).toEqual(["team-b"]);
  });

  test("buildMemoryReadScopeCondition returns undefined when no visibilities apply", () => {
    expect(
      buildMemoryReadScopeCondition({
        organizationId: "org-1",
        userId: "user-1",
        teamIds: [],
        accessLevel: "personal",
        includeAllTeams: true,
      }),
    ).toBeDefined();

    expect(
      buildMemoryReadScopeCondition({
        organizationId: "org-1",
        userId: "user-1",
        teamIds: [],
        accessLevel: "team",
      }),
    ).toBeDefined();
  });

  test("buildCallerPersonalReadCondition is blocked for personal access level only on shared scopes", () => {
    expect(
      buildCallerPersonalReadCondition({
        organizationId: "org-1",
        userId: "user-1",
        accessLevel: "personal",
      }),
    ).toBeDefined();

    expect(
      buildAgentTargetedSharedReadCondition({
        organizationId: "org-1",
        userTeamIds: ["team-1"],
        agentTeamIds: ["team-1"],
        accessLevel: "personal",
        memoryTargetMode: "org",
      }),
    ).toBeUndefined();
  });

  test("buildAgentTargetedSharedReadCondition intersects agent teams with user teams", () => {
    expect(
      buildAgentTargetedSharedReadCondition({
        organizationId: "org-1",
        userTeamIds: ["team-a"],
        agentTeamIds: ["team-a", "team-b"],
        accessLevel: "organization",
        memoryTargetMode: "team",
      }),
    ).toBeDefined();

    expect(
      buildAgentTargetedSharedReadCondition({
        organizationId: "org-1",
        userTeamIds: ["team-a"],
        agentTeamIds: ["team-b"],
        accessLevel: "organization",
        memoryTargetMode: "team",
      }),
    ).toBeUndefined();
  });

  test("buildAgentAwareMemoryReadCondition combines personal and agent-targeted shared reads", () => {
    expect(
      buildAgentAwareMemoryReadCondition({
        organizationId: "org-1",
        userId: "user-1",
        userTeamIds: [],
        agentTeamIds: [],
        accessLevel: "organization",
        memoryTargetMode: "org",
      }),
    ).toBeDefined();

    expect(
      buildAgentAwareMemoryReadCondition({
        organizationId: "org-1",
        userId: "user-1",
        userTeamIds: ["team-a"],
        agentTeamIds: ["team-b"],
        accessLevel: "organization",
        memoryTargetMode: "team",
      }),
    ).toBeDefined();
  });
});
