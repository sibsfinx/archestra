import { E2eTestId } from "@shared";
import { expect, test } from "../fixtures";
import { saveMailSettingsViaApi } from "../utils";

test.describe("Mail settings", () => {
  test("admin can edit saved SMTP settings in settings page", async ({
    adminPage,
  }) => {
    const saved = await saveMailSettingsViaApi(adminPage, {
      provider: "smtp",
      fromAddress: "noreply@example.com",
      fromName: "Archestra",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        tlsMode: "starttls",
        username: "smtp-user",
        password: "smtp-secret",
      },
    });
    expect(saved, "Failed to seed mail settings via API").toBe(true);

    await adminPage.goto("/settings/mail", { waitUntil: "domcontentloaded" });
    await expect(adminPage.getByText("Configured, unverified")).toBeVisible();

    await adminPage.getByLabel("SMTP host").fill("mail.example.com");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("Mail settings saved")).toBeVisible();
    await expect(adminPage.getByLabel("SMTP host")).toHaveValue(
      "mail.example.com",
    );

    await expect(
      adminPage.getByTestId(E2eTestId.MailSettingsTestEmailButton),
    ).toBeEnabled();
  });
});
