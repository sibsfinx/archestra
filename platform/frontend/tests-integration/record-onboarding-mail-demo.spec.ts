/**
 * Records a presentation walkthrough of the Sentry-style SMTP onboarding flow.
 * Run: pnpm record:onboarding-mail-demo
 */
import { E2eTestId } from "@shared/e2e-test-ids";
import { makeOrganization } from "../src/mocks/data/organization";
import {
  makeConfiguredMailStatus,
  makeSmtpMailSettings,
  unconfiguredMailSettingsSeed,
  unconfiguredMailStatusSeed,
} from "../src/mocks/data/mail-settings";
import { expect, test } from "./fixtures";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ~2 min total: longer holds at key beats, moderate slowMo on actions. */
const hold = (ms = 2000) => pause(ms);

test.describe("Record onboarding mail demo", () => {
  test("full first-run SMTP setup walkthrough", async ({
    page,
    onboardingMailPage,
    mailSettingsPage,
    mswControl,
  }) => {
    test.setTimeout(180_000);

    const saved = makeSmtpMailSettings({
      smtp: {
        host: "localhost",
        port: 25,
        tlsMode: "none",
        username: null,
        passwordConfigured: false,
      },
      fromAddress: "noreply@localhost",
      fromName: "Archestra",
    });
    const verified = makeSmtpMailSettings({
      ...saved,
      verifiedAt: "2026-06-22T12:00:00.000Z",
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
    await hold(4000);

    await expect(page.getByText("Welcome to")).toBeVisible();
    await hold(3500);

    await onboardingMailPage.selectChatPath();
    await hold(3500);

    await onboardingMailPage.continueFromWelcome();
    await hold(3500);

    await expect(onboardingMailPage.mailStep).toBeVisible();
    await expect(page.getByText("Configure outbound email")).toBeVisible();
    await hold(4500);

    await expect(page.getByLabel("SMTP host")).toHaveValue("localhost");
    await expect(page.getByLabel("Port")).toHaveValue("25");
    await expect(page.getByLabel("From address")).toHaveValue(
      "noreply@localhost",
    );
    await page.getByLabel("From name").fill("Archestra");
    await hold(3000);

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

    await page.getByTestId(E2eTestId.OnboardingMailSaveButton).click();
    await expect(page.getByText("Mail settings saved")).toBeVisible();
    await hold(3500);

    await mswControl.use({
      method: "post",
      url: "/api/mail/test",
      body: { success: true, durationMs: 18 },
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
    await hold(3500);

    await mswControl.use({
      method: "post",
      url: "/api/organization/complete-onboarding",
      body: makeOrganization({ onboardingComplete: true }),
    });
    await mswControl.use({
      method: "get",
      url: "/api/organization",
      body: makeOrganization({ onboardingComplete: true }),
    });

    await onboardingMailPage.finishButton.click();
    await hold(3500);

    await mailSettingsPage.goto();
    await expect(page.getByText("Verified")).toBeVisible();
    await hold(4500);
  });
});
