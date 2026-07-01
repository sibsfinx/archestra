import config from "@/config";
import MailSettingsModel from "@/models/mail-settings";
import OrganizationModel from "@/models/organization";
import { parseMailFrom } from "./parse-from";
import type { MailProviderType } from "./types";

type ResolvedMailConfig = {
  provider: MailProviderType;
  from: string;
  smtp: {
    host: string;
    port: number;
    tlsMode: "none" | "starttls" | "tls";
    username?: string;
    password?: string;
    fromAddress: string;
    fromName?: string;
    replyTo?: string;
  } | null;
  overriddenByEnv: boolean;
};

function hasEnvMailProviderOverride(): boolean {
  return Boolean(process.env.ARCHESTRA_MAIL_PROVIDER?.trim());
}

function hasEnvSmtpOverrides(): boolean {
  return Boolean(
    process.env.ARCHESTRA_MAIL_SMTP_HOST?.trim() ||
      process.env.ARCHESTRA_MAIL_SMTP_PORT?.trim() ||
      process.env.ARCHESTRA_MAIL_SMTP_TLS_MODE?.trim() ||
      process.env.ARCHESTRA_MAIL_SMTP_USERNAME?.trim() ||
      process.env.ARCHESTRA_MAIL_SMTP_PASSWORD?.trim(),
  );
}

function hasEnvFromOverride(): boolean {
  return Boolean(process.env.ARCHESTRA_MAIL_FROM?.trim());
}

export function isMailOverriddenByEnv(): boolean {
  return (
    hasEnvMailProviderOverride() ||
    hasEnvSmtpOverrides() ||
    hasEnvFromOverride()
  );
}

export async function resolveMailConfig(
  organizationId?: string,
): Promise<ResolvedMailConfig> {
  const orgId =
    organizationId ??
    (await OrganizationModel.getFirst())?.id ??
    (await OrganizationModel.getOrCreateDefaultOrganization()).id;

  const dbSettings = await MailSettingsModel.getForOrg(orgId);
  const overriddenByEnv = isMailOverriddenByEnv();

  const provider = hasEnvMailProviderOverride()
    ? config.mail.provider
    : ((dbSettings?.provider as MailProviderType | undefined) ??
      config.mail.provider);

  const from = hasEnvFromOverride()
    ? config.mail.from
    : dbSettings?.fromAddress
      ? dbSettings.fromName
        ? `${dbSettings.fromName} <${dbSettings.fromAddress}>`
        : dbSettings.fromAddress
      : config.mail.from;

  const smtpFromDb = dbSettings?.smtp;
  const smtp =
    provider === "smtp"
      ? {
          host:
            process.env.ARCHESTRA_MAIL_SMTP_HOST?.trim() ||
            smtpFromDb?.host ||
            config.mail.smtp.host,
          port: process.env.ARCHESTRA_MAIL_SMTP_PORT
            ? Number.parseInt(process.env.ARCHESTRA_MAIL_SMTP_PORT, 10)
            : (smtpFromDb?.port ?? config.mail.smtp.port),
          tlsMode: (process.env.ARCHESTRA_MAIL_SMTP_TLS_MODE?.trim() ||
            smtpFromDb?.tlsMode ||
            config.mail.smtp.tlsMode) as "none" | "starttls" | "tls",
          username:
            process.env.ARCHESTRA_MAIL_SMTP_USERNAME?.trim() ||
            smtpFromDb?.username ||
            config.mail.smtp.username ||
            undefined,
          password:
            process.env.ARCHESTRA_MAIL_SMTP_PASSWORD?.trim() ||
            smtpFromDb?.password ||
            config.mail.smtp.password ||
            undefined,
          fromAddress:
            dbSettings?.fromAddress || parseMailFrom(from)?.email || from,
          fromName: dbSettings?.fromName || parseMailFrom(from)?.name,
          replyTo: dbSettings?.replyTo || undefined,
        }
      : null;

  return {
    provider,
    from,
    smtp,
    overriddenByEnv,
  };
}
