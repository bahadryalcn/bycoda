import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { account, fixture, recipe } from "../social-browser-publishing-test-support";
import { listTikTokRelationships, setTikTokFollowing } from "./browser-audience";
import { readTikTokAnalytics, readTikTokEarnings } from "./browser-insights";
import { replyTikTokLive, saveTikTokLiveSetup, TIKTOK_LIVE_PRODUCER_URL } from "./browser-live";
import { parseTikTokProfilePatch, updateTikTokPrivacy, updateTikTokProfile } from "./browser-profile";

const NAV = '<header><a data-e2e="nav-profile" href="/@bycoda">My profile</a></header>';
const profile = (handle: string, content: string) =>
  `<main><section data-e2e="user-profile-info"><h1 data-e2e="user-title">${handle}</h1>
  <h2 data-e2e="user-subtitle">Bycoda</h2>${content}</section></main>`;
const banner = (content: string) => `<main>${content}</main>`;
const profileEditor = (extra = "") => `<div role="dialog"><input name="nickname" value="Bycoda">
  <input name="username" value="bycoda"><textarea name="bio">Old bio</textarea>
  ${extra}<button>Save</button></div>`;

/** These fragments model the expected controls without accessing a live account. */
function browser(html: string, options: Parameters<typeof fixture>[3] = {}) {
  const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), NAV + html, {
    click: options.click,
    render: (url) => NAV + (options.render?.(url) ?? html),
  });
  vi.mocked(f.page.fill).mockImplementation(async (selector, value) => {
    const element = f.window.document.querySelector(selector);
    if (element && "value" in element) element.value = value;
  });
  return f;
}

describe("TikTok owner browser profile and privacy", () => {
  it("validates the patch and restricts URLs and unsupported fields", () => {
    expect(parseTikTokProfilePatch({ username: "Change_Me", website: "https://example.test" })).toEqual({
      username: "change_me", website: "https://example.test",
    });
    for (const invalid of [
      { password: "value" }, { username: "end." }, { avatarUploadId: "C:\\avatar.png" },
      { website: "https://user:password@example.test" }, { bio: "x".repeat(81) },
    ]) expect(() => parseTikTokProfilePatch(invalid)).toThrow(SocialPlatformError);
  });

  it("saves only the selected profile field and verifies the rendered change", async () => {
    const f = browser(profile("bycoda", '<p data-e2e="user-bio">Old bio</p><button>Edit profile</button>'), {
      click: (element) => {
        if (element.textContent === "Edit profile") f.window.document.body.insertAdjacentHTML("beforeend", profileEditor());
        if (element.textContent === "Save") {
          const dialog = f.window.document.querySelector('[role="dialog"]')!;
          f.window.document.querySelector('[data-e2e="user-bio"]')!.textContent = dialog.querySelector("textarea")!.value;
          dialog.remove();
        }
      },
    });
    await expect(updateTikTokProfile(f.ctx, { bio: "New bio" })).resolves.toMatchObject({ bio: "New bio", username: "bycoda" });
    expect(f.page.fill).toHaveBeenCalledOnce();
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
  });

  it("reports cooldown without saving or handling the verification UI", async () => {
    const html = profile("bycoda", "<button>Edit profile</button>");
    const f = browser(html, { click: () => {
      f.window.document.body.insertAdjacentHTML("beforeend", profileEditor('<p role="alert">Only once every 30 days</p>'));
      f.window.document.querySelector('input[name="username"]')!.setAttribute("disabled", "");
    } });
    await expect(updateTikTokProfile(f.ctx, { username: "new_name" })).rejects.toMatchObject({
      code: "rejected", detail: { reasonCode: "TIKTOK_PROFILE_COOLDOWN" },
    });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();

    const challenge = browser(`${html}<h2>Security verification</h2>`);
    await expect(updateTikTokProfile(challenge.ctx, { bio: "New bio" })).rejects.toMatchObject({ code: "needs_human" });
    expect(challenge.page.click).not.toHaveBeenCalled();
  });

  it("updates a known settings switch and refuses settings missing from the browser", async () => {
    const f = browser(banner('<button data-e2e="private-account-switch" role="switch" aria-checked="false">Private account</button>'), {
      click: (element) => element.setAttribute("aria-checked", "true"),
    });
    await expect(updateTikTokPrivacy(f.ctx, { privateAccount: true })).resolves.toEqual({ privateAccount: true });
    expect(f.page.click).toHaveBeenCalledOnce();
    await expect(updateTikTokPrivacy(f.ctx, { comments: "followers" })).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).toHaveBeenCalledOnce();
  });
});

describe("TikTok creator browser audience and Studio", () => {
  it("returns a bounded set from the selected followers panel", async () => {
    const f = browser(profile("bycoda", '<button><strong data-e2e="followers-count">2</strong></button>'), {
      click: () => f.window.document.body.insertAdjacentHTML("beforeend", `<div role="dialog">
        <button role="tab" aria-selected="true" aria-controls="list">Followers</button>
        <div id="list" role="tabpanel"><a href="/@view_one">Viewer one</a><a href="/@view_two">Viewer two</a></div></div>`),
    });
    await expect(listTikTokRelationships(f.ctx, "followers", 1)).resolves.toEqual({ coverage: "visible", people: [
      { platformId: "web:tiktok:view_one", username: "view_one", name: "Viewer one", url: "https://www.tiktok.com/@view_one" },
    ] });
  });

  it("runs the outbound gate before following and requires a changed relationship", async () => {
    const html = profile("viewer", '<button data-e2e="follow-button">Follow</button>');
    const f = browser(html, { click: (element) => { element.textContent = "Following"; } });
    const guard = vi.fn(async () => { throw new SocialPlatformError("denied"); });
    await expect(setTikTokFollowing(f.ctx, "web:tiktok:viewer", true, guard)).rejects.toMatchObject({ code: "denied" });
    expect(guard).toHaveBeenCalledOnce();
    expect(f.page.click).not.toHaveBeenCalled();
    guard.mockResolvedValue(undefined);
    await expect(setTikTokFollowing(f.ctx, "web:tiktok:viewer", true, guard)).resolves.toMatchObject({ following: true });
    expect(f.page.click).toHaveBeenCalledOnce();
    const uncertain = browser(html);
    await expect(setTikTokFollowing(uncertain.ctx, "web:tiktok:viewer", true, guard)).rejects.toMatchObject({ code: "unknown" });
    expect(uncertain.page.click).toHaveBeenCalledOnce();
  });

  it("preserves provider values, currency, explicit zero, and unavailable state", async () => {
    const analytics = browser(banner(`<h1>Analytics</h1><p data-e2e="analytics-period">Last 7 days</p>
      <dl><dt>Post views</dt><dd>12.3K</dd></dl><dl><dt>Comments</dt><dd>0</dd></dl>`));
    await expect(readTikTokAnalytics(analytics.ctx)).resolves.toEqual({ source: "studio", period: "Last 7 days", metrics: [
      { key: "postViews", displayValue: "12.3K" }, { key: "comments", displayValue: "0" },
    ] });
    const earnings = browser(banner(`<h1>Monetization</h1><dl><dt>Estimated rewards</dt><dd>€1.234,56</dd></dl>
      <dl><dt>Diamonds</dt><dd>Not available</dd></dl>`));
    await expect(readTikTokEarnings(earnings.ctx)).resolves.toMatchObject({ status: "available", metrics: [
      { key: "estimatedRewards", displayValue: "€1.234,56" },
    ] });
    const unavailable = browser(banner("<h1>Monetization</h1>"));
    await expect(readTikTokEarnings(unavailable.ctx)).resolves.toMatchObject({ status: "unavailable", metrics: [] });
  });
});

describe("TikTok LIVE creator browser", () => {
  const secret = "fixture-stream-key-1234";
  const setup = `<section data-e2e="live-rtmp-setup"><input readonly aria-label="Server URL" value="rtmps://push.tiktokcdn.com/live">
    <input readonly aria-label="Stream key" value="${secret}"></section>`;
  const liveBrowser = (html: string, click?: (element: Element) => void) => browser("", {
    click,
    render: (url) => url === TIKTOK_LIVE_PRODUCER_URL ? html : "",
  });

  it("writes credentials directly to the vault and leaves only a redacted receipt", async () => {
    const f = liveBrowser(setup);
    const persist = vi.fn(async () => {});
    const result = await saveTikTokLiveSetup(f.ctx, persist);
    expect(result).toEqual({ eligible: true, credentialSaved: true });
    expect(persist).toHaveBeenCalledWith({ serverUrl: "rtmps://push.tiktokcdn.com/live", streamKey: secret });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.goto).toHaveBeenLastCalledWith("https://www.tiktok.com/@bycoda");
  });

  it("redacts storage failures and distinguishes missing LIVE access", async () => {
    const failing = liveBrowser(setup);
    const error = await saveTikTokLiveSetup(failing.ctx, async () => { throw new Error(secret); }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "unknown" });
    expect(String(error)).not.toContain(secret);
    const ineligible = liveBrowser('<p data-e2e="live-ineligible">Unavailable</p>');
    const persist = vi.fn(async () => {});
    await expect(saveTikTokLiveSetup(ineligible.ctx, persist)).rejects.toMatchObject({
      code: "unsupported", detail: { reasonCode: "TIKTOK_LIVE_NOT_ELIGIBLE" },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("checks recipient and gate, and requires a new reply under the selected comment", async () => {
    const prior = '<article data-author="bycoda" data-comment-id="12" data-reply-to="10"><span data-e2e="live-comment-text">Thanks!</span></article>';
    const chat = `<section data-e2e="live-comment-panel" data-live-status="active"><article data-comment-id="10">
       <a href="/@viewer" data-e2e="live-comment-author">Viewer</a><button>Reply</button></article>${prior}</section>`;
    const f = liveBrowser(chat, (element) => {
      const panel = f.window.document.querySelector('[data-e2e="live-comment-panel"]')!;
      if (element.textContent === "Reply") panel.insertAdjacentHTML("beforeend", `<div data-e2e="live-reply-composer" data-reply-to="10"><textarea></textarea><button>Send</button></div>`);
      if (element.textContent === "Send") panel.insertAdjacentHTML("beforeend", prior.replace('data-comment-id="12"', 'data-comment-id="13"'));
    });
    const gate = vi.fn(async () => {});
    await expect(replyTikTokLive(f.ctx, { recipientId: "web:tiktok:other", commentId: "10", text: "Thanks!" }, gate)).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    await expect(replyTikTokLive(f.ctx, { recipientId: "web:tiktok:viewer", commentId: "10", text: "Thanks!" }, gate)).resolves.toEqual({ platformId: "13" });
    expect(gate).toHaveBeenCalledOnce();
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
  });
});
