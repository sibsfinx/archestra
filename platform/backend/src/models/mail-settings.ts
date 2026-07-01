import { eq } from "drizzle-orm";
import db, { schema } from "@/database";
import logger from "@/logging";
import {
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecret,
} from "@/utils/crypto";

type MailTlsMode = "none" | "starttls" | "tls";
type StoredMailProvider = "log" | "smtp";

type MailSettingsRecord = {
  id: string;
  organizationId: string;
  provider: StoredMailProvider;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpTlsMode: MailTlsMode;
  smtpUsername: string | null;
  smtpPassword: string | null;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MailSettingsPublic = {
  provider: StoredMailProvider;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  smtp: {
    host: string | null;
    port: number | null;
    tlsMode: MailTlsMode;
    username: string | null;
    passwordConfigured: boolean;
  } | null;
  verifiedAt: string | null;
  overriddenByEnv: boolean;
};

type MailStatus = {
  configured: boolean;
  verified: boolean;
  overriddenByEnv: boolean;
};

type UpsertMailSettingsInput =
  | {
      provider: "smtp";
      fromAddress: string;
      fromName?: string;
      replyTo?: string;
      smtp: {
        host: string;
        port: number;
        tlsMode: MailTlsMode;
        username?: string;
        password?: string;
      };
    }
  | {
      provider: "log";
      fromAddress?: string;
      fromName?: string;
      replyTo?: string;
    };

type DecryptedSmtpSecrets = {
  host: string;
  port: number;
  tlsMode: MailTlsMode;
  username?: string;
  password?: string;
};

function encryptString(value: string): string {
  return JSON.stringify(encryptSecretValue({ value }));
}

function decryptString(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isEncryptedSecret(parsed)) {
      return stored;
    }
    const decrypted = decryptSecretValue(parsed);
    return typeof decrypted.value === "string" ? decrypted.value : null;
  } catch {
    return null;
  }
}

function serializeEncryptedField(value: string | null): string | null {
  if (!value) return null;
  return encryptString(value);
}

class MailSettingsModel {
  static async getForOrg(organizationId: string): Promise<
    | (MailSettingsRecord & {
        smtp: DecryptedSmtpSecrets | null;
      })
    | null
  > {
    const [row] = await db
      .select()
      .from(schema.mailSettingsTable)
      .where(eq(schema.mailSettingsTable.organizationId, organizationId))
      .limit(1);

    if (!row) return null;

    return {
      ...row,
      provider: row.provider as StoredMailProvider,
      smtpTlsMode: row.smtpTlsMode as MailTlsMode,
      smtpPassword: row.smtpPassword,
      smtp:
        row.provider === "smtp" && row.smtpHost && row.smtpPort
          ? {
              host: row.smtpHost,
              port: row.smtpPort,
              tlsMode: row.smtpTlsMode as MailTlsMode,
              username: row.smtpUsername ?? undefined,
              password: decryptString(row.smtpPassword) ?? undefined,
            }
          : null,
    };
  }

  static async getPublicForOrg(
    organizationId: string,
    overriddenByEnv: boolean,
  ): Promise<MailSettingsPublic> {
    const row = await MailSettingsModel.getRawForOrg(organizationId);
    if (!row) {
      return {
        provider: "log",
        fromAddress: null,
        fromName: null,
        replyTo: null,
        smtp: null,
        verifiedAt: null,
        overriddenByEnv,
      };
    }

    return {
      provider: row.provider as StoredMailProvider,
      fromAddress: row.fromAddress,
      fromName: row.fromName,
      replyTo: row.replyTo,
      smtp:
        row.provider === "smtp"
          ? {
              host: row.smtpHost,
              port: row.smtpPort,
              tlsMode: row.smtpTlsMode as MailTlsMode,
              username: row.smtpUsername,
              passwordConfigured: Boolean(row.smtpPassword),
            }
          : null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      overriddenByEnv,
    };
  }

  static async getStatus(
    organizationId: string,
    overriddenByEnv: boolean,
  ): Promise<MailStatus> {
    const row = await MailSettingsModel.getRawForOrg(organizationId);
    const provider = (row?.provider as StoredMailProvider | undefined) ?? "log";
    const dbConfigured =
      provider !== "log" &&
      Boolean(row?.fromAddress?.trim()) &&
      (provider !== "smtp" || Boolean(row?.smtpHost?.trim()));

    return {
      configured: overriddenByEnv
        ? MailSettingsModel.isEnvMailConfigured()
        : dbConfigured,
      verified: Boolean(row?.verifiedAt),
      overriddenByEnv,
    };
  }

  static isEnvMailConfigured(): boolean {
    const provider = process.env.ARCHESTRA_MAIL_PROVIDER?.trim().toLowerCase();
    if (!provider || provider === "log") {
      return false;
    }
    if (provider === "smtp") {
      return Boolean(
        process.env.ARCHESTRA_MAIL_SMTP_HOST?.trim() &&
          process.env.ARCHESTRA_MAIL_FROM?.trim(),
      );
    }
    return true;
  }

  static async upsert(
    organizationId: string,
    data: UpsertMailSettingsInput,
  ): Promise<MailSettingsPublic> {
    logger.debug(
      { organizationId, provider: data.provider },
      "MailSettingsModel.upsert",
    );

    const existing = await MailSettingsModel.getRawForOrg(organizationId);
    const now = new Date();
    const id = existing?.id ?? crypto.randomUUID();

    const baseValues = {
      id,
      organizationId,
      provider: data.provider,
      fromAddress: "fromAddress" in data ? (data.fromAddress ?? null) : null,
      fromName: "fromName" in data ? (data.fromName ?? null) : null,
      replyTo: "replyTo" in data ? (data.replyTo ?? null) : null,
      smtpHost: null as string | null,
      smtpPort: null as number | null,
      smtpTlsMode: "none" as MailTlsMode,
      smtpUsername: null as string | null,
      smtpPassword: null as string | null,
      verifiedAt: null as Date | null,
      updatedAt: now,
    };

    if (data.provider === "smtp") {
      baseValues.smtpHost = data.smtp.host;
      baseValues.smtpPort = data.smtp.port;
      baseValues.smtpTlsMode = data.smtp.tlsMode;
      baseValues.smtpUsername = data.smtp.username ?? null;
      baseValues.smtpPassword = data.smtp.password
        ? serializeEncryptedField(data.smtp.password)
        : (existing?.smtpPassword ?? null);
    } else {
      baseValues.smtpHost = null;
      baseValues.smtpPort = null;
      baseValues.smtpUsername = null;
      baseValues.smtpPassword = null;
    }

    if (existing) {
      await db
        .update(schema.mailSettingsTable)
        .set(baseValues)
        .where(eq(schema.mailSettingsTable.id, existing.id));
    } else {
      await db.insert(schema.mailSettingsTable).values({
        ...baseValues,
        createdAt: now,
      });
    }

    const { isMailOverriddenByEnv } = await import(
      "@/mail/resolve-mail-config"
    );
    return MailSettingsModel.getPublicForOrg(
      organizationId,
      isMailOverriddenByEnv(),
    );
  }

  static async markVerified(organizationId: string): Promise<void> {
    const existing = await MailSettingsModel.getRawForOrg(organizationId);
    if (!existing) return;

    await db
      .update(schema.mailSettingsTable)
      .set({ verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.mailSettingsTable.id, existing.id));
  }

  private static async getRawForOrg(organizationId: string) {
    const [row] = await db
      .select()
      .from(schema.mailSettingsTable)
      .where(eq(schema.mailSettingsTable.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }
}

export default MailSettingsModel;
