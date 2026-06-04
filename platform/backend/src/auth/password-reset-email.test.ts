import { vi } from "vitest";
import { describe, expect, test } from "@/test";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/logging", () => ({
  default: mockLogger,
}));

vi.mock("@/config", () => ({
  default: {
    production: false,
  },
}));

const { sendPasswordResetEmail } = await import("./password-reset-email");

describe("sendPasswordResetEmail", () => {
  test("logs reset URL in non-production environments", async () => {
    await sendPasswordResetEmail({
      email: "admin@example.com",
      url: "http://localhost:3000/auth/reset-password?token=abc",
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        email: "admin@example.com",
        resetUrl: "http://localhost:3000/auth/reset-password?token=abc",
      },
      expect.stringContaining("Password reset link"),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
