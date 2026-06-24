import { E2eTestId } from "@shared/e2e-test-ids";
import { makeOrganization } from "../src/mocks/data/organization";
import {
  makeConfiguredMailStatus,
  makeSmtpMailSettings,
  unconfiguredMailSettingsSeed,
  unconfiguredMailStatusSeed,
} from "../src/mocks/data/mail-settings";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("Onboarding mail setup", () => {
  test("admin sees mail step with localhost SMTP defaults on first run", async ({
    page,
    onboardingMailPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: false }),
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: unconfiguredMailSettingsSeed,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: unconfiguredMailStatusSeed,
    });

    await page.goto("/chat");
    await onboardingMailPage.selectChatPath();
    await onboardingMailPage.continueFromWelcome();

    await expect(onboardingMailPage.mailStep).toBeVisible();
    await expect(page.getByLabel("SMTP host")).toHaveValue("localhost");
    await expect(page.getByLabel("Port")).toHaveValue("25");
    await expect(page.getByLabel("From address")).toHaveValue(
      "noreply@localhost",
    );
  });

  test("admin can save SMTP in onboarding and send a test email", async ({
    page,
    onboardingMailPage,
    mswControl,
  }) => {
    const saved = makeSmtpMailSettings({
      smtp: {
        host: "localhost",
        port: 25,
        tlsMode: "none",
        username: null,
        passwordConfigured: false,
      },
      fromAddress: "noreply@localhost",
    });
    const verified = makeSmtpMailSettings({
      ...saved,
      verifiedAt: "2026-06-12T12:00:00.000Z",
    });

    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: false }),
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: unconfiguredMailSettingsSeed,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: unconfiguredMailStatusSeed,
    });

    await page.goto("/chat");
    await onboardingMailPage.selectChatPath();
    await onboardingMailPage.continueFromWelcome();

    await mswControl.use({
      method: "put",
      url: "/api/mail/settings",
      body: saved,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: saved,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: makeConfiguredMailStatus({ verified: false }),
    });

    await onboardingMailPage.saveMailButton.click();
    await expect(page.getByText("Mail settings saved")).toBeVisible();

    await mswControl.use({
      method: "post",
      url: "/api/mail/test",
      body: { success: true, durationMs: 20 },
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: verified,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: makeConfiguredMailStatus(),
    });

    await onboardingMailPage.testEmailButton.click();
    await expect(page.getByText("Test email sent")).toBeVisible();
  });

  test("skipping onboarding mail still allows later settings configuration", async ({
    page,
    onboardingMailPage,
    mailSettingsPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: false }),
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: unconfiguredMailSettingsSeed,
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: unconfiguredMailStatusSeed,
    });
    await mswControl.use({
      method: "post",
      url: "/api/organization/complete-onboarding",
      body: makeOrganization({ onboardingComplete: true }),
    });

    await page.goto("/chat");
    await onboardingMailPage.selectChatPath();
    await onboardingMailPage.continueFromWelcome();
    await onboardingMailPage.skipButton.click();

    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: true }),
    });

    await mailSettingsPage.goto();
    await expect(page.getByText("Not configured")).toBeVisible();
    await mailSettingsPage.smtpProvider.click();
    await expect(page.getByLabel("SMTP host")).toBeVisible();
  });

  test("env override skips mail step during onboarding", async ({
    page,
    onboardingMailPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: false }),
    });
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: {
        configured: true,
        verified: false,
        overriddenByEnv: true,
      },
    });
    await mswControl.use({
      method: "post",
      url: "/api/organization/complete-onboarding",
      body: makeOrganization({ onboardingComplete: true }),
    });

    await page.goto("/chat");
    await onboardingMailPage.selectChatPath();
    await onboardingMailPage.continueFromWelcome();

    await expect(onboardingMailPage.mailStep).toBeHidden();
  });
});
