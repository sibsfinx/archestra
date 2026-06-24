import { E2eTestId } from "@shared/e2e-test-ids";
import {
  makeConfiguredMailStatus,
  makeSmtpMailSettings,
  unconfiguredMailSettingsSeed,
  unconfiguredMailStatusSeed,
} from "../src/mocks/data/mail-settings";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("Mail settings", () => {
  test("admin can configure SMTP and send a test email", async ({
    page,
    mailSettingsPage,
    mswControl,
  }) => {
    const saved = makeSmtpMailSettings();
    const verified = makeSmtpMailSettings({
      verifiedAt: "2026-06-12T12:00:00.000Z",
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

    await mailSettingsPage.goto();
    await expect(page.getByText("Not configured")).toBeVisible();

    await mailSettingsPage.smtpProvider.click();
    await page.getByLabel("SMTP host").fill("smtp.example.com");
    await page.getByLabel("Port").fill("587");
    await page.getByLabel("From address").fill("noreply@example.com");
    await page.getByLabel("From name").fill("Archestra");
    await page.getByLabel("Username").fill("smtp-user");
    await page.getByLabel("Password").fill("smtp-secret");

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

    await mailSettingsPage.saveButton.click();
    await expect(page.getByText("Configured, unverified")).toBeVisible();

    await mswControl.use({
      method: "post",
      url: "/api/mail/test",
      body: { success: true, durationMs: 25 },
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

    await mailSettingsPage.testEmailButton.click();
    await expect(page.getByText("Test email sent")).toBeVisible();
    await expect(page.getByText("Verified")).toBeVisible();
  });

  test("shows env override callout when settings are overridden", async ({
    mailSettingsPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: makeSmtpMailSettings({ overriddenByEnv: true }),
    });

    await mailSettingsPage.goto();
    await expect(mailSettingsPage.envOverrideAlert).toBeVisible();
    await expect(mailSettingsPage.envOverrideAlert).toContainText(
      "overridden by environment variables",
    );
  });

  test("sidebar warning appears when mail is unconfigured and hides when configured", async ({
    page,
    agentsPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: unconfiguredMailStatusSeed,
    });

    await agentsPage.goto();
    await expect(
      page.getByTestId(E2eTestId.SidebarMailWarningLink),
    ).toBeVisible();

    await mswControl.use({
      method: "get",
      url: "/api/mail/status",
      body: makeConfiguredMailStatus(),
    });
    await page.reload();

    await expect(
      page.getByTestId(E2eTestId.SidebarMailWarningLink),
    ).toBeHidden();
  });

  test("test email stays disabled until settings are saved", async ({
    page,
    mailSettingsPage,
    mswControl,
  }) => {
    await mswControl.use({
      method: "get",
      url: "/api/mail/settings",
      body: unconfiguredMailSettingsSeed,
    });

    await mailSettingsPage.goto();
    await mailSettingsPage.smtpProvider.click();
    await page.getByLabel("SMTP host").fill("smtp.example.com");
    await page.getByLabel("From address").fill("noreply@example.com");

    await expect(mailSettingsPage.testEmailButton).toBeDisabled();
    await expect(
      page.getByText("Save your settings before sending a test email."),
    ).toBeVisible();
  });
});
