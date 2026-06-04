import config from "@/config";
import logger from "@/logging";

type PasswordResetEmailParams = {
  email: string;
  url: string;
};

/**
 * Delivers password-reset links for Better Auth's `sendResetPassword` hook.
 *
 * Archestra does not run a shared transactional mailer (SMTP/Resend/etc.) yet.
 * Invitations are link-based in the UI; agent email is inbound-only (Outlook).
 * Until outbound mail is configured, we log the reset URL so local dev and
 * CI can complete the flow — check Tilt / backend logs for the link.
 */
export async function sendPasswordResetEmail({
  email,
  url,
}: PasswordResetEmailParams) {
  if (config.production) {
    logger.error(
      { email },
      "[Auth] Password reset requested but outbound email is not configured. " +
        "Implement delivery in sendPasswordResetEmail (e.g. SMTP or Resend).",
    );
    return;
  }

  logger.info(
    { email, resetUrl: url },
    "[Auth] Password reset link (dev — no mail provider; copy resetUrl from this log line)",
  );
}
