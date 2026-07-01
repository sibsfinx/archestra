import config from "@/config";
import logger from "@/logging";
import { sendViaCaptureProvider } from "./providers/capture";
import { sendViaLogProvider } from "./providers/log";
import { sendViaSmtpProvider } from "./providers/smtp";
import { resolveMailConfig } from "./resolve-mail-config";
import type { TransactionalEmail } from "./types";

type SendTransactionalEmailOptions = {
  organizationId?: string;
  throwOnError?: boolean;
};

/**
 * Sends a transactional email using the configured outbound mail provider.
 * Failures are logged and never propagated to auth callers unless `throwOnError`.
 */
export async function sendTransactionalEmail(
  message: TransactionalEmail,
  options: SendTransactionalEmailOptions = {},
) {
  const { throwOnError = false } = options;

  try {
    const mailConfig = await resolveMailConfig(options.organizationId);

    if (mailConfig.provider === "capture") {
      if (config.production) {
        throw new Error(
          "ARCHESTRA_MAIL_PROVIDER=capture is not allowed in production",
        );
      }

      await sendViaCaptureProvider(message);
      logger.info(
        { to: message.to, subject: message.subject, provider: "capture" },
        "[Mail] Captured transactional email",
      );
      return;
    }

    if (mailConfig.provider === "smtp") {
      if (!mailConfig.smtp?.host || !mailConfig.smtp.port) {
        throw new Error("SMTP host and port are not configured");
      }
      if (!mailConfig.smtp.fromAddress) {
        throw new Error("From address is not configured");
      }

      await sendViaSmtpProvider(message, {
        host: mailConfig.smtp.host,
        port: mailConfig.smtp.port,
        tlsMode: mailConfig.smtp.tlsMode,
        username: mailConfig.smtp.username,
        password: mailConfig.smtp.password,
        fromAddress: mailConfig.smtp.fromAddress,
        fromName: mailConfig.smtp.fromName,
        replyTo: mailConfig.smtp.replyTo,
      });
      logger.info(
        { to: message.to, subject: message.subject, provider: "smtp" },
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

    if (throwOnError) {
      throw error;
    }
  }
}
