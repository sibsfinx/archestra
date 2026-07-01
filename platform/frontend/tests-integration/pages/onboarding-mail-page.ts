import { E2eTestId } from "@archestra/shared/e2e-test-ids";
import type { Locator, Page } from "@playwright/test";

export class OnboardingMailPage {
  readonly page: Page;
  readonly wizardButton: Locator;
  readonly mailStep: Locator;
  readonly nextButton: Locator;
  readonly skipButton: Locator;
  readonly saveMailButton: Locator;
  readonly testEmailButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.wizardButton = page.getByTestId(E2eTestId.OnboardingWizardButton);
    this.mailStep = page.getByTestId(E2eTestId.OnboardingMailStep);
    this.nextButton = page.getByTestId(E2eTestId.OnboardingNextButton);
    this.skipButton = page.getByTestId(E2eTestId.OnboardingSkipButton);
    this.saveMailButton = page.getByTestId(E2eTestId.OnboardingMailSaveButton);
    this.testEmailButton = page.getByTestId(
      E2eTestId.MailSettingsTestEmailButton,
    );
  }

  async gotoChat() {
    await this.page.goto("/chat", { waitUntil: "domcontentloaded" });
    await this.page
      .getByTestId(E2eTestId.ChatPromptTextarea)
      .waitFor({ state: "visible" });
  }

  async openWizard() {
    await this.wizardButton.click();
  }
}
