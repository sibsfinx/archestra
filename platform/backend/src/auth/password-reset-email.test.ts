import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { emailInterceptor } from "@/mail/email-interceptor";

const mockConfig = vi.hoisted(() => ({
  production: false,
  mail: {
    provider: "capture" as "log" | "brevo" | "capture",
    from: "",
    brevo: { apiKey: "" },
  },
}));

vi.mock("@/logging", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/config", () => ({
  default: mockConfig,
}));

const { sendPasswordResetEmail } = await import("./password-reset-email");

describe("sendPasswordResetEmail with email interceptor", () => {
  beforeEach(() => {
    emailInterceptor.clear();
    mockConfig.production = false;
    mockConfig.mail.provider = "capture";
  });

  afterEach(() => {
    emailInterceptor.clear();
  });

  test("captures password reset email with reset URL", async () => {
    const resetUrl =
      "http://localhost:3000/api/auth/reset-password/token123?callbackURL=%2Fauth%2Freset-password";

    await sendPasswordResetEmail({
      email: "admin@example.com",
      url: resetUrl,
    });

    expect(emailInterceptor.getAll()).toHaveLength(1);

    const captured = emailInterceptor.getLast();
    expect(captured).toMatchObject({
      to: "admin@example.com",
      subject: "Reset your Archestra password",
    });
    expect(captured?.text).toContain(resetUrl);
    expect(captured?.html).toContain(resetUrl);
    expect(emailInterceptor.extractUrl(captured!)).toBe(resetUrl);
  });

  test("finds captured email by recipient", async () => {
    await sendPasswordResetEmail({
      email: "user@test.com",
      url: "http://localhost:3000/reset?token=abc",
    });

    const messages = emailInterceptor.findByRecipient("user@test.com");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toContain("Reset your Archestra password");
  });
});
