import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Permission, TOOL_MEMORY_SHORT_NAME } from "@archestra/shared";
import { and, count, desc, eq, ilike, ne } from "drizzle-orm";
import { z } from "zod";
import config from "@/config";
import db, { schema, type Transaction } from "@/database";
import logger from "@/logging";
import {
  getMemoryPermissionChecker,
  requireMemoryModifyPermission,
} from "@/auth/memory-permissions";
import { MemoryModel, TeamModel } from "@/models";
import AgentTeamModel from "@/models/agent-team";
import {
  buildAgentAwareMemoryReadCondition,
  loadAgentMemoryConfig,
  resolveAgentMemoryTargetMode,
  resolveMemoryAccessLevel,
} from "@/models/memory-scope-access";
import OrganizationModel from "@/models/organization";
import type { Memory, MemoryVisibility } from "@/types";
import { isUniqueConstraintError } from "@/utils/db";
import {
  defineArchestraTool,
  defineArchestraTools,
  errorResult,
  structuredSuccessResult,
  successResult,
} from "./helpers";
import type { ArchestraContext } from "./types";

export const MAX_CONTENT_CHARS = 2000;
export const MAX_CORE_ITEMS_PER_SCOPE = 50;

const TAINTED_WRITE_MESSAGE =
  "This context is untrusted, so the memory was not saved. Ask the user to add it manually in Settings → Memory.";

export const DUPLICATE_CONTENT_MESSAGE =
  "Another memory already has this content.";

const MEMORY_WRITE_COMMAND_PERMISSION: Record<
  "create" | "update" | "delete",
  Permission
> = {
  create: { resource: "memory", action: "create" },
  update: { resource: "memory", action: "update" },
  delete: { resource: "memory", action: "delete" },
};

const MemoryToolArgsSchema = z.object({
  command: z.enum(["view", "create", "update", "search", "delete"]),
  content: z.string().max(MAX_CONTENT_CHARS).optional(),
  id: z.string().uuid().optional(),
  query: z.string().max(200).optional(),
});

type UserContext = {
  organizationId: string;
  userId: string;
};

type AgentMemoryContext = UserContext & {
  agentId: string;
};

function requireUserContext(context: ArchestraContext): UserContext | null {
  if (!context.organizationId || !context.userId) return null;
  return { organizationId: context.organizationId, userId: context.userId };
}

function resolveAgentMemoryContext(
  context: ArchestraContext,
): AgentMemoryContext | null {
  const userContext = requireUserContext(context);
  if (!userContext) return null;
  return {
    ...userContext,
    agentId: context.agentId ?? context.agent.id,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function formatMemoryAuditSnapshot(memory: Memory) {
  return {
    id: memory.id,
    content: memory.content,
    tier: memory.tier,
    visibility: memory.visibility,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

/** Chat-facing tool payload — tier is managed in Settings, not exposed in chat. */
function formatMemoryForChat(memory: Memory) {
  return {
    id: memory.id,
    content: memory.content,
    visibility: memory.visibility,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

async function getReadableTeamIds(userId: string): Promise<string[]> {
  return TeamModel.getUserTeamIds(userId);
}

async function requireMemoryWritePermission(
  ctx: UserContext,
  command: keyof typeof MEMORY_WRITE_COMMAND_PERMISSION,
) {
  const { userHasPermission } = await import("@/auth/utils");
  const perm = MEMORY_WRITE_COMMAND_PERMISSION[command];
  const allowed = await userHasPermission(
    ctx.userId,
    ctx.organizationId,
    perm.resource,
    perm.action,
  );
  if (!allowed) {
    return errorResult(
      `Permission denied: memory:${perm.action} is required to ${command} memories.`,
    );
  }
  return null;
}

function buildDuplicateCondition(params: {
  organizationId: string;
  visibility: MemoryVisibility;
  userId: string | null;
  teamId: string | null;
  content: string;
}) {
  const base = [
    eq(schema.memoriesTable.organizationId, params.organizationId),
    eq(schema.memoriesTable.visibility, params.visibility),
    eq(schema.memoriesTable.content, params.content),
  ];

  if (params.visibility === "personal") {
    return and(...base, eq(schema.memoriesTable.userId, params.userId!));
  }
  if (params.visibility === "team") {
    return and(...base, eq(schema.memoriesTable.teamId, params.teamId!));
  }
  return and(...base);
}

async function countCoreMemoriesInScope(
  params: {
    organizationId: string;
    visibility: MemoryVisibility;
    userId: string | null;
    teamId: string | null;
  },
  tx?: Transaction,
): Promise<number> {
  const conditions = [
    eq(schema.memoriesTable.organizationId, params.organizationId),
    eq(schema.memoriesTable.visibility, params.visibility),
    eq(schema.memoriesTable.tier, "core"),
  ];

  if (params.visibility === "personal") {
    conditions.push(eq(schema.memoriesTable.userId, params.userId!));
  } else if (params.visibility === "team") {
    conditions.push(eq(schema.memoriesTable.teamId, params.teamId!));
  }

  const dbOrTx = tx ?? db;
  const [{ value }] = await dbOrTx
    .select({ value: count() })
    .from(schema.memoriesTable)
    .where(and(...conditions));

  return value;
}

async function denyWhenSharedMemoryWriteDisabled(
  ctx: AgentMemoryContext,
  visibility: MemoryVisibility,
): Promise<ReturnType<typeof errorResult> | null> {
  if (visibility === "personal") {
    return null;
  }

  const agentConfig = await loadAgentMemoryConfig(ctx.agentId);
  if (!agentConfig || agentConfig.organizationId !== ctx.organizationId) {
    return errorResult("Agent not found.");
  }
  if (!agentConfig.sharedMemoryWriteEnabled) {
    return errorResult("Shared memory writes are disabled for this agent.");
  }
  return null;
}

async function buildAgentReadScope(params: AgentMemoryContext) {
  const [teamIds, accessLevel, agentConfig, agentTeamIds] = await Promise.all([
    getReadableTeamIds(params.userId),
    resolveMemoryAccessLevel(params.userId, params.organizationId),
    loadAgentMemoryConfig(params.agentId),
    AgentTeamModel.getTeamsForAgent(params.agentId),
  ]);

  if (!agentConfig || agentConfig.organizationId !== params.organizationId) {
    return null;
  }

  const memoryTargetMode = resolveAgentMemoryTargetMode(agentConfig);
  const scopeCondition = buildAgentAwareMemoryReadCondition({
    organizationId: params.organizationId,
    userId: params.userId,
    userTeamIds: teamIds,
    agentTeamIds,
    accessLevel,
    memoryTargetMode,
  });

  return {
    teamIds,
    accessLevel,
    agentConfig,
    agentTeamIds,
    memoryTargetMode,
    scopeCondition,
  };
}

async function viewMemories(
  ctx: AgentMemoryContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const readScope = await buildAgentReadScope(ctx);
  if (!readScope?.scopeCondition) {
    return structuredSuccessResult(
      { memories: [] },
      args.id ? "No matching memory found." : JSON.stringify({ memories: [] }, null, 2),
    );
  }

  if (args.id) {
    const [memory] = await db
      .select()
      .from(schema.memoriesTable)
      .where(
        and(readScope.scopeCondition, eq(schema.memoriesTable.id, args.id)),
      )
      .limit(1);

    if (!memory) {
      return structuredSuccessResult(
        { memories: [] },
        "No matching memory found.",
      );
    }

    const formatted = formatMemoryForChat(memory);
    return structuredSuccessResult(
      { memories: [formatted] },
      JSON.stringify({ memories: [formatted] }, null, 2),
    );
  }

  const memories = await MemoryModel.listReadableForAgentContext({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    teamIds: readScope.teamIds,
    agentId: ctx.agentId,
    accessLevel: readScope.accessLevel,
  });

  const formatted = memories.map(formatMemoryForChat);
  return structuredSuccessResult(
    { memories: formatted },
    JSON.stringify({ memories: formatted }, null, 2),
  );
}

async function searchReadableMemories(
  ctx: AgentMemoryContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const query = args.query?.trim();
  if (!query) {
    return errorResult("search requires a non-empty query.");
  }

  const readScope = await buildAgentReadScope(ctx);
  if (!readScope?.scopeCondition) {
    const formatted: ReturnType<typeof formatMemoryForChat>[] = [];
    return structuredSuccessResult(
      { memories: formatted },
      JSON.stringify({ memories: formatted }, null, 2),
    );
  }

  const memories = await db
    .select()
    .from(schema.memoriesTable)
    .where(
      and(
        readScope.scopeCondition,
        ilike(schema.memoriesTable.content, `%${escapeLikePattern(query)}%`),
      ),
    )
    .orderBy(desc(schema.memoriesTable.createdAt));

  const formatted = memories.map(formatMemoryForChat);
  return structuredSuccessResult(
    { memories: formatted },
    JSON.stringify({ memories: formatted }, null, 2),
  );
}

async function authorizeScopedMemoryWrite(params: {
  userId: string;
  organizationId: string;
  visibility: MemoryVisibility;
  ownerUserId: string | null;
  teamId: string | null;
}): Promise<ReturnType<typeof errorResult> | null> {
  const checker = await getMemoryPermissionChecker({
    userId: params.userId,
    organizationId: params.organizationId,
  });
  const userTeamIds = checker.isAdmin
    ? []
    : await TeamModel.getUserTeamIds(params.userId);

  try {
    requireMemoryModifyPermission({
      checker,
      visibility: params.visibility,
      ownerUserId: params.ownerUserId,
      teamId: params.teamId,
      userTeamIds,
      userId: params.userId,
    });
  } catch (error) {
    return errorResult(
      error instanceof Error
        ? error.message
        : "You do not have permission to modify this memory scope.",
    );
  }

  return null;
}

type ScopedMemoryCreateResult =
  | CallToolResult
  | { error: string }
  | { row: Memory; duplicate: boolean };

function isToolErrorResult(
  result: ScopedMemoryCreateResult,
): result is CallToolResult {
  return "isError" in result && result.isError === true;
}

function isScopedMemoryErrorResult(
  result: ScopedMemoryCreateResult,
): result is { error: string } {
  return "error" in result;
}

function isScopedMemorySuccessResult(
  result: ScopedMemoryCreateResult,
): result is { row: Memory; duplicate: boolean } {
  return "row" in result;
}

async function createScopedMemory(params: {
  ctx: AgentMemoryContext;
  content: string;
  visibility: MemoryVisibility;
  userId: string | null;
  teamId: string | null;
}): Promise<ScopedMemoryCreateResult> {
  const { ctx, content, visibility, userId, teamId } = params;

  const deniedScope = await authorizeScopedMemoryWrite({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    visibility,
    ownerUserId: userId,
    teamId,
  });
  if (deniedScope) return deniedScope;

  const duplicate = await db
    .select()
    .from(schema.memoriesTable)
    .where(
      buildDuplicateCondition({
        organizationId: ctx.organizationId,
        visibility,
        userId,
        teamId,
        content,
      }),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (duplicate) {
    return { row: duplicate, duplicate: true as const };
  }

  const coreCount = await countCoreMemoriesInScope({
    organizationId: ctx.organizationId,
    visibility,
    userId,
    teamId,
  });
  if (coreCount >= MAX_CORE_ITEMS_PER_SCOPE) {
    return {
      error: `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core memories in this scope. Remove one in Settings before adding another.`,
    };
  }

  const insertValues = {
    organizationId: ctx.organizationId,
    visibility,
    userId,
    teamId,
    content,
    tier: "core" as const,
    createdBy: ctx.userId,
    writtenByAgentId: ctx.agentId,
    sourceKind: "agent" as const,
    taintedAtWrite: false,
  };

  return db.transaction(async (tx) => {
    const fetchExisting = async () => {
      const [existing] = await tx
        .select()
        .from(schema.memoriesTable)
        .where(
          buildDuplicateCondition({
            organizationId: ctx.organizationId,
            visibility,
            userId,
            teamId,
            content,
          }),
        )
        .limit(1);
      return existing ?? null;
    };

    const existingDuplicate = await fetchExisting();
    if (existingDuplicate) {
      return { row: existingDuplicate, duplicate: true as const };
    }

    try {
      const row = await MemoryModel.create(insertValues, tx);
      if (!row) {
        return { row: await fetchExisting(), duplicate: true as const };
      }

      await tx.insert(schema.auditLogsTable).values({
        organizationId: ctx.organizationId,
        occurredAt: new Date(),
        actorId: ctx.userId,
        actorType: "user",
        action: "memory.created",
        outcome: "success",
        resourceType: "memory",
        resourceId: row.id,
        after: formatMemoryAuditSnapshot(row),
        httpMethod: null,
        httpPath: null,
      });
      return { row, duplicate: false as const };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { row: await fetchExisting(), duplicate: true as const };
      }
      throw error;
    }
  });
}

type TeamFanOutCreateResult =
  | CallToolResult
  | { error: string }
  | { rows: Memory[]; duplicateOnly: boolean };

function isTeamFanOutToolErrorResult(
  result: TeamFanOutCreateResult,
): result is CallToolResult {
  return "isError" in result && result.isError === true;
}

function isTeamFanOutErrorResult(
  result: TeamFanOutCreateResult,
): result is { error: string } {
  return "error" in result;
}

function isTeamFanOutSuccessResult(
  result: TeamFanOutCreateResult,
): result is { rows: Memory[]; duplicateOnly: boolean } {
  return "rows" in result;
}

async function createTeamMemoryFanOut(params: {
  ctx: AgentMemoryContext;
  content: string;
  teamIds: string[];
}): Promise<TeamFanOutCreateResult> {
  const { ctx, content, teamIds } = params;

  for (const teamId of teamIds) {
    const deniedScope = await authorizeScopedMemoryWrite({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      visibility: "team",
      ownerUserId: null,
      teamId,
    });
    if (deniedScope) return deniedScope;
  }

  for (const teamId of teamIds) {
    const [existingDuplicate] = await db
      .select()
      .from(schema.memoriesTable)
      .where(
        buildDuplicateCondition({
          organizationId: ctx.organizationId,
          visibility: "team",
          userId: null,
          teamId,
          content,
        }),
      )
      .limit(1);
    if (existingDuplicate) {
      continue;
    }

    const coreCount = await countCoreMemoriesInScope({
      organizationId: ctx.organizationId,
      visibility: "team",
      userId: null,
      teamId,
    });
    if (coreCount >= MAX_CORE_ITEMS_PER_SCOPE) {
      return {
        error: `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core memories in this scope. Remove one in Settings before adding another.`,
      };
    }
  }

  const insertValuesBase = {
    organizationId: ctx.organizationId,
    visibility: "team" as const,
    userId: null,
    content,
    tier: "core" as const,
    createdBy: ctx.userId,
    writtenByAgentId: ctx.agentId,
    sourceKind: "agent" as const,
    taintedAtWrite: false,
  };

  try {
    return await db.transaction(async (tx) => {
      const rows: Memory[] = [];
      let duplicateOnly = true;

      for (const teamId of teamIds) {
        const [existingDuplicate] = await tx
          .select()
          .from(schema.memoriesTable)
          .where(
            buildDuplicateCondition({
              organizationId: ctx.organizationId,
              visibility: "team",
              userId: null,
              teamId,
              content,
            }),
          )
          .limit(1);

        if (existingDuplicate) {
          rows.push(existingDuplicate);
          continue;
        }

        const coreCount = await countCoreMemoriesInScope(
          {
            organizationId: ctx.organizationId,
            visibility: "team",
            userId: null,
            teamId,
          },
          tx,
        );
        if (coreCount >= MAX_CORE_ITEMS_PER_SCOPE) {
          throw new Error("CORE_SCOPE_LIMIT");
        }

        try {
          const row = await MemoryModel.create(
            { ...insertValuesBase, teamId },
            tx,
          );
          if (!row) {
            const [raceDuplicate] = await tx
              .select()
              .from(schema.memoriesTable)
              .where(
                buildDuplicateCondition({
                  organizationId: ctx.organizationId,
                  visibility: "team",
                  userId: null,
                  teamId,
                  content,
                }),
              )
              .limit(1);
            if (raceDuplicate) {
              rows.push(raceDuplicate);
              continue;
            }
            throw new Error("FAILED_TEAM_FANOUT_INSERT");
          }

          await tx.insert(schema.auditLogsTable).values({
            organizationId: ctx.organizationId,
            occurredAt: new Date(),
            actorId: ctx.userId,
            actorType: "user",
            action: "memory.created",
            outcome: "success",
            resourceType: "memory",
            resourceId: row.id,
            after: formatMemoryAuditSnapshot(row),
            httpMethod: null,
            httpPath: null,
          });

          rows.push(row);
          duplicateOnly = false;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            const [raceDuplicate] = await tx
              .select()
              .from(schema.memoriesTable)
              .where(
                buildDuplicateCondition({
                  organizationId: ctx.organizationId,
                  visibility: "team",
                  userId: null,
                  teamId,
                  content,
                }),
              )
              .limit(1);
            if (raceDuplicate) {
              rows.push(raceDuplicate);
              continue;
            }
          }
          throw error;
        }
      }

      return { rows, duplicateOnly };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORE_SCOPE_LIMIT") {
      return {
        error: `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core memories in this scope. Remove one in Settings before adding another.`,
      };
    }
    throw error;
  }
}

async function createAgentMemory(
  ctx: AgentMemoryContext,
  context: ArchestraContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const denied = await requireMemoryWritePermission(ctx, "create");
  if (denied) return denied;

  if (context.contextIsTrusted === false) {
    return successResult(TAINTED_WRITE_MESSAGE);
  }

  const content = args.content?.trim();
  if (!content) {
    return errorResult("create requires non-empty content.");
  }

  const agentConfig = await loadAgentMemoryConfig(ctx.agentId);
  if (!agentConfig || agentConfig.organizationId !== ctx.organizationId) {
    return errorResult("Agent not found.");
  }

  const targetMode = resolveAgentMemoryTargetMode(agentConfig);
  if (targetMode !== "personal") {
    const deniedSharedWrite = await denyWhenSharedMemoryWriteDisabled(
      ctx,
      targetMode === "org" ? "org" : "team",
    );
    if (deniedSharedWrite) return deniedSharedWrite;
  }

  if (targetMode === "personal") {
    const created = await createScopedMemory({
      ctx,
      content,
      visibility: "personal",
      userId: ctx.userId,
      teamId: null,
    });

    if (isToolErrorResult(created)) {
      return created;
    }
    if (isScopedMemoryErrorResult(created)) {
      return errorResult(created.error);
    }
    if (!isScopedMemorySuccessResult(created)) {
      return errorResult("Failed to save memory.");
    }

    logger.info(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentId: ctx.agentId,
        memoryId: created.row?.id,
        duplicate: created.duplicate,
        visibility: "personal",
      },
      "[Memory] Agent-targeted personal memory created",
    );

    if (created.row && !created.duplicate) {
      return structuredSuccessResult(
        { memory: formatMemoryForChat(created.row) },
        `Saved memory ${created.row.id}.`,
      );
    }

    if (created.row) {
      return successResult("Memory already exists with the same content.");
    }

    return errorResult("Failed to save memory.");
  }

  if (targetMode === "org") {
    const created = await createScopedMemory({
      ctx,
      content,
      visibility: "org",
      userId: null,
      teamId: null,
    });

    if (isToolErrorResult(created)) {
      return created;
    }
    if (isScopedMemoryErrorResult(created)) {
      return errorResult(created.error);
    }
    if (!isScopedMemorySuccessResult(created)) {
      return errorResult("Failed to save memory.");
    }

    logger.info(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentId: ctx.agentId,
        memoryId: created.row?.id,
        duplicate: created.duplicate,
        visibility: "org",
      },
      "[Memory] Agent-targeted org memory created",
    );

    if (created.row && !created.duplicate) {
      return structuredSuccessResult(
        { memory: formatMemoryForChat(created.row) },
        `Saved memory ${created.row.id}.`,
      );
    }

    if (created.row) {
      return successResult("Memory already exists with the same content.");
    }

    return errorResult("Failed to save memory.");
  }

  const agentTeamIds = await AgentTeamModel.getTeamsForAgent(ctx.agentId);
  if (agentTeamIds.length === 0) {
    return errorResult(
      "This agent has no teams assigned, so team memory cannot be saved.",
    );
  }

  const fanOut = await createTeamMemoryFanOut({
    ctx,
    content,
    teamIds: agentTeamIds,
  });

  if (isTeamFanOutToolErrorResult(fanOut)) {
    return fanOut;
  }
  if (isTeamFanOutErrorResult(fanOut)) {
    return errorResult(fanOut.error);
  }
  if (!isTeamFanOutSuccessResult(fanOut)) {
    return errorResult("Failed to save memory.");
  }

  const { rows: createdRows, duplicateOnly } = fanOut;

  logger.info(
    {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      memoryIds: createdRows.map((row) => row.id),
      teamCount: agentTeamIds.length,
      duplicateOnly,
    },
    "[Memory] Agent-targeted team memory fan-out",
  );

  if (createdRows.length === 0) {
    return errorResult("Failed to save memory.");
  }

  if (duplicateOnly) {
    return successResult("Memory already exists with the same content.");
  }

  const formatted = createdRows.map(formatMemoryForChat);
  return structuredSuccessResult(
    { memories: formatted },
    `Saved ${formatted.length} team ${formatted.length === 1 ? "memory" : "memories"}.`,
  );
}

async function canModifyMemoryInAgentContext(
  ctx: AgentMemoryContext,
  memory: Memory,
): Promise<boolean> {
  const [agentConfig, agentTeamIds] = await Promise.all([
    loadAgentMemoryConfig(ctx.agentId),
    AgentTeamModel.getTeamsForAgent(ctx.agentId),
  ]);
  if (!agentConfig || agentConfig.organizationId !== ctx.organizationId) {
    return false;
  }

  const targetMode = resolveAgentMemoryTargetMode(agentConfig);
  const matchesTarget =
    (targetMode === "personal" &&
      memory.visibility === "personal" &&
      memory.userId === ctx.userId) ||
    (targetMode === "org" && memory.visibility === "org") ||
    (targetMode === "team" &&
      memory.visibility === "team" &&
      memory.teamId !== null &&
      agentTeamIds.includes(memory.teamId));
  if (!matchesTarget) {
    return false;
  }

  const denied = await authorizeScopedMemoryWrite({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    visibility: memory.visibility,
    ownerUserId: memory.userId,
    teamId: memory.teamId,
  });

  return denied === null;
}

async function updateMemory(
  ctx: AgentMemoryContext,
  context: ArchestraContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const denied = await requireMemoryWritePermission(ctx, "update");
  if (denied) return denied;

  if (context.contextIsTrusted === false) {
    return successResult(TAINTED_WRITE_MESSAGE);
  }

  if (!args.id) {
    return errorResult("update requires id.");
  }
  const memoryId = args.id;

  const content = args.content?.trim();
  if (!content) {
    return errorResult("update requires non-empty content.");
  }

  const existing = await MemoryModel.getById(memoryId);
  if (
    !existing ||
    existing.organizationId !== ctx.organizationId ||
    !(await canModifyMemoryInAgentContext(ctx, existing))
  ) {
    return errorResult(
      "Memory not found or you do not have permission to update it.",
    );
  }

  const deniedSharedWrite = await denyWhenSharedMemoryWriteDisabled(
    ctx,
    existing.visibility,
  );
  if (deniedSharedWrite) return deniedSharedWrite;

  let updated: { row: Memory } | { error: string };
  try {
    updated = await db.transaction(
      async (tx): Promise<{ row: Memory } | { error: string }> => {
        if (content !== existing.content) {
          const [duplicate] = await tx
            .select({ id: schema.memoriesTable.id })
            .from(schema.memoriesTable)
            .where(
              and(
                buildDuplicateCondition({
                  organizationId: ctx.organizationId,
                  visibility: existing.visibility,
                  userId: existing.userId,
                  teamId: existing.teamId,
                  content,
                }),
                ne(schema.memoriesTable.id, memoryId),
              ),
            )
            .limit(1);

          if (duplicate) {
            return { error: DUPLICATE_CONTENT_MESSAGE };
          }
        }

        const [row] = await tx
          .update(schema.memoriesTable)
          .set({ content })
          .where(eq(schema.memoriesTable.id, memoryId))
          .returning();

        if (!row) return { error: "Failed to update memory." };

        await tx.insert(schema.auditLogsTable).values({
          organizationId: ctx.organizationId,
          occurredAt: new Date(),
          actorId: ctx.userId,
          actorType: "user",
          action: "memory.updated",
          outcome: "success",
          resourceType: "memory",
          resourceId: row.id,
          before: formatMemoryAuditSnapshot(existing),
          after: formatMemoryAuditSnapshot(row),
          httpMethod: null,
          httpPath: null,
        });

        return { row };
      },
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return errorResult(DUPLICATE_CONTENT_MESSAGE);
    }
    throw error;
  }

  if ("error" in updated) {
    return errorResult(updated.error);
  }

  logger.info(
    {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      memoryId: updated.row.id,
    },
    "[Memory] Memory updated via agent tool",
  );

  return structuredSuccessResult(
    { memory: formatMemoryForChat(updated.row) },
    `Updated memory ${updated.row.id}.`,
  );
}

async function deleteMemory(
  ctx: AgentMemoryContext,
  context: ArchestraContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const denied = await requireMemoryWritePermission(ctx, "delete");
  if (denied) return denied;

  if (context.contextIsTrusted === false) {
    return successResult(TAINTED_WRITE_MESSAGE);
  }

  if (!args.id) {
    return errorResult("delete requires id.");
  }
  const memoryId = args.id;

  const existing = await MemoryModel.getById(memoryId);
  if (
    !existing ||
    existing.organizationId !== ctx.organizationId ||
    !(await canModifyMemoryInAgentContext(ctx, existing))
  ) {
    return errorResult(
      "Memory not found or you do not have permission to delete it.",
    );
  }

  const deniedSharedWrite = await denyWhenSharedMemoryWriteDisabled(
    ctx,
    existing.visibility,
  );
  if (deniedSharedWrite) return deniedSharedWrite;

  const deleted = await db.transaction(async (tx) => {
    const result = await tx
      .delete(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, memoryId))
      .returning({ id: schema.memoriesTable.id });

    if (result.length === 0) return false;

    await tx.insert(schema.auditLogsTable).values({
      organizationId: ctx.organizationId,
      occurredAt: new Date(),
      actorId: ctx.userId,
      actorType: "user",
      action: "memory.deleted",
      outcome: "success",
      resourceType: "memory",
      resourceId: existing.id,
      before: formatMemoryAuditSnapshot(existing),
      httpMethod: null,
      httpPath: null,
    });

    return true;
  });

  if (!deleted) {
    return errorResult("Failed to delete memory.");
  }

  logger.info(
    {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      memoryId: existing.id,
    },
    "[Memory] Memory deleted via agent tool",
  );

  return successResult(`Deleted memory ${existing.id}.`);
}

const registry = defineArchestraTools([
  defineArchestraTool({
    shortName: TOOL_MEMORY_SHORT_NAME,
    title: "Memory",
    description:
      "View, search, create, update, or delete durable agent memory. " +
      "Writes target the current agent's memory scope (personal, team, or org). " +
      "Reads always include your personal memories plus shared memories allowed " +
      "by the agent's scope, capped by your memory access level.",
    schema: MemoryToolArgsSchema,
    async handler({ args, context }) {
      const ctx = resolveAgentMemoryContext(context);
      if (!ctx) {
        return errorResult("This tool requires an authenticated user session.");
      }

      if (
        !config.memory.enabled ||
        (await OrganizationModel.getById(ctx.organizationId))?.memoryEnabled !==
          true
      ) {
        return errorResult("Durable memory is disabled for this organization.");
      }

      switch (args.command) {
        case "view":
          return viewMemories(ctx, args);
        case "search":
          return searchReadableMemories(ctx, args);
        case "create":
          return createAgentMemory(ctx, context, args);
        case "update":
          return updateMemory(ctx, context, args);
        case "delete":
          return deleteMemory(ctx, context, args);
        default:
          return errorResult("Unsupported memory command.");
      }
    },
  }),
] as const);

export const toolEntries = registry.toolEntries;
export const tools = registry.tools;
