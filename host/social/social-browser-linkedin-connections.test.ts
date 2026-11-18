import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import {
  linkedInAcceptInvitation,
  linkedInNetworkAction,
  linkedInReadNetwork,
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
  beforeSubmit: ReturnType<typeof vi.fn>;
} => ({
  reserve: vi.fn(async () => undefined),
  record: vi.fn(async () => undefined),
  beforeSubmit: vi.fn(async () => undefined),
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
            element.ownerDocument.body.innerHTML = `${owner}<main><p>· 2.</p><button>Beklemede</button></main>`;
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
    expect(gate.beforeSubmit).toHaveBeenCalledWith("synthetic", recipient);
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
      `${owner}<main><p>· 1.</p><div data-view-name="edge-creation-connect-action"><a href="/in/ada-example/">Bağlantı kur</a></div></main>`,
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
          if (element.getAttribute("data-bycoda-li-invitation") === "accept")
            element.ownerDocument.body.innerHTML = `${owner}<main><div><div><a href="/in/grace-example/">Grace Example</a></div></div></main>`;
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
    const card = `<div><a href="/in/ada-example/">Ada Example</a><button><span>Kabul et</span></button></div>`;
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><div>${card}${card}</div></main>`,
    );
    await expect(
      linkedInAcceptInvitation(f.ctx, { senderId: recipient }, gate),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("denies when the only Connect control belongs to a suggestion card for another member", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><p>· 2.</p><aside><div data-view-name="edge-creation-connect-action"><button>Bağlantı kur</button></div></aside></main>`,
    );
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: recipient }, gate),
    ).rejects.toMatchObject({ code: "denied" });
    expect(gate.record).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("stops without clicking when one invitation card holds several members", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><div><a href="/in/ada-example/">Ada</a><a href="/in/grace-example/">Grace</a><button>Kabul et</button></div></main>`,
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

  it("stops before click and daily charge when the target becomes suppressed", async () => {
    const gate = limiter();
    gate.beforeSubmit.mockRejectedValueOnce(new SocialPlatformError("denied"));
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      fixtureHtml("profile-connectable.html"),
    );
    await expect(
      linkedInNetworkAction(f.ctx, { kind: "invite", targetId: recipient }, gate),
    ).rejects.toMatchObject({ code: "denied" });
    expect(gate.beforeSubmit).toHaveBeenCalledWith("synthetic", recipient);
    expect(gate.record).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("asks the owner to add a note without clicking the potentially submitting Connect control", async () => {
    const gate = limiter();
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      fixtureHtml("profile-connectable.html"),
    );
    await expect(
      linkedInSendConnectionRequest(f.ctx, { recipientId: recipient, note: "Hello" }, gate),
    ).rejects.toMatchObject({ code: "needs_human" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(gate.record).not.toHaveBeenCalled();
  });

  it("reads only identity-bound invitation cards without clicking", async () => {
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      fixtureHtml("invitation-manager.html"),
      {
        render: () =>
          fixtureHtml("invitation-manager.html").replace(
            "</main>",
            '<a href="/in/unrelated/">Suggested member</a></main>',
          ),
      },
    );
    await expect(linkedInReadNetwork(f.ctx, "invitations.received")).resolves.toEqual({
      complete: false,
      people: [
        {
          platformId: recipient,
          url: "https://www.linkedin.com/in/ada-example/",
          name: "Ada Example",
        },
        {
          platformId: "web:linkedin:in:grace-example",
          url: "https://www.linkedin.com/in/grace-example/",
          name: "Grace Example",
        },
      ],
    });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("holds on a challenge without inspecting or clicking invitation controls", async () => {
    const gate = limiter();
    const f = fixture(linkedinBrowserRecipe, memberAccount(), fixtureHtml("captcha-feed.html"));
    await expect(
      linkedInNetworkAction(f.ctx, { kind: "ignore", targetId: recipient }, gate),
    ).rejects.toMatchObject({ code: "needs_human" });
    expect(gate.beforeSubmit).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });
});
