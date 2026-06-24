import type { TransactionalEmail } from "../types";

export type SmtpTlsMode = "none" | "starttls" | "tls";

export type SmtpConfig = {
  host: string;
  port: number;
  tlsMode: SmtpTlsMode;
  username?: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
  replyTo?: string;
};

export async function sendViaSmtpProvider(
  message: TransactionalEmail,
  config: SmtpConfig,
): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tlsMode === "tls",
    requireTLS: config.tlsMode === "starttls",
    auth: config.username
      ? { user: config.username, pass: config.password ?? "" }
      : undefined,
  });

  await transporter.sendMail({
    from: config.fromName
      ? `"${config.fromName}" <${config.fromAddress}>`
      : config.fromAddress,
    to: message.to,
    replyTo: config.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
