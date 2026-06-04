import logger from "@/logging";
import type { TransactionalEmail } from "../types";

export async function sendViaLogProvider(message: TransactionalEmail) {
  logger.info(
    {
      to: message.to,
      subject: message.subject,
      text: message.text,
    },
    "[Mail] Transactional email (log provider — no outbound delivery)",
  );
}
