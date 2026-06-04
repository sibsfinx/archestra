import { describe, expect, test, vi } from "vitest";
import { emailInterceptor } from "./email-interceptor";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

const mockConfig = vi.hoisted(() => ({
  production: false,
  mail: {
    provider: "log" as "log" | "brevo" | "capture",
    from: "",
    brevo: { apiKey: "" },
  },
}));

const mockSendViaBrevoProvider = vi.hoisted(() => vi.fn());
const mockSendViaLogProvider = vi.hoisted(() => vi.fn());

vi.mock("@/logging", () => ({
  default: mockLogger,
}));

vi.mock("@/config", () => ({
  default: mockConfig,
}));

vi.mock("./providers/brevo", () => ({
  sendViaBrevoProvider: mockSendViaBrevoProvider,
}));

vi.mock("./providers/log", () => ({
  sendViaLogProvider: mockSendViaLogProvider,
}));

const { sendTransactionalEmail } = await import("./send-transactional");

describe("sendTransactionalEmail", () => {
  test("captures email via interceptor when provider is capture", async () => {
    emailInterceptor.clear();
    mockConfig.mail.provider = "capture";
    mockConfig.production = false;
    mockLogger.info.mockClear();

    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset password",
      text: "https://example.com/reset",
    });

    expect(emailInterceptor.getLast()).toMatchObject({
      to: "user@example.com",
      subject: "Reset password",
      text: "https://example.com/reset",
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "capture" }),
      "[Mail] Captured transactional email",
    );
    emailInterceptor.clear();
  });

  test("uses log provider by default", async () => {
    mockConfig.mail.provider = "log";
    mockSendViaLogProvider.mockClear();
    mockSendViaBrevoProvider.mockClear();

    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(mockSendViaLogProvider).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });
    expect(mockSendViaBrevoProvider).not.toHaveBeenCalled();
  });

  test("sends via Brevo when configured", async () => {
    mockConfig.mail.provider = "brevo";
    mockConfig.mail.from = "Archestra <noreply@example.com>";
    mockConfig.mail.brevo.apiKey = "test-key";
    mockSendViaBrevoProvider.mockResolvedValue(undefined);
    mockSendViaLogProvider.mockClear();
    mockLogger.info.mockClear();

    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset password",
      text: "https://example.com/reset",
    });

    expect(mockSendViaBrevoProvider).toHaveBeenCalledWith(
      {
        to: "user@example.com",
        subject: "Reset password",
        text: "https://example.com/reset",
      },
      {
        apiKey: "test-key",
        sender: { name: "Archestra", email: "noreply@example.com" },
      },
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "brevo", to: "user@example.com" }),
      "[Mail] Sent transactional email",
    );
  });

  test("falls back to log provider in dev when Brevo fails", async () => {
    mockConfig.mail.provider = "brevo";
    mockConfig.mail.from = "Archestra <noreply@example.com>";
    mockConfig.mail.brevo.apiKey = "test-key";
    mockConfig.production = false;
    mockSendViaBrevoProvider.mockRejectedValue(new Error("Brevo down"));
    mockSendViaLogProvider.mockClear();
    mockLogger.error.mockClear();

    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset password",
      text: "https://example.com/reset",
    });

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockSendViaLogProvider).toHaveBeenCalled();
  });
});
