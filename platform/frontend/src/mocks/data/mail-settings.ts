export type MailSettingsMock = {
  provider: "log" | "smtp";
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  smtp: {
    host: string | null;
    port: number | null;
    tlsMode: "none" | "starttls" | "tls";
    username: string | null;
    passwordConfigured: boolean;
  } | null;
  verifiedAt: string | null;
  overriddenByEnv: boolean;
};

export type MailStatusMock = {
  configured: boolean;
  verified: boolean;
  overriddenByEnv: boolean;
};

export const unconfiguredMailSettingsSeed: MailSettingsMock = {
  provider: "log",
  fromAddress: null,
  fromName: null,
  replyTo: null,
  smtp: null,
  verifiedAt: null,
  overriddenByEnv: false,
};

export const unconfiguredMailStatusSeed: MailStatusMock = {
  configured: false,
  verified: false,
  overriddenByEnv: false,
};

export function makeSmtpMailSettings(
  overrides: Partial<MailSettingsMock> = {},
): MailSettingsMock {
  return {
    provider: "smtp",
    fromAddress: "noreply@example.com",
    fromName: "Archestra",
    replyTo: null,
    smtp: {
      host: "smtp.example.com",
      port: 587,
      tlsMode: "starttls",
      username: "smtp-user",
      passwordConfigured: true,
    },
    verifiedAt: null,
    overriddenByEnv: false,
    ...overrides,
  };
}

export function makeConfiguredMailStatus(
  overrides: Partial<MailStatusMock> = {},
): MailStatusMock {
  return {
    configured: true,
    verified: true,
    overriddenByEnv: false,
    ...overrides,
  };
}
