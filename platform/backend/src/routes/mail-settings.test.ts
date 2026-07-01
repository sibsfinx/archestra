import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("mail settings routes", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let user: User;
  const originalMailEnv = { ...process.env };

  beforeEach(async ({ makeAdmin, makeOrganization }) => {
    process.env = { ...originalMailEnv };
    delete process.env.ARCHESTRA_MAIL_PROVIDER;
    delete process.env.ARCHESTRA_MAIL_FROM;
    delete process.env.ARCHESTRA_MAIL_SMTP_HOST;
    delete process.env.ARCHESTRA_MAIL_SMTP_PORT;
    delete process.env.ARCHESTRA_MAIL_SMTP_TLS_MODE;
    delete process.env.ARCHESTRA_MAIL_SMTP_USERNAME;
    delete process.env.ARCHESTRA_MAIL_SMTP_PASSWORD;
    user = await makeAdmin();
    const organization = await makeOrganization();
    organizationId = organization.id;

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (
        request as typeof request & {
          organizationId: string;
          user: User;
        }
      ).organizationId = organizationId;
      (request as typeof request & { user: User }).user = user;
    });

    const { default: mailSettingsRoutes } = await import("./mail-settings");
    await app.register(mailSettingsRoutes);
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...originalMailEnv };
  });

  test("returns default log settings without secrets", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/mail/settings",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "log",
      fromAddress: null,
      smtp: null,
      overriddenByEnv: false,
    });
    expect(response.json()).not.toHaveProperty("smtpPassword");
  });

  test("upserts SMTP settings and masks password on read", async () => {
    const putResponse = await app.inject({
      method: "PUT",
      url: "/api/mail/settings",
      payload: {
        provider: "smtp",
        fromAddress: "noreply@example.com",
        fromName: "Archestra",
        smtp: {
          host: "smtp.example.com",
          port: 587,
          tlsMode: "starttls",
          username: "smtp-user",
          password: "super-secret",
        },
      },
    });

    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toMatchObject({
      provider: "smtp",
      fromAddress: "noreply@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        passwordConfigured: true,
      },
    });
    expect(putResponse.json().smtp).not.toHaveProperty("password");

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/mail/settings",
    });

    expect(getResponse.json().smtp.passwordConfigured).toBe(true);
  });

  test("reports unconfigured mail status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/mail/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false,
      verified: false,
    });
  });

  test("env smtp provider without host is not configured", async () => {
    process.env.ARCHESTRA_MAIL_PROVIDER = "smtp";

    const response = await app.inject({
      method: "GET",
      url: "/api/mail/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false,
      overriddenByEnv: true,
    });
  });

  test("env smtp with host and from is configured", async () => {
    process.env.ARCHESTRA_MAIL_PROVIDER = "smtp";
    process.env.ARCHESTRA_MAIL_SMTP_HOST = "smtp.example.com";
    process.env.ARCHESTRA_MAIL_FROM = "noreply@example.com";

    const response = await app.inject({
      method: "GET",
      url: "/api/mail/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: true,
      overriddenByEnv: true,
    });
  });

  test("test endpoint rejects log provider", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/mail/test",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
    });
  });
});
