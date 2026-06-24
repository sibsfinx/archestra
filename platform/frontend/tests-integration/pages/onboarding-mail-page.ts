import type { Locator, Page } from "@playwright/test";
import { E2eTestId } from "@shared/e2e-test-ids";

export class OnboardingMailPage {
  readonly page: Page;
  readonly mailStep: Locator;
  readonly nextButton: Locator;
  readonly skipButton: Locator;
  readonly finishButton: Locator;
  readonly saveMailButton: Locator;
  readonly testEmailButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mailStep = page.getByTestId(E2eTestId.OnboardingMailStep);
    this.nextButton = page.getByTestId(E2eTestId.OnboardingNextButton);
    this.skipButton = page.getByTestId(E2eTestId.OnboardingSkipButton);
    this.finishButton = page.getByTestId(E2eTestId.OnboardingFinishButton);
    this.saveMailButton = page.getByTestId(E2eTestId.OnboardingMailSaveButton);
    this.testEmailButton = page.getByTestId(E2eTestId.MailSettingsTestEmailButton);
  }

  async selectChatPath() {
    await this.page.getByRole("button", { name: /Use Chat Interface/i }).click();
  }

  async continueFromWelcome() {
    await this.nextButton.click();
  }
}
