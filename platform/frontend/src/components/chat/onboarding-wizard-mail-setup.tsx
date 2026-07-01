"use client";

import { E2eTestId } from "@archestra/shared";
import { LoadingSpinner } from "@/components/loading";
import { MailSetupForm } from "@/components/mail/mail-setup-form";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth.query";
import type { MailSettings } from "@/lib/mail-settings.query";
import { useMailSettings } from "@/lib/mail-settings.query";
import { useMailSettingsDraft } from "@/lib/use-mail-settings-draft";

const UNCONFIGURED_MAIL_SETTINGS: MailSettings = {
  provider: "log",
  fromAddress: null,
  fromName: null,
  replyTo: null,
  smtp: null,
  verifiedAt: null,
  overriddenByEnv: false,
};

export function OnboardingWizardMailSetup() {
  const { data: session } = useSession();
  const { data: settings, isPending } = useMailSettings();
  const defaultRecipient = session?.user?.email ?? "";
  const draft = useMailSettingsDraft({
    settings: settings ?? UNCONFIGURED_MAIL_SETTINGS,
    preset: "local",
  });

  const handleTest = async () => {
    const to = draft.testRecipient ?? defaultRecipient;
    if (!to) return;
    await draft.handleTest(to);
  };

  if (isPending && !settings) {
    return <LoadingSpinner />;
  }

  return (
    <div
      data-testid={E2eTestId.OnboardingMailStep}
      className="space-y-5 overflow-y-auto pr-1"
    >
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Set up outbound mail</h2>
        <p className="text-sm text-muted-foreground">
          Configure SMTP so password reset and invitation emails can leave this
          workspace. Local installs default to a localhost relay.
        </p>
      </div>

      <MailSetupForm
        settings={settings ?? UNCONFIGURED_MAIL_SETTINGS}
        effective={draft.effective}
        updateDraft={draft.updateDraft}
        variant="onboarding"
        showProviderSelection={false}
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

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid={E2eTestId.OnboardingMailSaveButton}
          onClick={draft.handleSave}
          disabled={!draft.canSave || draft.isSaving}
        >
          {draft.isSaving ? "Saving..." : "Save mail settings"}
        </Button>
        <Button type="button" variant="outline" onClick={draft.resetDraft}>
          Reset
        </Button>
      </div>
    </div>
  );
}
