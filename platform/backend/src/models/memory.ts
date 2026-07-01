import { and, desc, eq, inArray, or } from "drizzle-orm";
import db, { schema, type Transaction } from "@/database";
import type {
  InsertMemory,
  Memory,
  MemoryTier,
  MemoryVisibility,
  UpdateMemory,
} from "@/types/memory";

function buildReadScopeCondition(params: {
  organizationId: string;
  userId: string;
  teamIds: string[];
  includeAllTeams?: boolean;
}) {
  const visibilityConditions = [
    and(
      eq(schema.memoriesTable.visibility, "personal"),
      eq(schema.memoriesTable.userId, params.userId),
    ),
    eq(schema.memoriesTable.visibility, "org"),
  ];

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

  const scopeOr = or(...visibilityConditions);
  return and(
    eq(schema.memoriesTable.organizationId, params.organizationId),
    scopeOr,
  );
}

class MemoryModel {
  static async listReadable(params: {
    organizationId: string;
    userId: string;
    teamIds: string[];
    includeAllTeams?: boolean;
    tier?: MemoryTier;
    visibility?: MemoryVisibility;
  }): Promise<Memory[]> {
    const conditions = [
      buildReadScopeCondition({
        organizationId: params.organizationId,
        userId: params.userId,
        teamIds: params.teamIds,
        includeAllTeams: params.includeAllTeams,
      }),
    ];

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
    limit: number;
  }): Promise<Memory[]> {
    return db
      .select()
      .from(schema.memoriesTable)
      .where(
        and(
          buildReadScopeCondition({
            organizationId: params.organizationId,
            userId: params.userId,
            teamIds: params.teamIds,
          }),
          eq(schema.memoriesTable.tier, "core"),
        ),
      )
      .orderBy(desc(schema.memoriesTable.createdAt))
      .limit(params.limit);
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
