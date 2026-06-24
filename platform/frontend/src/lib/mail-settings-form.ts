import type {
  MailSettings,
  MailTlsMode,
  UpdateMailSettingsBody,
} from "@/lib/mail-settings.query";

export type MailProvider = "log" | "smtp";

export type MailDraftState = {
  provider: MailProvider;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: string;
  smtpTlsMode: MailTlsMode;
  smtpUsername: string;
  smtpPassword: string;
};

export const LOCAL_SMTP_PRESET: Partial<MailDraftState> = {
  provider: "smtp",
  smtpHost: "localhost",
  smtpPort: "25",
  smtpTlsMode: "none",
  fromAddress: "noreply@localhost",
};

export function settingsToDraft(
  settings: MailSettings,
  options?: { preset?: "local" | "default" },
): MailDraftState {
  const base: MailDraftState = {
    provider: settings.provider,
    fromAddress: settings.fromAddress ?? "",
    fromName: settings.fromName ?? "",
    replyTo: settings.replyTo ?? "",
    smtpHost: settings.smtp?.host ?? "",
    smtpPort: settings.smtp?.port?.toString() ?? "587",
    smtpTlsMode: settings.smtp?.tlsMode ?? "starttls",
    smtpUsername: settings.smtp?.username ?? "",
    smtpPassword: "",
  };

  if (
    options?.preset === "local" &&
    settings.provider === "log" &&
    !settings.fromAddress
  ) {
    return { ...base, ...LOCAL_SMTP_PRESET };
  }

  return base;
}

export function canSaveDraft(draft: MailDraftState): boolean {
  if (draft.provider === "smtp") {
    return (
      draft.fromAddress.trim() !== "" &&
      draft.smtpHost.trim() !== "" &&
      draft.smtpPort.trim() !== ""
    );
  }
  return true;
}

export function draftToUpdateBody(
  draft: MailDraftState,
): UpdateMailSettingsBody {
  if (draft.provider === "smtp") {
    return {
      provider: "smtp",
      fromAddress: draft.fromAddress.trim(),
      fromName: draft.fromName.trim() || undefined,
      replyTo: draft.replyTo.trim() || undefined,
      smtp: {
        host: draft.smtpHost.trim(),
        port: Number.parseInt(draft.smtpPort, 10),
        tlsMode: draft.smtpTlsMode,
        username: draft.smtpUsername.trim() || undefined,
        password: draft.smtpPassword.trim() || undefined,
      },
    };
  }

  return {
    provider: "log",
    fromAddress: draft.fromAddress.trim() || undefined,
    fromName: draft.fromName.trim() || undefined,
    replyTo: draft.replyTo.trim() || undefined,
  };
}

export function isMailSettingsConfigured(settings: MailSettings): boolean {
  if (settings.overriddenByEnv) return true;
  if (settings.provider === "log" || !settings.fromAddress?.trim()) return false;
  if (settings.provider === "smtp") {
    return Boolean(settings.smtp?.host?.trim());
  }
  return true;
}
