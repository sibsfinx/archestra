import type { Page } from "@playwright/test";
import { UI_BASE_URL } from "../consts";

export async function resetFirstRunState(page: Page): Promise<boolean> {
  const response = await page.request.post(
    `${UI_BASE_URL}/api/e2e-test/reset-first-run-state`,
  );
  return response.ok();
}

export async function saveMailSettingsViaApi(
  page: Page,
  body: Record<string, unknown>,
): Promise<boolean> {
  const response = await page.request.put(`${UI_BASE_URL}/api/mail/settings`, {
    data: body,
  });
  return response.ok();
}
