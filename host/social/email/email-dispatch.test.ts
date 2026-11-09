import { describe, expect, it, vi } from "vitest";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import { sendEmailToPerson } from "./email-dispatch";

const account: EmailAccount = {
  id: "mail-1",
  kind: "resend",
  from: "hello@example.com",
  name: "Brand",
  unsubscribeUrl: "https://example.com/u",
  createdAt: 0,
};

const person = (overrides: Partial<SocialPerson> = {}): SocialPerson =>
  ({
    id: "person-1",
    emails: [{ address: "ada@example.org", verified: true }],
    ...overrides,
  }) as unknown as SocialPerson;

const refused = () => {
  throw new Error("Recipient is suppressed for this channel. Nothing was sent.");
};

describe("sendEmailToPerson", () => {
  it("runs the suppression gate on the person's address before any credential or provider call", async () => {
    const fetcher = vi.fn();
    const assertSendable = vi.fn(async () => refused());
    await expect(
      sendEmailToPerson({
        account,
        person: person(),
        secrets: undefined,
        subject: "Hi",
        body: "Body",
        deps: { fetcher: fetcher as unknown as typeof fetch },
        assertSendable,
      }),
    ).rejects.toThrow("suppressed");
    expect(assertSendable).toHaveBeenCalledWith(
      { personId: "person-1", email: "ada@example.org" },
      "email",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a person who refused commercial messages (IYS) before the suppression gate runs", async () => {
    const assertSendable = vi.fn(async () => undefined);
    await expect(
      sendEmailToPerson({
        account,
        person: person({ commercialConsent: { iys: "rejected" } }),
        secrets: undefined,
        subject: "Hi",
        body: "Body",
        assertSendable,
      }),
    ).rejects.toThrow("Recipient refused commercial messages (IYS).");
    expect(assertSendable).not.toHaveBeenCalled();
  });

  it("refuses a person with no email address without calling the gate or the provider", async () => {
    const fetcher = vi.fn();
    const assertSendable = vi.fn(async () => undefined);
    await expect(
      sendEmailToPerson({
        account,
        person: person({ emails: [] }),
        secrets: undefined,
        subject: "Hi",
        body: "Body",
        deps: { fetcher: fetcher as unknown as typeof fetch },
        assertSendable,
      }),
    ).rejects.toThrow("Person has no email address.");
    expect(assertSendable).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
