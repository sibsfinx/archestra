import { describe, expect, test, vi } from "vitest";
import { emailInterceptor } from "./email-interceptor";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

const mockResolveMailConfig = vi.hoisted(() => vi.fn());
const mockSendViaLogProvider = vi.hoisted(() => vi.fn());
const mockSendViaSmtpProvider = vi.hoisted(() => vi.fn());

vi.mock("@/logging", () => ({
  default: mockLogger,
}));

vi.mock("@/config", () => ({
  default: { production: false },
}));

vi.mock("./resolve-mail-config", () => ({
  resolveMailConfig: mockResolveMailConfig,
}));

vi.mock("./providers/log", () => ({
  sendViaLogProvider: mockSendViaLogProvider,
}));

vi.mock("./providers/smtp", () => ({
  sendViaSmtpProvider: mockSendViaSmtpProvider,
}));

const { sendTransactionalEmail } = await import("./send-transactional");

describe("sendTransactionalEmail", () => {
  test("captures email via interceptor when provider is capture", async () => {
    emailInterceptor.clear();
    mockResolveMailConfig.mockResolvedValue({
      provider: "capture",
      from: "",
      smtp: null,
      overriddenByEnv: false,
    });
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
    mockResolveMailConfig.mockResolvedValue({
      provider: "log",
      from: "",
      smtp: null,
      overriddenByEnv: false,
    });
    mockSendViaLogProvider.mockClear();
    mockSendViaSmtpProvider.mockClear();

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
    expect(mockSendViaSmtpProvider).not.toHaveBeenCalled();
  });

  test("sends via SMTP when configured", async () => {
    mockResolveMailConfig.mockResolvedValue({
      provider: "smtp",
      from: "noreply@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        tlsMode: "starttls",
        username: "user",
        password: "pass",
        fromAddress: "noreply@example.com",
        fromName: "Archestra",
      },
      overriddenByEnv: false,
    });
    mockSendViaSmtpProvider.mockResolvedValue(undefined);
    mockSendViaLogProvider.mockClear();
    mockLogger.info.mockClear();

    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset password",
      text: "https://example.com/reset",
    });

    expect(mockSendViaSmtpProvider).toHaveBeenCalledWith(
      {
        to: "user@example.com",
        subject: "Reset password",
        text: "https://example.com/reset",
      },
      {
        host: "smtp.example.com",
        port: 587,
        tlsMode: "starttls",
        username: "user",
        password: "pass",
        fromAddress: "noreply@example.com",
        fromName: "Archestra",
        replyTo: undefined,
      },
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "smtp", to: "user@example.com" }),
      "[Mail] Sent transactional email",
    );
  });

  test("propagates SMTP errors when throwOnError is set", async () => {
    mockResolveMailConfig.mockResolvedValue({
      provider: "smtp",
      from: "noreply@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        tlsMode: "starttls",
        fromAddress: "noreply@example.com",
      },
      overriddenByEnv: false,
    });
    mockSendViaSmtpProvider.mockRejectedValue(new Error("SMTP down"));
    mockSendViaLogProvider.mockClear();
    mockLogger.error.mockClear();

    await expect(
      sendTransactionalEmail(
        {
          to: "user@example.com",
          subject: "Reset password",
          text: "https://example.com/reset",
        },
        { throwOnError: true },
      ),
    ).rejects.toThrow("SMTP down");

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockSendViaLogProvider).not.toHaveBeenCalled();
  });
});
