import { describe, expect, test } from "vitest";
import { emailInterceptor } from "./email-interceptor";

describe("emailInterceptor", () => {
  test("stores and retrieves captured emails", () => {
    emailInterceptor.clear();

    emailInterceptor.capture({
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
    });

    expect(emailInterceptor.getAll()).toHaveLength(1);
    expect(emailInterceptor.getLast()).toMatchObject({
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
    });
    expect(emailInterceptor.findByRecipient("user@example.com")).toHaveLength(1);
    expect(emailInterceptor.findByRecipient("other@example.com")).toHaveLength(0);
  });

  test("extracts reset URLs from plain-text bodies", () => {
    const url = emailInterceptor.extractUrl({
      text: "Reset here:\n\nhttp://localhost:3000/api/auth/reset-password/abc?callbackURL=%2Fauth%2Freset-password\n",
    });

    expect(url).toBe(
      "http://localhost:3000/api/auth/reset-password/abc?callbackURL=%2Fauth%2Freset-password",
    );
  });

  test("clear removes captured emails", () => {
    emailInterceptor.capture({
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
    });
    emailInterceptor.clear();
    expect(emailInterceptor.getAll()).toHaveLength(0);
    expect(emailInterceptor.getLast()).toBeUndefined();
  });
});
