import config from "@/config";
import logger from "@/logging";
import { parseMailFrom } from "./parse-from";
import { sendViaBrevoProvider } from "./providers/brevo";
import { sendViaCaptureProvider } from "./providers/capture";
import { sendViaLogProvider } from "./providers/log";
import type { TransactionalEmail } from "./types";

/**
 * Sends a transactional email using the configured outbound mail provider.
 * Failures are logged and never propagated to auth callers.
 */
export async function sendTransactionalEmail(message: TransactionalEmail) {
  try {
    if (config.mail.provider === "capture") {
      if (config.production) {
        throw new Error("ARCHESTRA_MAIL_PROVIDER=capture is not allowed in production");
      }

      await sendViaCaptureProvider(message);
      logger.info(
        { to: message.to, subject: message.subject, provider: "capture" },
        "[Mail] Captured transactional email",
      );
      return;
    }

    if (config.mail.provider === "brevo") {
      const sender = parseMailFrom(config.mail.from);
      if (!config.mail.brevo.apiKey) {
        throw new Error("ARCHESTRA_MAIL_BREVO_API_KEY is not set");
      }
      if (!sender) {
        throw new Error(
          "ARCHESTRA_MAIL_FROM must be set to a verified sender (e.g. Archestra <noreply@yourdomain.com>)",
        );
      }

      await sendViaBrevoProvider(message, {
        apiKey: config.mail.brevo.apiKey,
        sender,
      });
      logger.info(
        { to: message.to, subject: message.subject, provider: "brevo" },
        "[Mail] Sent transactional email",
      );
      return;
    }

    await sendViaLogProvider(message);
  } catch (error) {
    logger.error(
      { err: error, to: message.to, subject: message.subject },
      "[Mail] Failed to send transactional email",
    );

    if (!config.production && config.mail.provider === "brevo") {
      logger.info(
        { to: message.to, text: message.text },
        "[Mail] Falling back to log output after Brevo failure",
      );
      await sendViaLogProvider(message);
    }
  }
}
