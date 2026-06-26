import { RouteId } from "@archestra/shared";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  DUPLICATE_CONTENT_MESSAGE,
  MAX_CONTENT_CHARS,
  MAX_CORE_ITEMS_PER_SCOPE,
} from "@/archestra-mcp-server/memory";
import {
  getMemoryPermissionChecker,
  requireMemoryModifyPermission,
} from "@/auth/memory-permissions";
import db, { schema } from "@/database";
import { MemoryModel, TeamModel } from "@/models";
import {
  ApiError,
  constructResponseSchema,
  DeleteObjectResponseSchema,
  type Memory,
  type MemoryTier,
  MemoryTierSchema,
  type MemoryVisibility,
  MemoryVisibilitySchema,
  SelectMemorySchema,
} from "@/types";
import { isUniqueConstraintError } from "@/utils/db";

const MemoryListQuerySchema = z.object({
  visibility: MemoryVisibilitySchema,
});

const CreateMemoryBodySchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
  tier: MemoryTierSchema.optional(),
  visibility: MemoryVisibilitySchema,
  teamId: z.string().min(1).optional(),
});

const UpdateMemoryBodySchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_CHARS).optional(),
  tier: MemoryTierSchema.optional(),
});

const memoryRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/memory",
    {
      schema: {
        operationId: RouteId.GetMemories,
        description: "List memories for the settings UI, scoped by visibility",
        tags: ["Memory"],
        querystring: MemoryListQuerySchema,
        response: constructResponseSchema(
          z.object({ data: z.array(SelectMemorySchema) }),
        ),
      },
    },
    async ({ query: { visibility }, organizationId, user }, reply) => {
      const teamIds = await TeamModel.getUserTeamIds(user.id);
      const memories = await MemoryModel.listReadable({
        organizationId,
        userId: user.id,
        teamIds,
        visibility,
      });

      return reply.send({ data: memories });
    },
  );

  fastify.post(
    "/api/memory",
    {
      schema: {
        operationId: RouteId.CreateMemory,
        description: "Create a memory entry",
        tags: ["Memory"],
        body: CreateMemoryBodySchema,
        response: constructResponseSchema(SelectMemorySchema),
      },
    },
    async ({ body, organizationId, user }, reply) => {
      const visibility = body.visibility;
      const teamId = visibility === "team" ? (body.teamId ?? null) : null;
      const ownerUserId = visibility === "personal" ? user.id : null;

      if (visibility === "team" && !teamId) {
        throw new ApiError(400, "teamId is required for team-scoped memories");
      }

      await authorizeMemoryWrite({
        userId: user.id,
        organizationId,
        visibility,
        ownerUserId,
        teamId,
      });

      if (teamId) {
        await assertTeamInOrganization({ teamId, organizationId });
      }

      const content = body.content.trim();
      const tier: MemoryTier = body.tier ?? "core";

      const [existingDuplicate] = await db
        .select()
        .from(schema.memoriesTable)
        .where(
          buildDuplicateCondition({
            organizationId,
            visibility,
            userId: ownerUserId,
            teamId,
            content,
          }),
        )
        .limit(1);

      if (existingDuplicate) {
        return reply.send(existingDuplicate);
      }

      await assertCoreCapacity({
        organizationId,
        visibility,
        userId: ownerUserId,
        teamId,
        tier,
      });

      const created = await db.transaction(async (tx) => {
        const fetchDuplicate = async () => {
          const [existing] = await tx
            .select()
            .from(schema.memoriesTable)
            .where(
              buildDuplicateCondition({
                organizationId,
                visibility,
                userId: ownerUserId,
                teamId,
                content,
              }),
            )
            .limit(1);
          return existing ?? null;
        };

        const duplicate = await fetchDuplicate();
        if (duplicate) {
          return duplicate;
        }

        try {
          const [row] = await tx
            .insert(schema.memoriesTable)
            .values({
              organizationId,
              visibility,
              userId: ownerUserId,
              teamId,
              content,
              tier,
              createdBy: user.id,
              taintedAtWrite: false,
            })
            .returning();

          if (row) {
            await tx.insert(schema.auditLogsTable).values({
              organizationId,
              occurredAt: new Date(),
              actorId: user.id,
              actorType: "user",
              action: "memory.created",
              outcome: "success",
              resourceType: "memory",
              resourceId: row.id,
              after: formatMemoryAuditSnapshot(row),
              httpMethod: null,
              httpPath: null,
            });
          }

          return row ?? null;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return fetchDuplicate();
          }
          throw error;
        }
      });

      if (!created) {
        throw new ApiError(500, "Failed to create memory");
      }

      return reply.send(created);
    },
  );

  fastify.patch(
    "/api/memory/:id",
    {
      schema: {
        operationId: RouteId.UpdateMemory,
        description: "Update a memory entry",
        tags: ["Memory"],
        params: z.object({ id: z.uuid() }),
        body: UpdateMemoryBodySchema,
        response: constructResponseSchema(SelectMemorySchema),
      },
    },
    async ({ params: { id }, body, organizationId, user }, reply) => {
      const existing = await findMemoryOrThrow({ id, organizationId });

      await authorizeMemoryModify({
        userId: user.id,
        organizationId,
        memory: existing,
      });

      if (!body.content && body.tier === undefined) {
        throw new ApiError(400, "No fields to update");
      }

      const nextContent = body.content?.trim() ?? existing.content;
      const nextTier = body.tier ?? existing.tier;

      if (nextContent !== existing.content) {
        const [duplicate] = await db
          .select({ id: schema.memoriesTable.id })
          .from(schema.memoriesTable)
          .where(
            and(
              buildDuplicateCondition({
                organizationId,
                visibility: existing.visibility,
                userId: existing.userId,
                teamId: existing.teamId,
                content: nextContent,
              }),
              ne(schema.memoriesTable.id, id),
            ),
          )
          .limit(1);

        if (duplicate) {
          throw new ApiError(400, DUPLICATE_CONTENT_MESSAGE);
        }
      }

      if (nextTier === "core" && existing.tier !== "core") {
        await assertCoreCapacity({
          organizationId,
          visibility: existing.visibility,
          userId: existing.userId,
          teamId: existing.teamId,
          tier: "core",
        });
      }

      const updated = await db.transaction(async (tx) => {
        try {
          const [row] = await tx
            .update(schema.memoriesTable)
            .set({
              ...(body.content !== undefined ? { content: nextContent } : {}),
              ...(body.tier !== undefined ? { tier: nextTier } : {}),
            })
            .where(eq(schema.memoriesTable.id, id))
            .returning();

          if (!row) return null;

          await tx.insert(schema.auditLogsTable).values({
            organizationId,
            occurredAt: new Date(),
            actorId: user.id,
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

          return row;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new ApiError(400, DUPLICATE_CONTENT_MESSAGE);
          }
          throw error;
        }
      });

      if (!updated) {
        throw new ApiError(404, "Memory not found");
      }

      return reply.send(updated);
    },
  );

  fastify.delete(
    "/api/memory/:id",
    {
      schema: {
        operationId: RouteId.DeleteMemory,
        description: "Delete a memory entry",
        tags: ["Memory"],
        params: z.object({ id: z.uuid() }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id }, organizationId, user }, reply) => {
      const existing = await findMemoryOrThrow({ id, organizationId });

      await authorizeMemoryModify({
        userId: user.id,
        organizationId,
        memory: existing,
      });

      const deleted = await db.transaction(async (tx) => {
        const result = await tx
          .delete(schema.memoriesTable)
          .where(eq(schema.memoriesTable.id, id))
          .returning({ id: schema.memoriesTable.id });

        if (result.length === 0) return false;

        await tx.insert(schema.auditLogsTable).values({
          organizationId,
          occurredAt: new Date(),
          actorId: user.id,
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
        throw new ApiError(404, "Memory not found");
      }

      return reply.send({ success: true });
    },
  );
};

export default memoryRoutes;

function formatMemoryAuditSnapshot(memory: Memory) {
  return {
    id: memory.id,
    content: memory.content,
    tier: memory.tier,
    visibility: memory.visibility,
    userId: memory.userId,
    teamId: memory.teamId,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
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

async function findMemoryOrThrow(params: {
  id: string;
  organizationId: string;
}): Promise<Memory> {
  const memory = await MemoryModel.getById(params.id);
  if (!memory || memory.organizationId !== params.organizationId) {
    throw new ApiError(404, "Memory not found");
  }
  return memory;
}

async function authorizeMemoryWrite(params: {
  userId: string;
  organizationId: string;
  visibility: MemoryVisibility;
  ownerUserId: string | null;
  teamId: string | null;
}): Promise<void> {
  const checker = await getMemoryPermissionChecker({
    userId: params.userId,
    organizationId: params.organizationId,
  });
  const userTeamIds = checker.isAdmin
    ? []
    : await TeamModel.getUserTeamIds(params.userId);

  requireMemoryModifyPermission({
    checker,
    visibility: params.visibility,
    ownerUserId: params.ownerUserId,
    teamId: params.teamId,
    userTeamIds,
    userId: params.userId,
  });
}

async function authorizeMemoryModify(params: {
  userId: string;
  organizationId: string;
  memory: Memory;
}): Promise<void> {
  await authorizeMemoryWrite({
    userId: params.userId,
    organizationId: params.organizationId,
    visibility: params.memory.visibility,
    ownerUserId: params.memory.userId,
    teamId: params.memory.teamId,
  });
}

async function assertTeamInOrganization(params: {
  teamId: string;
  organizationId: string;
}): Promise<void> {
  const teams = await TeamModel.findByIds([params.teamId]);
  const team = teams.find((t) => t.id === params.teamId);
  if (!team || team.organizationId !== params.organizationId) {
    throw new ApiError(400, "Unknown team id");
  }
}

async function assertCoreCapacity(params: {
  organizationId: string;
  visibility: MemoryVisibility;
  userId: string | null;
  teamId: string | null;
  tier: MemoryTier;
}): Promise<void> {
  if (params.tier !== "core") return;

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

  const rows = await db
    .select({ id: schema.memoriesTable.id })
    .from(schema.memoriesTable)
    .where(and(...conditions));

  if (rows.length >= MAX_CORE_ITEMS_PER_SCOPE) {
    throw new ApiError(
      400,
      `You already have ${MAX_CORE_ITEMS_PER_SCOPE} core memories in this scope. Archive or delete one before adding another.`,
    );
  }
}
