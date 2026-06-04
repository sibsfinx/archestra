import { DEFAULT_APP_NAME } from "@shared";
import { sendTransactionalEmail } from "@/mail/send-transactional";

type PasswordResetEmailParams = {
  email: string;
  url: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Delivers password-reset links for Better Auth's `sendResetPassword` hook.
 */
export async function sendPasswordResetEmail({
  email,
  url,
}: PasswordResetEmailParams) {
  const subject = `Reset your ${DEFAULT_APP_NAME} password`;
  const text = [
    `Reset your ${DEFAULT_APP_NAME} password using the link below:`,
    "",
    url,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  await sendTransactionalEmail({
    to: email,
    subject,
    text,
    html: [
      `<p>Reset your ${DEFAULT_APP_NAME} password using the link below:</p>`,
      `<p><a href="${escapeHtml(url)}">Reset password</a></p>`,
      `<p>If you did not request this, you can ignore this email.</p>`,
    ].join(""),
  });
}
