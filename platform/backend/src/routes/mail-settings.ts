import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { sendTransactionalEmail } from "@/mail/send-transactional";
import {
  isMailOverriddenByEnv,
  resolveMailConfig,
} from "@/mail/resolve-mail-config";
import MailSettingsModel from "@/models/mail-settings";
import { ApiError, constructResponseSchema } from "@/types";

const tlsModeSchema = z.enum(["none", "starttls", "tls"]);

const mailSettingsResponseSchema = z.object({
  provider: z.enum(["log", "smtp"]),
  fromAddress: z.string().nullable(),
  fromName: z.string().nullable(),
  replyTo: z.string().nullable(),
  smtp: z
    .object({
      host: z.string().nullable(),
      port: z.number().nullable(),
      tlsMode: tlsModeSchema,
      username: z.string().nullable(),
      passwordConfigured: z.boolean(),
    })
    .nullable(),
  verifiedAt: z.string().nullable(),
  overriddenByEnv: z.boolean(),
});

const putMailSettingsSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("smtp"),
    fromAddress: z.string().email(),
    fromName: z.string().optional(),
    replyTo: z.string().email().optional(),
    smtp: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      tlsMode: tlsModeSchema,
      username: z.string().optional(),
      password: z.string().optional(),
    }),
  }),
  z.object({
    provider: z.literal("log"),
    fromAddress: z.string().email().optional(),
    fromName: z.string().optional(),
    replyTo: z.string().email().optional(),
  }),
]);

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/mail/settings",
    {
      schema: {
        operationId: RouteId.GetMailSettings,
        description: "Get outbound mail settings for the current organization",
        tags: ["Mail"],
        response: constructResponseSchema(mailSettingsResponseSchema),
      },
    },
    async (request, reply) => {
      const overriddenByEnv = isMailOverriddenByEnv();
      const settings = await MailSettingsModel.getPublicForOrg(
        request.organizationId,
        overriddenByEnv,
      );
      return reply.send(settings);
    },
  );

  app.put(
    "/api/mail/settings",
    {
      schema: {
        operationId: RouteId.UpdateMailSettings,
        description: "Update outbound mail settings for the current organization",
        tags: ["Mail"],
        body: putMailSettingsSchema,
        response: constructResponseSchema(mailSettingsResponseSchema),
      },
    },
    async (request, reply) => {
      const settings = await MailSettingsModel.upsert(
        request.organizationId,
        request.body,
      );
      return reply.send(settings);
    },
  );

  app.get(
    "/api/mail/status",
    {
      schema: {
        operationId: RouteId.GetMailStatus,
        description: "Get outbound mail configuration status",
        tags: ["Mail"],
        response: constructResponseSchema(
          z.object({
            configured: z.boolean(),
            verified: z.boolean(),
            overriddenByEnv: z.boolean(),
          }),
        ),
      },
    },
    async (request, reply) => {
      const overriddenByEnv = isMailOverriddenByEnv();
      const status = await MailSettingsModel.getStatus(
        request.organizationId,
        overriddenByEnv,
      );
      return reply.send(status);
    },
  );

  app.post(
    "/api/mail/test",
    {
      schema: {
        operationId: RouteId.TestMailSettings,
        description: "Send a test email using saved mail settings",
        tags: ["Mail"],
        body: z.object({
          to: z.string().email().optional(),
        }),
        response: constructResponseSchema(
          z.object({
            success: z.boolean(),
            error: z.string().optional(),
            durationMs: z.number(),
          }),
        ),
      },
    },
    async (request, reply) => {
      const startedAt = Date.now();
      const to = request.body.to ?? request.user.email;

      if (!to) {
        throw new ApiError(400, "Recipient email is required");
      }

      const mailConfig = await resolveMailConfig(request.organizationId);
      if (mailConfig.provider !== "smtp") {
        return reply.send({
          success: false,
          error: "Configure SMTP and save settings before sending a test email",
          durationMs: Date.now() - startedAt,
        });
      }

      try {
        await sendTransactionalEmail(
          {
            to,
            subject: "Archestra test email",
            text: "This is a test email from your Archestra installation. If you received this, outbound mail is working.",
            html: "<p>This is a test email from your Archestra installation. If you received this, outbound mail is working.</p>",
          },
          {
            organizationId: request.organizationId,
            throwOnError: true,
          },
        );
        await MailSettingsModel.markVerified(request.organizationId);
        return reply.send({
          success: true,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        return reply.send({
          success: false,
          error: error instanceof Error ? error.message : "Failed to send test email",
          durationMs: Date.now() - startedAt,
        });
      }
    },
  );
};

export default routes;
