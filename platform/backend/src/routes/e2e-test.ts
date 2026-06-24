import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import config from "@/config";
import db, { schema } from "@/database";
import OrganizationModel from "@/models/organization";
import { ApiError } from "@/types";

const e2eTestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/api/e2e-test/reset-first-run-state",
    {
      schema: {
        description: "Reset onboarding and mail settings for E2E tests",
        tags: ["E2E"],
        response: {
          200: z.object({ success: z.literal(true) }),
        },
      },
    },
    async (request, reply) => {
      if (!config.test.enableE2eTestEndpoints) {
        throw new ApiError(404, "Not found");
      }

      await OrganizationModel.patch(request.organizationId, {
        onboardingComplete: false,
      });
      await db
        .delete(schema.mailSettingsTable)
        .where(eq(schema.mailSettingsTable.organizationId, request.organizationId));

      return reply.send({ success: true });
    },
  );
};

export default e2eTestRoutes;
