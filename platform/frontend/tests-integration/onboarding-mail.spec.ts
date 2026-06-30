import { makeAgent } from "../src/mocks/data/agents";
import { makeLlmProviderApiKey } from "../src/mocks/data/llm-keys";
import { makeOrganization } from "../src/mocks/data/organization";
import {
  makeConfiguredMailStatus,
  makeSmtpMailSettings,
  unconfiguredMailSettingsSeed,
  unconfiguredMailStatusSeed,
} from "../src/mocks/data/mail-settings";
import { expect, test } from "./fixtures";
import type { MswControl } from "./helpers/msw-control";

test.describe.configure({ mode: "serial" });

async function seedChatLanding(mswControl: MswControl) {
  await mswControl.use({
    method: "get",
    url: "/api/llm-provider-api-keys",
    body: [makeLlmProviderApiKey()],
  });
  await mswControl.use({
    method: "get",
    url: "/api/agents/all",
    body: [makeAgent()],
  });
}

test.describe("Chat onboarding mail setup", () => {
  test("admin sees mail setup with localhost SMTP defaults in the chat wizard", async ({
    page,
    onboardingMailPage,
    mswControl,
  }) => {
    await seedChatLanding(mswControl);
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization(),
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

    await onboardingMailPage.gotoChat();
    await onboardingMailPage.openWizard();

    await expect(onboardingMailPage.mailStep).toBeVisible();
    await expect(
      onboardingMailPage.mailStep.getByRole("heading", {
        name: "Set up outbound mail",
      }),
    ).toBeVisible();
    await expect(page.getByLabel("SMTP host")).toHaveValue("localhost");
    await expect(page.getByLabel("Port")).toHaveValue("25");
    await expect(page.getByLabel("From address")).toHaveValue(
      "noreply@localhost",
    );
  });

  test("admin can save SMTP in the chat wizard and send a test email", async ({
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

    await seedChatLanding(mswControl);
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization(),
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

    await onboardingMailPage.gotoChat();
    await onboardingMailPage.openWizard();

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

  test("skipping wizard mail setup still allows later settings configuration", async ({
    page,
    onboardingMailPage,
    mailSettingsPage,
    mswControl,
  }) => {
    await seedChatLanding(mswControl);
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization(),
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

    await onboardingMailPage.gotoChat();
    await onboardingMailPage.openWizard();
    await onboardingMailPage.skipButton.click();

    await mailSettingsPage.goto();
    await expect(page.getByText("Not configured")).toBeVisible();
    await mailSettingsPage.smtpProvider.click();
    await expect(page.getByLabel("SMTP host")).toBeVisible();
  });

  test("custom wizard pages follow the mail setup step", async ({
    page,
    onboardingMailPage,
    mswControl,
  }) => {
    await seedChatLanding(mswControl);
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({
        onboardingWizard: {
          label: "Getting started",
          pages: [{ content: "Welcome to your workspace guide." }],
        },
      }),
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

    await onboardingMailPage.gotoChat();
    await onboardingMailPage.openWizard();

    await expect(onboardingMailPage.mailStep).toBeVisible();
    await onboardingMailPage.nextButton.click();
    await expect(page.getByText("Welcome to your workspace guide.")).toBeVisible();
  });

  test("env override hides the mail setup wizard button", async ({
    onboardingMailPage,
    mswControl,
  }) => {
    await seedChatLanding(mswControl);
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization(),
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

    await onboardingMailPage.gotoChat();

    await expect(onboardingMailPage.wizardButton).toBeHidden();
  });
});
