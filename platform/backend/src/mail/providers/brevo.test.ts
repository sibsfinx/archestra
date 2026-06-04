import { afterEach, describe, expect, test, vi } from "vitest";
import { sendViaBrevoProvider } from "./brevo";

describe("sendViaBrevoProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("posts transactional email payload to Brevo", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messageId: "msg-123" }), { status: 201 }),
    );

    await sendViaBrevoProvider(
      {
        to: "user@example.com",
        subject: "Reset your Archestra password",
        text: "http://localhost:3000/reset?token=abc",
        html: '<a href="http://localhost:3000/reset?token=abc">Reset</a>',
      },
      {
        apiKey: "test-api-key",
        sender: { name: "Archestra", email: "noreply@example.com" },
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.brevo.com/v3/smtp/email",
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers).toMatchObject({
      "api-key": "test-api-key",
      "content-type": "application/json",
    });

    expect(JSON.parse(String(requestInit.body))).toEqual({
      sender: { name: "Archestra", email: "noreply@example.com" },
      to: [{ email: "user@example.com" }],
      subject: "Reset your Archestra password",
      textContent: "http://localhost:3000/reset?token=abc",
      htmlContent: '<a href="http://localhost:3000/reset?token=abc">Reset</a>',
    });
  });

  test("throws when Brevo returns an error response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
      }),
    );

    await expect(
      sendViaBrevoProvider(
        {
          to: "user@example.com",
          subject: "Test",
          text: "Hello",
        },
        {
          apiKey: "bad-key",
          sender: { name: "Archestra", email: "noreply@example.com" },
        },
      ),
    ).rejects.toThrow(/Brevo transactional email failed \(401\)/);
  });
});
