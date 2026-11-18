import { describe, expect, it, vi } from "vitest";
import type { SocialContact } from "../../../src/features/social/model/social";
import type { SocialServiceInternals } from "../core/social-internals";
import type { SocialPrincipal } from "../social";
import { eraseSocialContact, upsertSocialContact } from "./social-contacts";

describe("eraseSocialContact", () => {
  it("clears personal fields and keeps the identity and consent state", async () => {
    const put = vi.fn(async (_kind: string, _id: string, value: unknown) => value);
    const contact = {
      id: "c1",
      accountId: "acc",
      platformId: "42",
      name: "Ada",
      profileUrl: "https://example.com/ada",
      language: "tr",
      source: "import",
      tags: ["lead"],
      projectIds: ["p1"],
      consent: { allowed: true, source: "owner", at: 1 },
      replyEligible: true,
      commentEligible: false,
      optedOut: false,
      history: [{ at: 1, text: "hi" }],
    } as unknown as SocialContact;
    const erased = await eraseSocialContact({ put }, contact);
    expect(erased).toMatchObject({
      id: "c1",
      platformId: "42",
      name: "Deleted contact",
      tags: [],
      history: [],
      consent: { allowed: true },
    });
    expect(erased).not.toHaveProperty("profileUrl");
    expect(erased).not.toHaveProperty("language");
    expect(put).toHaveBeenCalledWith("contact", "c1", erased);
  });
});

describe("Instagram browser recipient update", () => {
  const owner = { kind: "owner" } as SocialPrincipal;
  const input = {
    accountId: "ig",
    platformId: "420",
    name: "Ada.Studio",
    instagramRecipientProjectId: "new-project",
  };

  function fixture(connection: "browser" | "oauth" = "browser") {
    const existing: SocialContact = {
      id: "previous",
      accountId: "ig",
      platformId: "420",
      name: "Ada, customer",
      source: "api",
      tags: ["customer"],
      projectIds: ["old-project"],
      replyEligible: true,
      commentEligible: false,
      optedOut: false,
      history: [],
    };
    const put = vi.fn(async (_kind: string, _id: string, value: unknown) => value);
    const service = {
      transaction: vi.fn(async (action: () => Promise<unknown>) => await action()),
      access: vi.fn(async () => ({
        platform: "instagram",
        connection,
        grants: { "new-project": ["message"] },
      })),
      list: vi.fn(async () => [existing]),
      accessibleContact: vi.fn(async () => existing),
      owner(principal: SocialPrincipal) {
        if (principal.kind !== "owner") throw new Error("Owner only.");
      },
      capability: vi.fn(),
      project: vi.fn(async () => ({})),
      put,
    };
    return { existing, put, service, internals: service as unknown as SocialServiceInternals };
  }

  it("atomically appends a project and binds the canonical profile while preserving the contact", async () => {
    const { existing, internals, service, put } = fixture();
    const result = await upsertSocialContact(internals, owner, input);
    expect(service.transaction).toHaveBeenCalledOnce();
    expect(service.capability).toHaveBeenCalledWith(expect.objectContaining({ platform: "instagram" }), "message.start");
    expect(service.project).toHaveBeenCalledExactlyOnceWith(owner, "new-project");
    expect(result).toEqual({
      ...existing,
      profileUrl: "https://www.instagram.com/ada.studio/",
      projectIds: ["old-project", "new-project"],
    });
    expect(put).toHaveBeenCalledExactlyOnceWith("contact", existing.id, result);
  });

  it("rejects session principals, OAuth accounts and field overrides before any write", async () => {
    const browser = fixture();
    const oauth = fixture("oauth");
    await expect(
      upsertSocialContact(browser.internals, { kind: "session" } as SocialPrincipal, input),
    ).rejects.toThrow("Owner only.");
    await expect(upsertSocialContact(oauth.internals, owner, input)).rejects.toThrow("verified browser");
    await expect(
      upsertSocialContact(browser.internals, owner, { ...input, projectIds: ["different-project"] }),
    ).rejects.toThrow();
    expect(browser.put).not.toHaveBeenCalled();
    expect(oauth.put).not.toHaveBeenCalled();
  });
});
