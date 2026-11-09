import { describe, expect, it, vi } from "vitest";
import type { SocialContact } from "../../../src/features/social/model/social";
import { eraseSocialContact } from "./social-contacts";

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
