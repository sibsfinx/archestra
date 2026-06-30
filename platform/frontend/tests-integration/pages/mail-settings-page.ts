import type { Locator, Page } from "@playwright/test";
import { E2eTestId } from "@archestra/shared/e2e-test-ids";

export class MailSettingsPage {
  readonly page: Page;
  readonly smtpProvider: Locator;
  readonly saveButton: Locator;
  readonly testEmailButton: Locator;
  readonly envOverrideAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.smtpProvider = page.getByTestId(E2eTestId.MailSettingsProviderSmtp);
    this.saveButton = page.getByRole("button", { name: "Save" });
    this.testEmailButton = page.getByTestId(E2eTestId.MailSettingsTestEmailButton);
    this.envOverrideAlert = page.getByTestId(
      E2eTestId.MailSettingsEnvOverrideAlert,
    );
  }

  async goto() {
    await this.page.goto("/settings/mail", { waitUntil: "domcontentloaded" });
    // MswInit renders null until the browser worker is up; wait for page chrome.
    await this.page.getByText("Outbound mail").waitFor({ state: "visible" });
  }
}
