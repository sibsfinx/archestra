import { and, asc, desc, eq } from "drizzle-orm";
import db, { schema, type Transaction } from "@/database";
import AgentTeamModel from "@/models/agent-team";
import type {
  InsertMemory,
  Memory,
  MemoryTier,
  MemoryVisibility,
  UpdateMemory,
} from "@/types/memory";
import {
  buildAgentAwareMemoryReadCondition,
  buildMemoryReadScopeCondition,
  intersectReadableTeamIds,
  isVisibilityAllowedForLevel,
  loadAgentMemoryConfig,
  resolveAgentMemoryTargetMode,
  resolveMemoryAccessLevel,
} from "./memory-scope-access";
import {
  MEMORY_INJECTION_TOTAL_CAP,
  mergeCoreMemoriesForInjection,
} from "./memory-injection";

class MemoryModel {
  static async listReadable(params: {
    organizationId: string;
    userId: string;
    teamIds: string[];
    includeAllTeams?: boolean;
    tier?: MemoryTier;
    visibility?: MemoryVisibility;
    accessLevel?: Awaited<ReturnType<typeof resolveMemoryAccessLevel>>;
  }): Promise<Memory[]> {
    const accessLevel =
      params.accessLevel ??
      (await resolveMemoryAccessLevel(params.userId, params.organizationId));

    if (
      params.visibility &&
      !isVisibilityAllowedForLevel(accessLevel, params.visibility)
    ) {
      return [];
    }

    const scopeCondition = buildMemoryReadScopeCondition({
      organizationId: params.organizationId,
      userId: params.userId,
      teamIds: params.teamIds,
      accessLevel,
      includeAllTeams: params.includeAllTeams,
    });

    if (!scopeCondition) {
      return [];
    }

    const conditions = [scopeCondition];

    if (params.tier) {
      conditions.push(eq(schema.memoriesTable.tier, params.tier));
    }
    if (params.visibility) {
      conditions.push(eq(schema.memoriesTable.visibility, params.visibility));
    }

    return db
      .select()
      .from(schema.memoriesTable)
      .where(and(...conditions))
      .orderBy(desc(schema.memoriesTable.createdAt));
  }

  static async listCoreForInjection(params: {
    organizationId: string;
    userId: string;
    teamIds: string[];
    agentId: string;
    accessLevel?: Awaited<ReturnType<typeof resolveMemoryAccessLevel>>;
  }): Promise<Memory[]> {
    const accessLevel =
      params.accessLevel ??
      (await resolveMemoryAccessLevel(params.userId, params.organizationId));

    const agentConfig = await loadAgentMemoryConfig(params.agentId);
    if (!agentConfig || agentConfig.organizationId !== params.organizationId) {
      return [];
    }

    const memoryTargetMode = resolveAgentMemoryTargetMode(agentConfig);
    const agentTeamIds = await AgentTeamModel.getTeamsForAgent(params.agentId);
    const readableAgentTeamIds = intersectReadableTeamIds(
      agentTeamIds,
      params.teamIds,
    );

    const coreTier = eq(schema.memoriesTable.tier, "core");
    const fetchLimit = MEMORY_INJECTION_TOTAL_CAP;

    const includePersonal = isVisibilityAllowedForLevel(
      accessLevel,
      "personal",
    );
    const includeOrg =
      memoryTargetMode === "org" &&
      isVisibilityAllowedForLevel(accessLevel, "org");
    const includeTeam =
      memoryTargetMode === "team" &&
      isVisibilityAllowedForLevel(accessLevel, "team") &&
      readableAgentTeamIds.length > 0;

    const [personalRows, orgRows, teamBucketRows] = await Promise.all([
      includePersonal
        ? db
            .select()
            .from(schema.memoriesTable)
            .where(
              and(
                eq(schema.memoriesTable.organizationId, params.organizationId),
                eq(schema.memoriesTable.visibility, "personal"),
                eq(schema.memoriesTable.userId, params.userId),
                coreTier,
              ),
            )
            .orderBy(
              desc(schema.memoriesTable.createdAt),
              asc(schema.memoriesTable.id),
            )
            .limit(fetchLimit)
        : Promise.resolve([] as Memory[]),
      includeOrg
        ? db
            .select()
            .from(schema.memoriesTable)
            .where(
              and(
                eq(schema.memoriesTable.organizationId, params.organizationId),
                eq(schema.memoriesTable.visibility, "org"),
                coreTier,
              ),
            )
            .orderBy(
              desc(schema.memoriesTable.createdAt),
              asc(schema.memoriesTable.id),
            )
            .limit(fetchLimit)
        : Promise.resolve([] as Memory[]),
      includeTeam
        ? Promise.all(
            readableAgentTeamIds.map((teamId) =>
              db
                .select()
                .from(schema.memoriesTable)
                .where(
                  and(
                    eq(
                      schema.memoriesTable.organizationId,
                      params.organizationId,
                    ),
                    eq(schema.memoriesTable.visibility, "team"),
                    eq(schema.memoriesTable.teamId, teamId),
                    coreTier,
                  ),
                )
                .orderBy(
                  desc(schema.memoriesTable.createdAt),
                  asc(schema.memoriesTable.id),
                )
                .limit(fetchLimit),
            ),
          )
        : Promise.resolve([] as Memory[][]),
    ]);

    return mergeCoreMemoriesForInjection([
      personalRows,
      orgRows,
      ...teamBucketRows,
    ]);
  }

  static async listReadableForAgentContext(params: {
    organizationId: string;
    userId: string;
    teamIds: string[];
    agentId: string;
    tier?: MemoryTier;
    visibility?: MemoryVisibility;
    accessLevel?: Awaited<ReturnType<typeof resolveMemoryAccessLevel>>;
  }): Promise<Memory[]> {
    const accessLevel =
      params.accessLevel ??
      (await resolveMemoryAccessLevel(params.userId, params.organizationId));

    if (
      params.visibility &&
      !isVisibilityAllowedForLevel(accessLevel, params.visibility)
    ) {
      return [];
    }

    const agentConfig = await loadAgentMemoryConfig(params.agentId);
    if (!agentConfig || agentConfig.organizationId !== params.organizationId) {
      return [];
    }

    const memoryTargetMode = resolveAgentMemoryTargetMode(agentConfig);
    const agentTeamIds = await AgentTeamModel.getTeamsForAgent(params.agentId);
    const scopeCondition = buildAgentAwareMemoryReadCondition({
      organizationId: params.organizationId,
      userId: params.userId,
      userTeamIds: params.teamIds,
      agentTeamIds,
      accessLevel,
      memoryTargetMode,
    });

    if (!scopeCondition) {
      return [];
    }

    const conditions = [scopeCondition];
    if (params.tier) {
      conditions.push(eq(schema.memoriesTable.tier, params.tier));
    }
    if (params.visibility) {
      conditions.push(eq(schema.memoriesTable.visibility, params.visibility));
    }

    return db
      .select()
      .from(schema.memoriesTable)
      .where(and(...conditions))
      .orderBy(desc(schema.memoriesTable.createdAt));
  }

  static async create(
    data: InsertMemory,
    tx?: Transaction,
  ): Promise<Memory | null> {
    const dbOrTx = tx ?? db;
    const [row] = await dbOrTx
      .insert(schema.memoriesTable)
      .values(data)
      .returning();
    return row ?? null;
  }

  static async update(id: string, data: UpdateMemory): Promise<Memory | null> {
    const [row] = await db
      .update(schema.memoriesTable)
      .set(data)
      .where(eq(schema.memoriesTable.id, id))
      .returning();
    return row ?? null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, id))
      .returning({ id: schema.memoriesTable.id });
    return result.length > 0;
  }

  static async getById(id: string): Promise<Memory | null> {
    const [row] = await db
      .select()
      .from(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, id))
      .limit(1);
    return row ?? null;
  }
}

export default MemoryModel;
