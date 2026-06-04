/**
 * CLI utility to verify Brevo outbound mail using platform `.env`.
 *
 * Usage (from archestra/platform):
 *   pnpm test:brevo-mail
 *   pnpm test:brevo-mail -- --to you@example.com
 *   pnpm test:brevo-mail -- --list-senders
 *
 * Env (see .env.example):
 *   ARCHESTRA_MAIL_BREVO_API_KEY
 *   ARCHESTRA_MAIL_FROM
 *   TEST_TO (optional default recipient)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(platformRoot, ".env");

export type MailSender = {
  name: string;
  email: string;
};

export type BrevoMailConfig = {
  apiKey: string;
  from: string;
  sender: MailSender;
};

const BREVO_SENDERS_URL = "https://api.brevo.com/v3/senders";
const BREVO_TRANSACTIONAL_EMAIL_URL =
  "https://api.brevo.com/v3/smtp/email";

/** Loads KEY=value pairs from the platform `.env` into `process.env`. */
export function loadPlatformEnv(
  filePath: string = envPath,
  { override = true }: { override?: boolean } = {},
) {
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Parses `Archestra <noreply@example.com>` or `noreply@example.com`. */
export function parseMailFrom(from: string): MailSender | null {
  const trimmed = from.trim();
  if (!trimmed) {
    return null;
  }

  const namedMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (namedMatch) {
    const name = namedMatch[1]?.trim().replace(/^"|"$/g, "");
    const email = namedMatch[2]?.trim();
    if (name && email) {
      return { name, email };
    }
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { name: "Archestra", email: trimmed };
  }

  return null;
}

export function readBrevoMailConfig(): BrevoMailConfig {
  const apiKey = process.env.ARCHESTRA_MAIL_BREVO_API_KEY?.trim() ?? "";
  const from = process.env.ARCHESTRA_MAIL_FROM?.trim() ?? "";

  if (!apiKey) {
    throw new Error("ARCHESTRA_MAIL_BREVO_API_KEY is not set in .env");
  }

  const sender = parseMailFrom(from);
  if (!sender) {
    throw new Error(
      'ARCHESTRA_MAIL_FROM must be set (e.g. Archestra <noreply@yourdomain.com>)',
    );
  }

  return { apiKey, from, sender };
}

export async function listBrevoSenders(apiKey: string) {
  const response = await fetch(BREVO_SENDERS_URL, {
    headers: {
      accept: "application/json",
      "api-key": apiKey,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo list senders failed (${response.status}): ${body}`);
  }

  return JSON.parse(body) as { senders?: Array<{ email: string; active: boolean; name: string }> };
}

export async function sendBrevoTestEmail({
  apiKey,
  sender,
  to,
  subject = "Archestra password reset CLI test",
  text = "If you received this, Brevo outbound mail works.",
}: {
  apiKey: string;
  sender: MailSender;
  to: string;
  subject?: string;
  text?: string;
}) {
  const response = await fetch(BREVO_TRANSACTIONAL_EMAIL_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo send failed (${response.status}): ${body}`);
  }

  return JSON.parse(body) as { messageId: string };
}

function readCliFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasCliFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  loadPlatformEnv();
  const config = readBrevoMailConfig();
  const to =
    readCliFlag("--to")?.trim() ||
    process.env.TEST_TO?.trim() ||
    "admin@example.com";

  console.log("from:", config.from);
  console.log("sender:", config.sender);
  console.log("to:", to);

  if (hasCliFlag("--list-senders")) {
    const senders = await listBrevoSenders(config.apiKey);
    console.log("verified senders:", senders.senders ?? []);
  }

  const result = await sendBrevoTestEmail({
    apiKey: config.apiKey,
    sender: config.sender,
    to,
  });

  console.log("status: sent");
  console.log("messageId:", result.messageId);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
