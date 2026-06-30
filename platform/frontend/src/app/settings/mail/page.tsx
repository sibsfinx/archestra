"use client";

import { LoadingSpinner } from "@/components/loading";
import { MailSetupForm } from "@/components/mail/mail-setup-form";
import {
  SettingsBlock,
  SettingsSaveBar,
  SettingsSectionStack,
} from "@/components/settings/settings-block";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth/auth.query";
import { useMailSettings, useMailStatus } from "@/lib/mail-settings.query";
import { useMailSettingsDraft } from "@/lib/use-mail-settings-draft";
import { formatDate } from "@/lib/utils";

function statusBadge(
  settings: NonNullable<ReturnType<typeof useMailSettings>["data"]>,
  status: { configured: boolean; verified: boolean } | undefined,
) {
  const configured =
    status?.configured ??
    (settings.overriddenByEnv ||
      (settings.provider !== "log" && Boolean(settings.fromAddress)));

  if (!configured) {
    return <Badge variant="destructive">Not configured</Badge>;
  }
  if (status?.verified || settings.verifiedAt) {
    return (
      <Badge variant="default">
        Verified{" "}
        {settings.verifiedAt
          ? formatDate({ date: settings.verifiedAt })
          : "via environment"}
      </Badge>
    );
  }
  return <Badge variant="secondary">Configured, unverified</Badge>;
}

export default function MailSettingsPage() {
  const { data: session } = useSession();
  const { data: settings, isPending } = useMailSettings();
  const { data: mailStatus } = useMailStatus();
  const defaultRecipient = session?.user?.email ?? "";

  const draft = useMailSettingsDraft({
    settings: settings ?? {
      provider: "log",
      fromAddress: null,
      fromName: null,
      replyTo: null,
      smtp: null,
      verifiedAt: null,
      overriddenByEnv: false,
    },
    preset: "default",
  });

  const handleTest = async () => {
    const to = draft.testRecipient ?? defaultRecipient;
    if (!to) return;
    await draft.handleTest(to);
  };

  if (isPending && !settings) {
    return <LoadingSpinner />;
  }

  if (!settings) {
    return <LoadingSpinner />;
  }

  return (
    <SettingsSectionStack>
      <SettingsBlock
        title="Outbound mail"
        description="Configure SMTP for password reset and invitation emails."
        control={statusBadge(settings, mailStatus)}
      />

      <MailSetupForm
        settings={settings}
        effective={draft.effective}
        updateDraft={draft.updateDraft}
        variant="settings"
        defaultRecipient={defaultRecipient}
        testRecipient={draft.testRecipient}
        setTestRecipient={draft.setTestRecipient}
        showTestRecipient={draft.showTestRecipient}
        setShowTestRecipient={draft.setShowTestRecipient}
        onTest={handleTest}
        testDisabled={draft.testDisabled}
        isTesting={draft.isTesting}
        hasChanges={draft.hasChanges}
      />

      <SettingsSaveBar
        hasChanges={draft.hasChanges}
        isSaving={draft.isSaving}
        permissions={{ organizationSettings: ["update"] }}
        onSave={draft.handleSave}
        onCancel={draft.resetDraft}
        disabledSave={!draft.canSave}
      />
    </SettingsSectionStack>
  );
}
