import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import {
  linkedInAcceptInvitation,
  linkedInSendConnectionRequest,
  type LinkedInConnectionLimiter,
} from "./social-browser-linkedin-connections";
import { linkedinBrowserRecipe } from "./social-browser-linkedin";
import { account, fixture, now } from "./social-browser-publishing-test-support";

const fixtureHtml = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/linkedin/${name}`, import.meta.url)), "utf8");
const owner = `<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>`;
const memberAccount = () => account("linkedin", "web:linkedin:in:bycoda-owner");
const recipient = "web:linkedin:in:ada-example";
const limiter = (): LinkedInConnectionLimiter & {
  reserve: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
} => ({
  reserve: vi.fn(async () => undefined),
  record: vi.fn(async () => undefined),
});

describe("LinkedIn connection invitations", () => {
  it("sends a plain invitation: the Connect click is the send, counted and marked first", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      fixtureHtml("profile-connectable.html"),
      {
        click: (element) => {
          if (element.getAttribute("data-bycoda-web-control") === "connect")
            element.ownerDocument.body.innerHTML = `${owner}<main><h1>Ada Example</h1><button>Pending</button></main>`;
        },
        render: (url) =>
          url.includes("/in/ada-example") ? fixtureHtml("profile-connectable.html") : owner,
      },
    );
    const result = await linkedInSendConnectionRequest(f.ctx, { recipientId: recipient }, gate);
    expect(result).toEqual({
      platformId: recipient,
      url: "https://www.linkedin.com/in/ada-example/",
    });
    expect(gate.reserve).toHaveBeenCalledWith("synthetic");
    expect(gate.record).toHaveBeenCalledWith("synthetic");
    expect(f.ctx.markSubmitted).toHaveBeenCalled();
  });

  it("refuses before navigation when the daily or gap gate refuses", async () => {
    const gate = limiter();
    gate.reserve.mockRejectedValueOnce(new SocialPlatformError("rate_limit", now + 1000));
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner);
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: recipient }, gate),
    ).rejects.toMatchObject({ code: "rate_limit" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(gate.record).not.toHaveBeenCalled();
  });

  it("denies a first-degree profile, which has no Connect control", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><h1>Ada Example</h1><span class="distance-badge">1st</span><button>Connect</button></main>`,
    );
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: recipient }, gate),
    ).rejects.toMatchObject({ code: "denied" });
    expect(gate.record).not.toHaveBeenCalled();
  });

  it("rejects a note over the invitation limit before any browser action", async () => {
    const gate = limiter();
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner);
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: recipient, note: "x".repeat(301) }, gate),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(gate.reserve).not.toHaveBeenCalled();
  });

  it("accepts the one invitation that links to the named member", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      fixtureHtml("invitation-manager.html"),
      {
        click: (element) => {
          if (element.getAttribute("data-bycoda-li-accept") === "true")
            element.ownerDocument.body.innerHTML = `${owner}<main><ul><li><a href="/in/grace-example/">Grace Example</a></li></ul></main>`;
        },
      },
    );
    const result = await linkedInAcceptInvitation(f.ctx, { senderId: recipient }, gate);
    expect(result.platformId).toBe(recipient);
    expect(gate.record).toHaveBeenCalledTimes(1);
    expect(f.ctx.markSubmitted).toHaveBeenCalled();
  });

  it("stops without clicking when two invitation cards match the same member", async () => {
    const gate = limiter();
    const card = `<li><a href="/in/ada-example/">Ada Example</a><button aria-label="Accept Ada Example's invitation">Accept</button></li>`;
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><ul>${card}${card}</ul></main>`,
    );
    await expect(
      linkedInAcceptInvitation(f.ctx, { senderId: recipient }, gate),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("rejects organization accounts and non-member identifiers", async () => {
    const gate = limiter();
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner);
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: "urn:li:person:x" }, gate),
    ).rejects.toMatchObject({ code: "denied" });
    expect(gate.reserve).not.toHaveBeenCalled();
  });
});
