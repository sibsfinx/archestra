import { TOOL_MEMORY_SHORT_NAME, type Permission } from "@archestra/shared";
import { and, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import db, { schema } from "@/database";
import logger from "@/logging";
import { MemoryModel, TeamModel } from "@/models";
import type { Memory, MemoryTier } from "@/types";
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
  tier: z.enum(["core", "archival"]).optional(),
});

type UserContext = {
  organizationId: string;
  userId: string;
};

function requireUserContext(context: ArchestraContext): UserContext | null {
  if (!context.organizationId || !context.userId) return null;
  return { organizationId: context.organizationId, userId: context.userId };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function buildReadScopeCondition(params: {
  organizationId: string;
  userId: string;
  teamIds: string[];
}) {
  const visibilityConditions = [
    and(
      eq(schema.memoriesTable.visibility, "personal"),
      eq(schema.memoriesTable.userId, params.userId),
    ),
    eq(schema.memoriesTable.visibility, "org"),
  ];

  if (params.teamIds.length > 0) {
    visibilityConditions.push(
      and(
        eq(schema.memoriesTable.visibility, "team"),
        inArray(schema.memoriesTable.teamId, params.teamIds),
      ),
    );
  }

  return and(
    eq(schema.memoriesTable.organizationId, params.organizationId),
    or(...visibilityConditions),
  );
}

function formatMemory(memory: Memory) {
  return {
    id: memory.id,
    content: memory.content,
    tier: memory.tier,
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

async function findPersonalDuplicate(
  ctx: UserContext,
  content: string,
): Promise<Memory | null> {
  const [existing] = await db
    .select()
    .from(schema.memoriesTable)
    .where(
      and(
        eq(schema.memoriesTable.organizationId, ctx.organizationId),
        eq(schema.memoriesTable.userId, ctx.userId),
        eq(schema.memoriesTable.visibility, "personal"),
        eq(schema.memoriesTable.content, content),
      ),
    )
    .limit(1);
  return existing ?? null;
}

async function viewPersonalMemories(
  ctx: UserContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  if (args.id) {
    const memory = await MemoryModel.getById(args.id);
    if (
      !memory ||
      memory.organizationId !== ctx.organizationId ||
      memory.visibility !== "personal" ||
      memory.userId !== ctx.userId
    ) {
      return structuredSuccessResult(
        { memories: [] },
        "No matching memory found.",
      );
    }
    if (args.tier && memory.tier !== args.tier) {
      return structuredSuccessResult(
        { memories: [] },
        "No matching memory found.",
      );
    }
    return structuredSuccessResult(
      { memories: [formatMemory(memory)] },
      JSON.stringify({ memories: [formatMemory(memory)] }, null, 2),
    );
  }

  const memories = await MemoryModel.listReadable({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    teamIds: await getReadableTeamIds(ctx.userId),
    tier: args.tier,
    visibility: "personal",
  });

  const formatted = memories.map(formatMemory);
  return structuredSuccessResult(
    { memories: formatted },
    JSON.stringify({ memories: formatted }, null, 2),
  );
}

async function searchReadableMemories(
  ctx: UserContext,
  args: z.infer<typeof MemoryToolArgsSchema>,
) {
  const query = args.query?.trim();
  if (!query) {
    return errorResult("search requires a non-empty query.");
  }

  const teamIds = await getReadableTeamIds(ctx.userId);
  const conditions = [
    buildReadScopeCondition({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      teamIds,
    }),
    ilike(schema.memoriesTable.content, `%${escapeLikePattern(query)}%`),
  ];
  if (args.tier) {
    conditions.push(eq(schema.memoriesTable.tier, args.tier));
  }

  const memories = await db
    .select()
    .from(schema.memoriesTable)
    .where(and(...conditions))
    .orderBy(desc(schema.memoriesTable.createdAt));

  const formatted = memories.map(formatMemory);
  return structuredSuccessResult(
    { memories: formatted },
    JSON.stringify({ memories: formatted }, null, 2),
  );
}

async function countPersonalCoreMemories(ctx: UserContext): Promise<number> {
  const rows = await MemoryModel.listReadable({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    teamIds: [],
    tier: "core",
    visibility: "personal",
  });
  return rows.length;
}

async function createPersonalMemory(
  ctx: UserContext,
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

  const tier: MemoryTier = args.tier ?? "core";
  const duplicate = await findPersonalDuplicate(ctx, content);
  if (duplicate) {
    return successResult("Memory already exists with the same content.");
  }

  if (tier === "core") {
    const coreCount = await countPersonalCoreMemories(ctx);
    if (coreCount >= MAX_CORE_ITEMS_PER_SCOPE) {
      return errorResult(
        `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core personal memories. Archive or delete one before adding another.`,
      );
    }
  }

  const insertValues = {
    organizationId: ctx.organizationId,
    visibility: "personal" as const,
    userId: ctx.userId,
    teamId: null,
    content,
    tier,
    createdBy: ctx.userId,
    taintedAtWrite: false,
  };

  const created = await db.transaction(async (tx) => {
    const fetchExisting = async () => {
      const [existing] = await tx
        .select()
        .from(schema.memoriesTable)
        .where(
          and(
            eq(schema.memoriesTable.organizationId, ctx.organizationId),
            eq(schema.memoriesTable.userId, ctx.userId),
            eq(schema.memoriesTable.visibility, "personal"),
            eq(schema.memoriesTable.content, content),
          ),
        )
        .limit(1);
      return existing ?? null;
    };

    const duplicate = await fetchExisting();
    if (duplicate) {
      return { row: duplicate, duplicate: true };
    }

    try {
      const row = await MemoryModel.create(insertValues, tx);
      if (!row) {
        return { row: await fetchExisting(), duplicate: true };
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
        after: formatMemory(row),
        httpMethod: null,
        httpPath: null,
      });
      return { row, duplicate: false };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { row: await fetchExisting(), duplicate: true };
      }
      throw error;
    }
  });

  logger.info(
    {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      memoryId: created.row?.id,
      duplicate: created.duplicate,
    },
    "[Memory] Personal memory created",
  );

  if (created.row && !created.duplicate) {
    return structuredSuccessResult(
      { memory: formatMemory(created.row) },
      `Saved memory ${created.row.id}.`,
    );
  }

  if (created.row) {
    return successResult("Memory already exists with the same content.");
  }

  return errorResult("Failed to save memory.");
}

async function updatePersonalMemory(
  ctx: UserContext,
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

  const content = args.content?.trim();
  if (!content) {
    return errorResult("update requires non-empty content.");
  }

  const existing = await MemoryModel.getById(args.id);
  if (
    !existing ||
    existing.organizationId !== ctx.organizationId ||
    existing.userId !== ctx.userId
  ) {
    return errorResult(
      "Memory not found or you do not have permission to update it.",
    );
  }

  const tier = args.tier ?? existing.tier;
  if (tier === "core" && existing.tier !== "core") {
    const coreCount = await countPersonalCoreMemories(ctx);
    if (coreCount >= MAX_CORE_ITEMS_PER_SCOPE) {
      return errorResult(
        `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core personal memories. Archive or delete one before promoting this memory.`,
      );
    }
  }

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
                eq(schema.memoriesTable.organizationId, ctx.organizationId),
                eq(schema.memoriesTable.userId, ctx.userId),
                eq(schema.memoriesTable.visibility, "personal"),
                eq(schema.memoriesTable.content, content),
                ne(schema.memoriesTable.id, args.id!),
              ),
            )
            .limit(1);

          if (duplicate) {
            return { error: DUPLICATE_CONTENT_MESSAGE };
          }
        }

        const [row] = await tx
          .update(schema.memoriesTable)
          .set({ content, tier })
          .where(eq(schema.memoriesTable.id, args.id!))
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
          before: formatMemory(existing),
          after: formatMemory(row),
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
      memoryId: updated.row.id,
    },
    "[Memory] Personal memory updated",
  );

  return structuredSuccessResult(
    { memory: formatMemory(updated.row) },
    `Updated memory ${updated.row.id}.`,
  );
}

async function deletePersonalMemory(
  ctx: UserContext,
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

  const existing = await MemoryModel.getById(args.id);
  if (
    !existing ||
    existing.organizationId !== ctx.organizationId ||
    existing.userId !== ctx.userId
  ) {
    return errorResult(
      "Memory not found or you do not have permission to delete it.",
    );
  }

  const deleted = await db.transaction(async (tx) => {
    const result = await tx
      .delete(schema.memoriesTable)
      .where(eq(schema.memoriesTable.id, args.id!))
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
      before: formatMemory(existing),
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
      memoryId: existing.id,
    },
    "[Memory] Personal memory deleted",
  );

  return successResult(`Deleted memory ${existing.id}.`);
}

const registry = defineArchestraTools([
  defineArchestraTool({
    shortName: TOOL_MEMORY_SHORT_NAME,
    title: "Memory",
    description:
      "View, search, create, update, or delete durable agent memory. " +
      "Writes always target your personal memories; search and view read " +
      "personal memories you own. Search also includes team and org memories " +
      "visible to you.",
    schema: MemoryToolArgsSchema,
    async handler({ args, context }) {
      const ctx = requireUserContext(context);
      if (!ctx) {
        return errorResult("This tool requires an authenticated user session.");
      }

      switch (args.command) {
        case "view":
          return viewPersonalMemories(ctx, args);
        case "search":
          return searchReadableMemories(ctx, args);
        case "create":
          return createPersonalMemory(ctx, context, args);
        case "update":
          return updatePersonalMemory(ctx, context, args);
        case "delete":
          return deletePersonalMemory(ctx, context, args);
        default:
          return errorResult("Unsupported memory command.");
      }
    },
  }),
] as const);

export const toolEntries = registry.toolEntries;
export const tools = registry.tools;
