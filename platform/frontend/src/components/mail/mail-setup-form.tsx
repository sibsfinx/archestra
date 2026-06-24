"use client";

import { E2eTestId } from "@archestra/shared";
import { SettingsCardHeader } from "@/components/settings/settings-block";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MailDraftState, MailProvider } from "@/lib/mail-settings-form";
import type { MailSettings, MailTlsMode } from "@/lib/mail-settings.query";

type MailSetupFormProps = {
  settings: MailSettings;
  effective: MailDraftState;
  updateDraft: (patch: Partial<MailDraftState>) => void;
  variant?: "settings" | "onboarding";
  showProviderSelection?: boolean;
  showTestSection?: boolean;
  showEnvOverrideAlert?: boolean;
  idPrefix?: string;
  defaultRecipient?: string;
  testRecipient?: string | null;
  setTestRecipient?: (value: string | null) => void;
  showTestRecipient?: boolean;
  setShowTestRecipient?: (value: boolean | ((prev: boolean) => boolean)) => void;
  onTest?: () => void;
  testDisabled?: boolean;
  isTesting?: boolean;
  hasChanges?: boolean;
};

export function MailSetupForm({
  settings,
  effective,
  updateDraft,
  variant = "settings",
  showProviderSelection = true,
  showTestSection = true,
  showEnvOverrideAlert = true,
  idPrefix = "",
  defaultRecipient = "",
  testRecipient = null,
  setTestRecipient,
  showTestRecipient = false,
  setShowTestRecipient,
  onTest,
  testDisabled = false,
  isTesting = false,
  hasChanges = false,
}: MailSetupFormProps) {
  const fieldId = (name: string) => `${idPrefix}${name}`;

  return (
    <div className="space-y-4">
      {showEnvOverrideAlert && settings.overriddenByEnv && (
        <Alert data-testid={E2eTestId.MailSettingsEnvOverrideAlert}>
          <AlertDescription>
            Mail settings are partially overridden by environment variables.
            Changes saved here may have no effect until those variables are
            removed.
          </AlertDescription>
        </Alert>
      )}

      {showProviderSelection && (
        <Card>
          <SettingsCardHeader
            title="Provider"
            description="Choose how Archestra sends transactional email."
          />
          <CardContent className="pt-6 border-t space-y-4">
            <RadioGroup
              value={effective.provider}
              onValueChange={(value) =>
                updateDraft({ provider: value as MailProvider })
              }
              className="grid gap-3 sm:grid-cols-2"
            >
              <label
                htmlFor={fieldId("mail-provider-log")}
                className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer"
              >
                <RadioGroupItem
                  value="log"
                  id={fieldId("mail-provider-log")}
                />
                <div>
                  <p className="font-medium">Log (development)</p>
                  <p className="text-sm text-muted-foreground">
                    Emails are printed to server logs. Not suitable for
                    production.
                  </p>
                </div>
              </label>
              <label
                htmlFor={fieldId("mail-provider-smtp")}
                className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer"
              >
                <RadioGroupItem
                  value="smtp"
                  id={fieldId("mail-provider-smtp")}
                  data-testid={E2eTestId.MailSettingsProviderSmtp}
                />
                <div>
                  <p className="font-medium">SMTP</p>
                  <p className="text-sm text-muted-foreground">
                    Send via any SMTP relay (Postfix, SES, Gmail, etc.).
                  </p>
                </div>
              </label>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {effective.provider === "smtp" && (
        <Card>
          <SettingsCardHeader
            title="SMTP server"
            description={
              variant === "onboarding"
                ? "Defaults to localhost for a local Postfix relay."
                : "Connection settings for your mail relay."
            }
          />
          <CardContent className="pt-6 border-t grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={fieldId("smtp-host")}>SMTP host</Label>
              <Input
                id={fieldId("smtp-host")}
                value={effective.smtpHost}
                onChange={(e) => updateDraft({ smtpHost: e.target.value })}
                placeholder="localhost"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("smtp-port")}>Port</Label>
              <Input
                id={fieldId("smtp-port")}
                type="number"
                value={effective.smtpPort}
                onChange={(e) => updateDraft({ smtpPort: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("smtp-tls")}>TLS mode</Label>
              <Select
                value={effective.smtpTlsMode}
                onValueChange={(value) =>
                  updateDraft({ smtpTlsMode: value as MailTlsMode })
                }
              >
                <SelectTrigger id={fieldId("smtp-tls")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="starttls">STARTTLS</SelectItem>
                  <SelectItem value="tls">TLS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("smtp-username")}>Username</Label>
              <Input
                id={fieldId("smtp-username")}
                value={effective.smtpUsername}
                onChange={(e) => updateDraft({ smtpUsername: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fieldId("smtp-password")}>Password</Label>
              <Input
                id={fieldId("smtp-password")}
                type="password"
                value={effective.smtpPassword}
                onChange={(e) => updateDraft({ smtpPassword: e.target.value })}
                placeholder={
                  settings.smtp?.passwordConfigured ? "••••••••" : ""
                }
                autoComplete="new-password"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <SettingsCardHeader
          title="Sender"
          description="From address used for outbound email."
        />
        <CardContent className="pt-6 border-t grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={fieldId("from-address")}>From address</Label>
            <Input
              id={fieldId("from-address")}
              type="email"
              value={effective.fromAddress}
              onChange={(e) => updateDraft({ fromAddress: e.target.value })}
              placeholder="noreply@yourdomain.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={fieldId("from-name")}>From name</Label>
            <Input
              id={fieldId("from-name")}
              value={effective.fromName}
              onChange={(e) => updateDraft({ fromName: e.target.value })}
              placeholder="Archestra"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={fieldId("reply-to")}>Reply-To</Label>
            <Input
              id={fieldId("reply-to")}
              type="email"
              value={effective.replyTo}
              onChange={(e) => updateDraft({ replyTo: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {showTestSection && onTest && setShowTestRecipient && setTestRecipient && (
        <Card>
          <SettingsCardHeader
            title="Test email"
            description="Send a test using saved settings. Save changes before testing."
          />
          <CardContent className="pt-6 border-t space-y-3">
            {showTestRecipient ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={fieldId("test-recipient")}>Recipient</Label>
                  <Input
                    id={fieldId("test-recipient")}
                    type="email"
                    value={testRecipient ?? defaultRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowTestRecipient(false)}
                >
                  Use default
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Send to{" "}
                {testRecipient ?? defaultRecipient ?? "your account email"}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid={E2eTestId.MailSettingsTestEmailButton}
                onClick={onTest}
                disabled={testDisabled || !defaultRecipient}
              >
                {isTesting ? "Sending..." : "Send test email"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowTestRecipient((v) => !v)}
              >
                Change recipient
              </Button>
            </div>
            {hasChanges && (
              <p className="text-sm text-muted-foreground">
                Save your settings before sending a test email.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
