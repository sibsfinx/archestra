export type MailSender = {
  name: string;
  email: string;
};

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type MailProviderType = "log" | "smtp" | "capture";
