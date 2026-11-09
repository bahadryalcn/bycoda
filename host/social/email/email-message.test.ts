import { describe, expect, it } from "vitest";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import { buildOutreachEmail, emailAddressFor } from "./email-message";

const account: EmailAccount = {
  id: "mail-1",
  kind: "resend",
  from: "hello@example.com",
  name: "Brand",
  unsubscribeUrl: "https://example.com/unsubscribe?list=main",
  createdAt: 0,
};

describe("buildOutreachEmail", () => {
  it("refuses to build an email without an unsubscribe link", () => {
    expect(() =>
      buildOutreachEmail({ ...account, unsubscribeUrl: undefined }, "a@example.org", "Hi", "Body"),
    ).toThrow("Add an unsubscribe link");
  });

  it("refuses a non-HTTPS unsubscribe link", () => {
    expect(() =>
      buildOutreachEmail(
        { ...account, unsubscribeUrl: "http://example.com/u" },
        "a@example.org",
        "Hi",
        "Body",
      ),
    ).toThrow("HTTPS");
  });

  it("carries List-Unsubscribe and a visible unsubscribe link in both bodies", () => {
    const message = buildOutreachEmail(account, "a@example.org", "Hi", "Hello there");
    expect(message.headers["List-Unsubscribe"]).toBe("<https://example.com/unsubscribe?list=main>");
    expect(message.text).toContain("Hello there");
    expect(message.text).toContain("https://example.com/unsubscribe?list=main");
    expect(message.html).toContain('href="https://example.com/unsubscribe?list=main"');
    expect(message.from).toBe("hello@example.com");
    expect(message.to).toBe("a@example.org");
  });

  it("escapes markup in the body and rejects header injection in the subject", () => {
    const message = buildOutreachEmail(account, "a@example.org", "Hi", "<script>x</script>");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(() =>
      buildOutreachEmail(account, "a@example.org", "Hi\r\nBcc: x@example.org", "Body"),
    ).toThrow("one line");
  });

  it("rejects an invalid recipient and an empty body", () => {
    expect(() => buildOutreachEmail(account, "not-an-address", "Hi", "Body")).toThrow("recipient");
    expect(() => buildOutreachEmail(account, "a@example.org", "Hi", "   ")).toThrow("Body must be");
  });
});

describe("emailAddressFor", () => {
  const person = (emails: SocialPerson["emails"]): SocialPerson =>
    ({
      id: "p",
      name: "P",
      handles: [],
      emails,
      tags: [],
      notes: "",
      stage: "new",
      source: "import",
      projectIds: [],
      consent: { basis: "none" },
      createdAt: 0,
      updatedAt: 0,
    }) as SocialPerson;

  it("prefers the first verified address and falls back to the first one", () => {
    expect(
      emailAddressFor(
        person([
          { address: "old@example.org", source: "import", verified: false },
          { address: "ok@example.org", source: "manual", verified: true },
        ]),
      ),
    ).toBe("ok@example.org");
    expect(
      emailAddressFor(person([{ address: "only@example.org", source: "import", verified: false }])),
    ).toBe("only@example.org");
    expect(emailAddressFor(person([]))).toBeUndefined();
  });
});
