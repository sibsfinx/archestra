import type { TransactionalEmail } from "./types";

export type CapturedEmail = TransactionalEmail & {
  capturedAt: Date;
};

const capturedEmails: CapturedEmail[] = [];

/**
 * In-memory store for outbound mail during tests and local `capture` provider runs.
 * Use `clear()` between tests.
 */
export const emailInterceptor = {
  capture(message: TransactionalEmail) {
    capturedEmails.push({
      ...message,
      capturedAt: new Date(),
    });
  },

  getAll(): readonly CapturedEmail[] {
    return [...capturedEmails];
  },

  getLast(): CapturedEmail | undefined {
    return capturedEmails.at(-1);
  },

  findByRecipient(email: string): CapturedEmail[] {
    return capturedEmails.filter((entry) => entry.to === email);
  },

  /** Pulls the first http(s) URL from plain-text email bodies (password reset links). */
  extractUrl(message: Pick<TransactionalEmail, "text">): string | undefined {
    const match = message.text.match(/https?:\/\/[^\s]+/);
    return match?.[0];
  },

  clear() {
    capturedEmails.length = 0;
  },
};
