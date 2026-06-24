"use client";

import { E2eTestId } from "@shared";
import {
  ArrowRight,
  Bot,
  Layers,
  Mail,
  MessageSquare,
  Network,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { MailSetupForm } from "@/components/mail/mail-setup-form";
import { LoadingSpinner } from "@/components/loading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHasPermissions, useSession } from "@/lib/auth/auth.query";
import { useAppName } from "@/lib/hooks/use-app-name";
import {
  type MailSettings,
  useMailSettings,
  useMailStatus,
} from "@/lib/mail-settings.query";
import { useCompleteOnboarding } from "@/lib/organization.query";
import { useMailSettingsDraft } from "@/lib/use-mail-settings-draft";
import { cn } from "@/lib/utils";

interface AlternativeOnboardingDialogProps {
  open: boolean;
}

type OnboardingStep = "welcome" | "mail";

const UNCONFIGURED_MAIL_SETTINGS: MailSettings = {
  provider: "log",
  fromAddress: null,
  fromName: null,
  replyTo: null,
  smtp: null,
  verifiedAt: null,
  overriddenByEnv: false,
};

export function AlternativeOnboardingDialog({
  open,
}: AlternativeOnboardingDialogProps) {
  const appName = useAppName();
  const { data: session } = useSession();
  const { data: canUpdateOrgSettings } = useHasPermissions({
    organizationSettings: ["update"],
  });
  const { data: mailStatus } = useMailStatus({
    enabled: canUpdateOrgSettings === true,
  });
  const { data: mailSettings, isPending: isMailSettingsPending } =
    useMailSettings({
      enabled: canUpdateOrgSettings === true,
    });

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [selectedOption, setSelectedOption] = useState<"proxy" | "chat" | null>(
    null,
  );
  const [isHovering, setIsHovering] = useState<"proxy" | "chat" | null>(null);
  const { mutate: completeOnboarding } = useCompleteOnboarding();

  const shouldShowMailStep = useMemo(() => {
    if (canUpdateOrgSettings !== true) return false;
    if (!mailStatus || mailStatus.overriddenByEnv) return false;
    return !mailStatus.configured;
  }, [canUpdateOrgSettings, mailStatus]);

  const mailDraft = useMailSettingsDraft({
    settings: mailSettings ?? UNCONFIGURED_MAIL_SETTINGS,
    preset: "local",
  });

  const defaultRecipient = session?.user?.email ?? "";

  const finishAndRedirect = useCallback(() => {
    if (selectedOption === "chat") {
      window.location.href = "/chat";
    } else if (selectedOption === "proxy") {
      window.location.href = "/connection";
    }
    completeOnboarding();
  }, [completeOnboarding, selectedOption]);

  const handleFinishOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        handleFinishOnboarding();
      }
    },
    [handleFinishOnboarding],
  );

  const handleOptionSelect = (option: "proxy" | "chat") => {
    setSelectedOption(option);
  };

  const handleContinueFromWelcome = () => {
    if (!selectedOption) return;
    if (shouldShowMailStep) {
      setStep("mail");
      return;
    }
    finishAndRedirect();
  };

  const handleSkipMail = () => {
    finishAndRedirect();
  };

  const handleContinueFromMail = () => {
    finishAndRedirect();
  };

  const handleSaveMail = async () => {
    await mailDraft.handleSave();
  };

  const handleTestMail = async () => {
    const to = mailDraft.testRecipient ?? defaultRecipient;
    if (!to) return;
    await mailDraft.handleTest(to);
  };

  const showMailStep = step === "mail";

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border-0">
        <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-background px-8 pt-8 pb-6">
          <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />
          <div className="relative">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-full bg-primary/10 animate-pulse">
                  {showMailStep ? (
                    <Mail className="h-5 w-5 text-primary" />
                  ) : (
                    <Sparkles className="h-5 w-5 text-primary" />
                  )}
                </div>
                <DialogTitle className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                  {showMailStep ? "Configure outbound email" : `Welcome to ${appName}`}
                </DialogTitle>
              </div>
              <DialogDescription className="text-base text-muted-foreground">
                {showMailStep
                  ? "Set up SMTP so password reset and invitation emails can be delivered."
                  : "Your unified platform for AI orchestration and tool integration"}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {showMailStep ? (
            <div
              className="space-y-4"
              data-testid={E2eTestId.OnboardingMailStep}
            >
              {isMailSettingsPending && !mailSettings ? (
                <LoadingSpinner />
              ) : mailSettings ? (
                <>
                  <MailSetupForm
                    settings={mailSettings}
                    effective={mailDraft.effective}
                    updateDraft={mailDraft.updateDraft}
                    variant="onboarding"
                    showProviderSelection={false}
                    showEnvOverrideAlert={false}
                    idPrefix="onboarding-"
                    defaultRecipient={defaultRecipient}
                    testRecipient={mailDraft.testRecipient}
                    setTestRecipient={mailDraft.setTestRecipient}
                    showTestRecipient={mailDraft.showTestRecipient}
                    setShowTestRecipient={mailDraft.setShowTestRecipient}
                    onTest={handleTestMail}
                    testDisabled={mailDraft.testDisabled}
                    isTesting={mailDraft.isTesting}
                    hasChanges={mailDraft.hasChanges}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={handleSaveMail}
                      disabled={!mailDraft.canSave || mailDraft.isSaving}
                      data-testid={E2eTestId.OnboardingMailSaveButton}
                    >
                      {mailDraft.isSaving ? "Saving..." : "Save mail settings"}
                    </Button>
                  </div>
                </>
              ) : (
                <LoadingSpinner />
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleOptionSelect("proxy")}
                  onMouseEnter={() => setIsHovering("proxy")}
                  onMouseLeave={() => setIsHovering(null)}
                  className={cn(
                    "relative group rounded-2xl border-2 p-6 text-left transition-all duration-300",
                    "hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1",
                    selectedOption === "proxy"
                      ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 shadow-lg"
                      : "border-muted-foreground/20 hover:border-primary/50 bg-card",
                  )}
                >
                  {selectedOption === "proxy" && (
                    <div className="absolute -top-2 -right-2 p-1 rounded-full bg-primary shadow-lg animate-in zoom-in-50">
                      <div className="h-4 w-4 rounded-full bg-primary-foreground flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div
                        className={cn(
                          "p-3 rounded-xl transition-all duration-300",
                          selectedOption === "proxy" || isHovering === "proxy"
                            ? "bg-primary/10 scale-110"
                            : "bg-muted",
                        )}
                      >
                        <Network
                          className={cn(
                            "h-6 w-6 transition-all duration-300",
                            selectedOption === "proxy" || isHovering === "proxy"
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="flex gap-1">
                        <Terminal className="h-4 w-4 text-muted-foreground/50" />
                        <Bot className="h-4 w-4 text-muted-foreground/50" />
                        <Layers className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors">
                        Secure your agent using LLM Gateway, or connect to the
                        unified MCP Gateway
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Route your existing AI agents through {appName}'s secure
                        infrastructure. Perfect for teams using N8N, Cursor, or
                        custom integrations.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleOptionSelect("chat")}
                  onMouseEnter={() => setIsHovering("chat")}
                  onMouseLeave={() => setIsHovering(null)}
                  className={cn(
                    "relative group rounded-2xl border-2 p-6 text-left transition-all duration-300",
                    "hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1",
                    selectedOption === "chat"
                      ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 shadow-lg"
                      : "border-muted-foreground/20 hover:border-primary/50 bg-card",
                  )}
                >
                  {selectedOption === "chat" && (
                    <div className="absolute -top-2 -right-2 p-1 rounded-full bg-primary shadow-lg animate-in zoom-in-50">
                      <div className="h-4 w-4 rounded-full bg-primary-foreground flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div
                        className={cn(
                          "p-3 rounded-xl transition-all duration-300",
                          selectedOption === "chat" || isHovering === "chat"
                            ? "bg-primary/10 scale-110"
                            : "bg-muted",
                        )}
                      >
                        <MessageSquare
                          className={cn(
                            "h-6 w-6 transition-all duration-300",
                            selectedOption === "chat" || isHovering === "chat"
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <Sparkles className="h-4 w-4 text-yellow-500/50 animate-pulse" />
                    </div>

                    <div>
                      <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors">
                        Use Chat Interface
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Access MCP servers directly through our intuitive chat
                        interface. Ideal for quick interactions and tool
                        exploration.
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {selectedOption && (
                <div className="animate-in slide-in-from-bottom-3 duration-500">
                  <div
                    className={cn(
                      "rounded-xl p-4 border transition-all duration-300",
                      "bg-gradient-to-r",
                      selectedOption === "proxy"
                        ? "from-blue-500/5 to-purple-500/5 border-blue-500/20"
                        : "from-orange-500/5 to-pink-500/5 border-orange-500/20",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "p-2 rounded-lg",
                          selectedOption === "proxy"
                            ? "bg-blue-500/10"
                            : "bg-orange-500/10",
                        )}
                      >
                        <ArrowRight
                          className={cn(
                            "h-4 w-4",
                            selectedOption === "proxy"
                              ? "text-blue-500"
                              : "text-orange-500",
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium mb-1">
                          Ready to get started?
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {shouldShowMailStep
                            ? "Next you'll configure outbound email, then continue to your chosen destination."
                            : selectedOption === "proxy"
                              ? "You'll be redirected to Settings to configure your LLM Proxy endpoints and MCP Gateway connections."
                              : "You'll be redirected to the Chat interface where you can immediately start using MCP tools."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-8 py-4 border-t bg-muted/30">
          {showMailStep ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleSkipMail}
                data-testid={E2eTestId.OnboardingSkipButton}
              >
                Configure later
              </Button>
              <Button
                type="button"
                onClick={handleContinueFromMail}
                size="lg"
                data-testid={E2eTestId.OnboardingFinishButton}
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <div />
              <Button
                onClick={handleContinueFromWelcome}
                size="lg"
                disabled={!selectedOption}
                className={cn(
                  "min-w-[160px] transition-all duration-300",
                  selectedOption && "shadow-lg hover:shadow-xl",
                )}
                data-testid={E2eTestId.OnboardingNextButton}
              >
                {selectedOption ? (
                  <>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4 animate-pulse" />
                  </>
                ) : (
                  "Select an option"
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
