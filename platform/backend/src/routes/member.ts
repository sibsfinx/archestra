import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  RouteId,
} from "@archestra/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getMemoryPermissionChecker } from "@/auth/memory-permissions";
import { MemberModel } from "@/models";
import {
  ApiError,
  constructResponseSchema,
  MemberListItemSchema,
  MemberSchema,
  UpdateMemberMemoryAccessBodySchema,
} from "@/types";

const memberRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/members",
    {
      schema: {
        operationId: RouteId.GetMembers,
        description:
          "Get all members of the organization with pagination and optional filters",
        tags: ["Member"],
        querystring: PaginationQuerySchema.extend({
          name: z
            .string()
            .optional()
            .describe(
              "Search by user name or email (case-insensitive partial match)",
            ),
          role: z.string().optional().describe("Filter by exact role name"),
        }),
        response: constructResponseSchema(
          createPaginatedResponseSchema(MemberListItemSchema),
        ),
      },
    },
    async ({ query: { limit, offset, name, role }, organizationId }, reply) => {
      return reply.send(
        await MemberModel.findAllPaginated({
          organizationId,
          pagination: { limit, offset },
          name: name || undefined,
          role: role || undefined,
        }),
      );
    },
  );

  fastify.patch(
    "/api/members/:memberId/memory-access",
    {
      schema: {
        operationId: RouteId.UpdateMemberMemoryAccess,
        description:
          "Update a member's durable memory access level (admin only)",
        tags: ["Member"],
        params: z.object({
          memberId: z.string().min(1),
        }),
        body: UpdateMemberMemoryAccessBodySchema,
        response: constructResponseSchema(MemberSchema),
      },
    },
    async (
      { params: { memberId }, body: { accessLevel }, organizationId, user },
      reply,
    ) => {
      const checker = await getMemoryPermissionChecker({
        userId: user.id,
        organizationId,
      });
      if (!checker.isAdmin) {
        throw new ApiError(
          403,
          "Only memory administrators can update member memory access",
        );
      }

      const updated = await MemberModel.updateMemoryAccessLevel(
        memberId,
        organizationId,
        accessLevel,
      );

      if (!updated) {
        throw new ApiError(404, "Member not found");
      }

      return reply.send(updated);
    },
  );
};

export default memberRoutes;
