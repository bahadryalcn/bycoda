import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import { deliverEmail, parseEmailSecret, verifyEmailAccount } from "./email-sender";
import { sendPostmark, verifyPostmark } from "./postmark-sender";
import { sendResend } from "./resend-sender";
import { sendSmtp, type SmtpTransport } from "./smtp-sender";
import type { EmailMessage } from "./email-types";

const message: EmailMessage = {
  from: "hello@example.com",
  to: "a@example.org",
  subject: "Hi",
  text: "Body\n\n--\nunsubscribe: https://example.com/u",
  html: "<div>Body</div>",
  headers: { "List-Unsubscribe": "<https://example.com/u>" },
  idempotencyKey: "outreach:enr-1:step-1",
};

const resendAccount: EmailAccount = {
  id: "mail-1",
  kind: "resend",
  from: "hello@example.com",
  name: "Brand",
  unsubscribeUrl: "https://example.com/u",
  createdAt: 0,
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

afterEach(() => {
  vi.restoreAllMocks();
});

function fetchReturning(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers,
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("Resend sender", () => {
  it("posts the message with the List-Unsubscribe header and an idempotency key", async () => {
    const { fetcher, calls } = fetchReturning(200, { id: "re-1" });
    const result = await sendResend("key-123", message, fetcher);
    expect(result).toEqual({ messageId: "re-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-123");
    expect(headers["Idempotency-Key"]).toBe("outreach:enr-1:step-1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      from: "hello@example.com",
      to: ["a@example.org"],
      subject: "Hi",
      headers: { "List-Unsubscribe": "<https://example.com/u>" },
    });
    expect(calls[0].init.redirect).toBe("error");
  });

  it("maps 429 to rate_limit with the Retry-After time", async () => {
    const { fetcher } = fetchReturning(429, { message: "slow down" }, { "retry-after": "120" });
    const error = await failure(sendResend("k", message, fetcher));
    expect(error).toBeInstanceOf(SocialPlatformError);
    expect((error as SocialPlatformError).code).toBe("rate_limit");
    expect((error as SocialPlatformError).retryAt).toBeGreaterThan(Date.now());
  });

  it("maps 401 to expired and 5xx to unknown without putting the body in the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auth = await failure(sendResend("k", message, fetchReturning(401, "bad key").fetcher));
    expect((auth as SocialPlatformError).code).toBe("expired");
    const server = await failure(
      sendResend("k", message, fetchReturning(500, "secret-echo a@example.org").fetcher),
    );
    expect((server as SocialPlatformError).code).toBe("unknown");
    expect(String((server as Error).message)).not.toContain("a@example.org");
  });

  it("treats a network error as unknown, so the caller does not resend", async () => {
    const fetcher = (async () => {
      throw new TypeError("socket hang up");
    }) as unknown as typeof fetch;
    const error = await failure(sendResend("k", message, fetcher));
    expect((error as SocialPlatformError).code).toBe("unknown");
  });
});

describe("Postmark sender", () => {
  it("sends Headers as a name/value list and reads MessageID", async () => {
    const { fetcher, calls } = fetchReturning(200, { MessageID: "pm-1" });
    const result = await sendPostmark("server-token", message, fetcher);
    expect(result).toEqual({ messageId: "pm-1" });
    expect(calls[0].url).toBe("https://api.postmarkapp.com/email");
    expect((calls[0].init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe(
      "server-token",
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.Headers).toEqual([{ Name: "List-Unsubscribe", Value: "<https://example.com/u>" }]);
    expect(body.To).toBe("a@example.org");
  });

  it("verifies credentials with a read-only GET", async () => {
    const { fetcher, calls } = fetchReturning(200, { Name: "server" });
    await verifyPostmark("server-token", fetcher);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toBe("https://api.postmarkapp.com/server");
  });
});

describe("SMTP sender", () => {
  it("passes the list-unsubscribe header to the transport and closes it", async () => {
    const transport: SmtpTransport = {
      sendMail: vi.fn(async () => ({ messageId: "<smtp-1>" })),
      verify: vi.fn(async () => true),
      close: vi.fn(),
    };
    const smtpAccount: EmailAccount = {
      ...resendAccount,
      kind: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    };
    const result = await sendSmtp(smtpAccount, { user: "u", pass: "p" }, message, () => transport);
    expect(result).toEqual({ messageId: "<smtp-1>" });
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "List-Unsubscribe": "<https://example.com/u>" } }),
    );
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("maps an SMTP authentication failure to expired and any other failure to unknown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const smtpAccount: EmailAccount = {
      ...resendAccount,
      kind: "smtp",
      host: "smtp.example.com",
      port: 587,
    };
    const auth = Object.assign(new Error("535 auth failed"), { responseCode: 535 });
    const authTransport: SmtpTransport = {
      sendMail: async () => {
        throw auth;
      },
      verify: async () => true,
      close: () => undefined,
    };
    const expired = await failure(
      sendSmtp(smtpAccount, { user: "u", pass: "p" }, message, () => authTransport),
    );
    expect((expired as SocialPlatformError).code).toBe("expired");
    const dropped: SmtpTransport = {
      sendMail: async () => {
        throw new Error("connection reset");
      },
      verify: async () => true,
      close: () => undefined,
    };
    const unknown = await failure(
      sendSmtp(smtpAccount, { user: "u", pass: "p" }, message, () => dropped),
    );
    expect((unknown as SocialPlatformError).code).toBe("unknown");
  });

  it("refuses a stored secret that does not match the provider", async () => {
    expect(() => parseEmailSecret("smtp", JSON.stringify({ apiKey: "k" }))).toThrow(
      "Email credentials are invalid",
    );
    expect(parseEmailSecret("resend", JSON.stringify({ apiKey: "k", extra: "dropped" }))).toEqual({
      apiKey: "k",
    });
    const error = await failure(
      deliverEmail(
        { ...resendAccount, kind: "smtp", host: "h", port: 25 },
        { apiKey: "k" },
        message,
      ),
    );
    expect(String((error as Error).message)).toContain("do not match");
  });

  it("verifies an account through the provider's read-only call", async () => {
    const { fetcher, calls } = fetchReturning(200, { data: [] });
    await verifyEmailAccount(resendAccount, { apiKey: "k" }, { fetcher });
    expect(calls[0].url).toBe("https://api.resend.com/domains");
  });
});
