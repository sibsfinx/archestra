import type { MailSender, TransactionalEmail } from "../types";

const BREVO_TRANSACTIONAL_EMAIL_URL =
  "https://api.brevo.com/v3/smtp/email";

type BrevoProviderOptions = {
  apiKey: string;
  sender: MailSender;
};

export async function sendViaBrevoProvider(
  message: TransactionalEmail,
  { apiKey, sender }: BrevoProviderOptions,
) {
  const body: Record<string, unknown> = {
    sender: {
      name: sender.name,
      email: sender.email,
    },
    to: [{ email: message.to }],
    subject: message.subject,
    textContent: message.text,
  };

  if (message.html) {
    body.htmlContent = message.html;
  }

  const response = await fetch(BREVO_TRANSACTIONAL_EMAIL_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Brevo transactional email failed (${response.status}): ${errorBody}`,
    );
  }
}
