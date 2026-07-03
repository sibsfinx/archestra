import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import db, { schema } from "@/database";
import { notDeleted } from "@/database/schemas/soft-deletable-table";
import MemberModel from "@/models/member";
import type { AgentScope, MemoryTargetMode } from "@/types/agent";
import type { MemoryAccessLevel } from "@/types/member";
import type { MemoryVisibility } from "@/types/memory";

const DEFAULT_MEMORY_ACCESS_LEVEL: MemoryAccessLevel = "organization";

export type AgentMemoryConfig = {
  id: string;
  organizationId: string;
  scope: AgentScope;
  memoryTargetMode: MemoryTargetMode | null;
  sharedMemoryWriteEnabled: boolean;
};

export function allowedVisibilitiesForLevel(
  level: MemoryAccessLevel,
): MemoryVisibility[] {
  switch (level) {
    case "personal":
      return ["personal"];
    case "team":
      return ["personal", "team"];
    case "organization":
      return ["personal", "team", "org"];
  }
}

export function isVisibilityAllowedForLevel(
  level: MemoryAccessLevel,
  visibility: MemoryVisibility,
): boolean {
  return allowedVisibilitiesForLevel(level).includes(visibility);
}

export async function resolveMemoryAccessLevel(
  userId: string,
  organizationId: string,
): Promise<MemoryAccessLevel> {
  const member = await MemberModel.getByUserId(userId, organizationId);
  return member?.memoryAccessLevel ?? DEFAULT_MEMORY_ACCESS_LEVEL;
}

export function resolveAgentMemoryTargetMode(
  config: Pick<AgentMemoryConfig, "memoryTargetMode" | "scope">,
): MemoryTargetMode {
  return config.memoryTargetMode ?? config.scope;
}

export async function loadAgentMemoryConfig(
  agentId: string,
): Promise<AgentMemoryConfig | null> {
  const [agent] = await db
    .select({
      id: schema.agentsTable.id,
      organizationId: schema.agentsTable.organizationId,
      scope: schema.agentsTable.scope,
      memoryTargetMode: schema.agentsTable.memoryTargetMode,
      sharedMemoryWriteEnabled: schema.agentsTable.sharedMemoryWriteEnabled,
    })
    .from(schema.agentsTable)
    .where(and(eq(schema.agentsTable.id, agentId), notDeleted(schema.agentsTable)))
    .limit(1);

  return agent ?? null;
}

export function intersectReadableTeamIds(
  agentTeamIds: string[],
  userTeamIds: string[],
): string[] {
  const userTeamSet = new Set(userTeamIds);
  return agentTeamIds.filter((teamId) => userTeamSet.has(teamId));
}

export function buildMemoryReadScopeCondition(params: {
  organizationId: string;
  userId: string;
  teamIds: string[];
  accessLevel: MemoryAccessLevel;
  includeAllTeams?: boolean;
}): SQL | undefined {
  const allowed = new Set(allowedVisibilitiesForLevel(params.accessLevel));
  const visibilityConditions: (SQL | undefined)[] = [];

  if (allowed.has("personal")) {
    visibilityConditions.push(
      and(
        eq(schema.memoriesTable.visibility, "personal"),
        eq(schema.memoriesTable.userId, params.userId),
      ),
    );
  }

  if (allowed.has("org")) {
    visibilityConditions.push(eq(schema.memoriesTable.visibility, "org"));
  }

  if (allowed.has("team")) {
    if (params.includeAllTeams) {
      visibilityConditions.push(eq(schema.memoriesTable.visibility, "team"));
    } else if (params.teamIds.length > 0) {
      visibilityConditions.push(
        and(
          eq(schema.memoriesTable.visibility, "team"),
          inArray(schema.memoriesTable.teamId, params.teamIds),
        ),
      );
    }
  }

  if (visibilityConditions.length === 0) {
    return undefined;
  }

  const scopeOr = or(...visibilityConditions);
  return and(
    eq(schema.memoriesTable.organizationId, params.organizationId),
    scopeOr,
  );
}

export function buildCallerPersonalReadCondition(params: {
  organizationId: string;
  userId: string;
  accessLevel: MemoryAccessLevel;
}): SQL | undefined {
  if (!isVisibilityAllowedForLevel(params.accessLevel, "personal")) {
    return undefined;
  }

  return and(
    eq(schema.memoriesTable.organizationId, params.organizationId),
    eq(schema.memoriesTable.visibility, "personal"),
    eq(schema.memoriesTable.userId, params.userId),
  );
}

export function buildAgentTargetedSharedReadCondition(params: {
  organizationId: string;
  userTeamIds: string[];
  agentTeamIds: string[];
  accessLevel: MemoryAccessLevel;
  memoryTargetMode: MemoryTargetMode;
}): SQL | undefined {
  const allowed = allowedVisibilitiesForLevel(params.accessLevel);
  const sharedConditions: SQL[] = [];

  if (
    params.memoryTargetMode === "org" &&
    allowed.includes("org")
  ) {
    sharedConditions.push(eq(schema.memoriesTable.visibility, "org"));
  }

  if (params.memoryTargetMode === "team" && allowed.includes("team")) {
    const readableTeamIds = intersectReadableTeamIds(
      params.agentTeamIds,
      params.userTeamIds,
    );
    if (readableTeamIds.length > 0) {
      sharedConditions.push(
        and(
          eq(schema.memoriesTable.visibility, "team"),
          inArray(schema.memoriesTable.teamId, readableTeamIds),
        ),
      );
    }
  }

  if (sharedConditions.length === 0) {
    return undefined;
  }

  return and(
    eq(schema.memoriesTable.organizationId, params.organizationId),
    or(...sharedConditions),
  );
}

export function buildAgentAwareMemoryReadCondition(params: {
  organizationId: string;
  userId: string;
  userTeamIds: string[];
  agentTeamIds: string[];
  accessLevel: MemoryAccessLevel;
  memoryTargetMode: MemoryTargetMode;
}): SQL | undefined {
  const personal = buildCallerPersonalReadCondition({
    organizationId: params.organizationId,
    userId: params.userId,
    accessLevel: params.accessLevel,
  });
  const shared = buildAgentTargetedSharedReadCondition({
    organizationId: params.organizationId,
    userTeamIds: params.userTeamIds,
    agentTeamIds: params.agentTeamIds,
    accessLevel: params.accessLevel,
    memoryTargetMode: params.memoryTargetMode,
  });

  const parts = [personal, shared].filter(Boolean) as SQL[];
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return or(...parts);
}
