declare module "nodemailer" {
  type TransportOptions = {
    host?: string;
    port?: number;
    secure?: boolean;
    requireTLS?: boolean;
    auth?: { user: string; pass: string };
  };

  type SendMailOptions = {
    from?: string;
    to?: string;
    replyTo?: string;
    subject?: string;
    text?: string;
    html?: string;
  };

  type Transporter = {
    sendMail: (options: SendMailOptions) => Promise<unknown>;
  };

  function createTransport(options: TransportOptions): Transporter;

  export default { createTransport };
}
