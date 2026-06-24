import { E2eTestId } from "@shared";
import { ADMIN_EMAIL, ADMIN_PASSWORD, UI_BASE_URL } from "../consts";
import { expect, test } from "../fixtures";
import { loginViaApi, resetFirstRunState } from "../utils";

test.describe("Onboarding mail setup", () => {
  test("admin can configure SMTP during first-run onboarding", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    try {
      await page.goto("about:blank");
      const signedIn = await loginViaApi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(signedIn, "Admin sign-in failed").toBe(true);

      const resetOk = await resetFirstRunState(page);
      test.skip(!resetOk, "ENABLE_E2E_TEST_ENDPOINTS is not enabled");

      await page.goto(`${UI_BASE_URL}/chat`, {
        waitUntil: "domcontentloaded",
      });

      await page.getByRole("button", { name: /Use Chat Interface/i }).click();
      await page.getByTestId(E2eTestId.OnboardingNextButton).click();

      const mailStep = page.getByTestId(E2eTestId.OnboardingMailStep);
      await expect(mailStep).toBeVisible();

      await expect(page.getByLabel("SMTP host")).toHaveValue("localhost");
      await expect(page.getByLabel("Port")).toHaveValue("25");
      await expect(page.getByLabel("From address")).toHaveValue(
        "noreply@localhost",
      );

      await page.getByTestId(E2eTestId.OnboardingMailSaveButton).click();
      await expect(page.getByText("Mail settings saved")).toBeVisible();

      await page.getByTestId(E2eTestId.OnboardingFinishButton).click();
      await expect(mailStep).toBeHidden({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });
});
