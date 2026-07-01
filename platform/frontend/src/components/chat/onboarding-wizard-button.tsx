"use client";

import { E2eTestId } from "@archestra/shared";
import { BookOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMailStatus } from "@/lib/mail-settings.query";
import type { OnboardingWizardDialogWizard } from "./onboarding-wizard-dialog";
import { OnboardingWizardDialog } from "./onboarding-wizard-dialog";

interface OnboardingWizardButtonProps {
  wizard?: OnboardingWizardDialogWizard | null;
  enableMailSetup?: boolean;
}

export function OnboardingWizardButton({
  wizard,
  enableMailSetup = false,
}: OnboardingWizardButtonProps) {
  const [open, setOpen] = useState(false);
  const [includeMailSetupInDialog, setIncludeMailSetupInDialog] =
    useState(false);
  const { data: mailStatus } = useMailStatus({
    enabled: enableMailSetup,
  });
  const hasWizardPages = (wizard?.pages.length ?? 0) > 0;
  const shouldOfferMailSetup =
    enableMailSetup && mailStatus !== undefined && !mailStatus.configured;
  const label = hasWizardPages
    ? wizard?.label?.trim() || "Open wizard"
    : "Set up outbound mail";

  if (!open && !hasWizardPages && !shouldOfferMailSetup) {
    return null;
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setIncludeMailSetupInDialog(shouldOfferMailSetup);
    } else {
      setIncludeMailSetupInDialog(false);
    }
    setOpen(nextOpen);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        data-testid={E2eTestId.OnboardingWizardButton}
        onClick={() => handleOpenChange(true)}
      >
        <BookOpen className="h-4 w-4" />
        {label}
      </Button>
      <OnboardingWizardDialog
        mode="runtime"
        open={open}
        onOpenChange={handleOpenChange}
        wizard={wizard ?? { label, pages: [] }}
        showMailSetup={includeMailSetupInDialog}
      />
    </>
  );
}
