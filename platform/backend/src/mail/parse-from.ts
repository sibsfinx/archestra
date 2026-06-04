import { DEFAULT_APP_NAME } from "@shared";
import type { MailSender } from "./types";

/**
 * Parses `ARCHESTRA_MAIL_FROM` values such as
 * `Archestra <noreply@example.com>` or `noreply@example.com`.
 * @public — exported for testability
 */
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
    return { name: DEFAULT_APP_NAME, email: trimmed };
  }

  return null;
}
