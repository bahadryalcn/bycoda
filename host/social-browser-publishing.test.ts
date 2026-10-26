import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import { SocialPlatformError } from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipe, BrowserRecipeContext } from "./social-browser-recipe";
import {
  linkedInBrowserConnectionUrl,
  linkedInCreatedId,
  publishingBrowserRecipes,
  snapchatBrowserConnectionUrl,
  tiktokCommentCreatedId,
  tiktokCommentRows,
  tiktokVideoCreatedId,
  youtubeCommentCreatedId,
} from "./social-browser-publishing";

const now = Date.parse("2026-10-26T10:00:00Z");
const recipe = (platform: SocialAccount["platform"]) =>
  publishingBrowserRecipes.find((item) => item.platform === platform)!;
const account = (
  platform: SocialAccount["platform"],
  platformId: string,
  accountType: SocialAccount["accountType"] = "member",
): SocialAccount => ({
  id: "synthetic",
  platform,
  platformId,
  name: "Bycoda",
  accountType,
  scopes: [],
  connected: true,
  accessApproved: true,
  connection: "browser",
  paused: false,
  executorId: "synthetic-host",
  grants: {},
  createdAt: 1,
});
const job = (
  kind: SocialJob["kind"] = "publish",
  payload: Partial<SocialJob["payload"]> = {},
): SocialJob => ({
  id: "job",
  operationId: "operation",
  dedupeKey: "key",
  accountId: "synthetic",
  projectIds: [],
  provider: "owner",
  actorId: "owner",
  kind,
  payload: { text: "A Bycoda update", media: [], ...payload },
  status: "running",
  scheduledAt: now,
  attempts: 1,
  createdAt: now,
});

function fixture(
  target: BrowserRecipe,
  own: SocialAccount,
  html: string,
  options: {
    render?(url: string): string;
    click?(element: Element): void;
    response?: string;
  } = {},
) {
  const window = new Window({ url: target.loginUrl });
  window.document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  const page: BrowserPage = {
    goto: vi.fn(async (url) => {
      window.location.href = url;
      if (options.render) window.document.body.innerHTML = options.render(url);
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression) as T),
    click: vi.fn(async (selector) => {
      const element = window.document.querySelector(selector);
      if (!element) throw new Error("Missing unique control");
      options.click?.(element as unknown as Element);
    }),
    fill: vi.fn(async (selector, value) => {
      const element = window.document.querySelector(selector);
      if (!element) throw new Error("Missing editor");
      element.textContent = value;
    }),
    insertText: vi.fn(async () => {}),
    setFiles: vi.fn(async () => {}),
    cookies: vi.fn(async () => {
      throw new Error("No credential reads allowed");
    }),
    watchResponse: vi.fn((_path, accept) => ({
      body: vi.fn(async () =>
        options.response && (!accept || accept(options.response)) ? options.response : undefined,
      ),
      stop: vi.fn(),
    })),
  };
  const ctx: BrowserRecipeContext = {
    page,
    account: own,
    files: [],
    now: () => now,
    waitFor: async <T>(expression: string) => await page.evaluate<T>(expression),
    verifyIdentity: vi.fn(async () => {
      if ((await target.identity(page, own))?.platformId !== own.platformId)
        throw new SocialPlatformError("denied");
    }),
    markSubmitted: vi.fn(),
  };
  return { page, ctx, window };
}

const liIdentity = `<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>`;
const liEditor = `${liIdentity}<button class="share-box-feed-entry__trigger">Start a post</button><div role="dialog"><div class="ql-editor" contenteditable="true"></div><button class="share-actions__primary-action">Post</button></div>`;
const liId = "urn:li:activity:123456789";
const liPersisted = (owner = "bycoda-owner", text = "A Bycoda update") =>
  `${liIdentity}<article data-urn="${liId}"><a class="update-components-actor__meta-link" href="/in/${owner}/">Author</a><div class="update-components-text">${text}</div></article>`;

describe("explicit LinkedIn Page connection target", () => {
  const fresh = () => account("linkedin", "", "organization");
  it("requires a fresh Page target rather than using the account's human label", () => {
    const own = fresh();
    own.name = "Bycoda";
    expect(() => linkedInBrowserConnectionUrl(own)).toThrow("Page ID or URL name");
    expect(linkedInBrowserConnectionUrl(own, "123456")).toBe(
      "https://www.linkedin.com/company/123456/admin/page-posts/published/",
    );
    expect(linkedInBrowserConnectionUrl(own, "Bycoda-Official")).toBe(
      "https://www.linkedin.com/company/bycoda-official/admin/page-posts/published/",
    );
  });
  it("accepts only an exact company URL and canonicalizes to the selected Page admin surface", () => {
    expect(linkedInBrowserConnectionUrl(fresh(), "https://www.linkedin.com/company/bycoda/")).toBe(
      "https://www.linkedin.com/company/bycoda/admin/page-posts/published/",
    );
    expect(
      linkedInBrowserConnectionUrl(
        fresh(),
        "https://www.linkedin.com/company/123/admin/page-posts/published/",
      ),
    ).toBe("https://www.linkedin.com/company/123/admin/page-posts/published/");
  });
  it.each([
    "https://www.linkedin.com.evil.example/company/bycoda/",
    "https://owner:secret@www.linkedin.com/company/bycoda/",
    "https://www.linkedin.com/company/bycoda/?token=secret",
    "https://www.linkedin.com/company/bycoda/#identity",
    "https://www.linkedin.com/company/bycoda/admin/settings/",
    "https://www.linkedin.com/in/bycoda/",
    "../bycoda",
    "bycoda?token=secret",
  ])("rejects unsafe or unrelated target %s", (target) => {
    expect(() => linkedInBrowserConnectionUrl(fresh(), target)).toThrow();
  });
  it("derives reconnect targets only from the saved canonical Page identity", () => {
    const own = account("linkedin", "web:linkedin:company:bycoda", "organization");
    expect(linkedInBrowserConnectionUrl(own)).toBe(
      "https://www.linkedin.com/company/bycoda/admin/page-posts/published/",
    );
    expect(() => linkedInBrowserConnectionUrl(own, "different-page")).toThrow(
      "previously verified",
    );
    expect(() =>
      linkedInBrowserConnectionUrl(
        account("linkedin", "urn:li:organization:123", "organization"),
        "123",
      ),
    ).toThrow("separate browser account");
  });
  it("keeps member setup on the ordinary feed", () => {
    expect(linkedInBrowserConnectionUrl(account("linkedin", "web:linkedin:in:owner"))).toBe(
      "https://www.linkedin.com/feed/",
    );
    expect(() =>
      linkedInBrowserConnectionUrl(account("linkedin", "web:linkedin:in:owner"), "bycoda"),
    ).toThrow("does not accept");
  });
});

describe("LinkedIn ordinary browser post", () => {
  it("distinguishes the signed-in sidebar identity from unrelated profile links", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      `${liIdentity}<main><a href="/in/stranger/">A different author</a></main>`,
    );
    await expect(recipe("linkedin").identity(f.page, f.ctx.account)).resolves.toEqual({
      platformId: "web:linkedin:in:bycoda-owner",
      name: "Owner",
    });
  });
  it("does not infer an organization from the owner's member identity", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:company:123", "organization"),
      liEditor,
    );
    await expect(recipe("linkedin").identity(f.page, f.ctx.account)).resolves.toBeUndefined();
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
  it("rejects conflicting authenticated identity controls", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      `${liIdentity}<a data-control-name="identity_profile_photo" href="/in/other-owner/">Other account</a>`,
    );
    await expect(recipe("linkedin").identity(f.page)).resolves.toBeUndefined();
  });
  it("requires an exact persisted post after one platform acknowledgement", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      {
        response: JSON.stringify({ value: { entityUrn: liId } }),
        render: (url) => (url.includes("/feed/update/") ? liPersisted() : liEditor),
      },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).resolves.toEqual({
      platformId: liId,
      url: `https://www.linkedin.com/feed/update/${encodeURIComponent(liId)}/`,
    });
    expect(f.page.click).toHaveBeenCalledTimes(2);
    expect(f.ctx.verifyIdentity).toHaveBeenCalled();
    expect(f.page.cookies).not.toHaveBeenCalled();
  });
  it("holds an acknowledged ID whose persisted author is different", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      {
        response: JSON.stringify({ value: { entityUrn: liId } }),
        render: (url) => (url.includes("/feed/update/") ? liPersisted("other-owner") : liEditor),
      },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.click).toHaveBeenCalledTimes(2);
  });
  it("marks the final Post only and holds an account switch during acknowledged-post readback", async () => {
    let submitted = false;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      {
        response: JSON.stringify({ value: { entityUrn: liId } }),
        render: (url) =>
          url.includes("/feed/update/")
            ? liPersisted().replace("/in/bycoda-owner/", "/in/switched-owner/")
            : liEditor,
        click: (el) => {
          if (el.matches(".share-actions__primary-action")) {
            expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
            submitted = true;
          } else expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
        },
      },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
    expect(submitted).toBe(true);
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
    expect(f.page.click).toHaveBeenCalledTimes(2);
  });
  it("marks comment submission before clicking and holds an identity failure during comment readback", async () => {
    let submitted = false;
    const row = `<div class="comments-comment-item" data-id="urn:li:comment:(123,456)"><a class="comments-post-meta__profile-link" href="/in/bycoda-owner/">Owner</a><div class="comments-comment-item__main-content">A Bycoda update</div><time datetime="${new Date(now).toISOString()}"></time></div>`;
    const html = () =>
      `${submitted ? liIdentity.replace("/in/bycoda-owner/", "/in/switched-owner/") : liIdentity}<div class="comments-comments-list">${submitted ? row : '<div class="comments-empty-state">No comments yet</div>'}</div><div class="comments-comment-box"><div class="ql-editor" contenteditable="true"></div><button class="comments-comment-box__submit-button">Comment</button></div>`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.matches(".comments-comment-box__submit-button")) {
            expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
            submitted = true;
          }
        },
      },
    );
    await expect(
      recipe("linkedin").send(f.ctx, job("comment", { postId: liId })),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(submitted).toBe(true);
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
    expect(f.page.click).toHaveBeenCalledOnce();
  });
  it("never accepts an optimistic composer echo without an acknowledged platform ID", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      { response: JSON.stringify({ value: { text: "A Bycoda update" } }), render: () => liEditor },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.click).toHaveBeenCalledTimes(2);
  });
  it("does not call a missing comment list an empty inbox", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liIdentity,
    );
    await expect(recipe("linkedin").poll(f.ctx, [liId])).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it("does not confuse a still-loading or malformed comment list with a verified empty list", async () => {
    for (const markup of [
      '<div class="comments-comments-list"></div>',
      '<div class="comments-comments-list"><div class="comments-comment-item">Unknown comment format</div></div>',
    ]) {
      const f = fixture(
        recipe("linkedin"),
        account("linkedin", "web:linkedin:in:bycoda-owner"),
        liIdentity + markup,
      );
      await expect(recipe("linkedin").poll(f.ctx, [liId])).rejects.toMatchObject({
        code: "unsupported",
      });
    }
  });
  it("accepts a recognized empty comment state while reporting unavailable message coverage", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liIdentity +
        '<div class="comments-comments-list"><div class="comments-empty-state">No comments yet</div></div>',
    );
    const result = await recipe("linkedin").poll(f.ctx, [liId]);
    expect(result.events).toEqual([]);
    expect(result.coverage).toContainEqual({ channel: "comments", status: "read" });
    expect(result.coverage).toContainEqual({
      channel: "messages",
      status: "unavailable",
      reason: "response_unavailable",
    });
  });
  it("preserves an existing post-composer draft rather than overwriting it", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor.replace(
        '<div class="ql-editor" contenteditable="true"></div>',
        '<div class="ql-editor" contenteditable="true">An unfinished owner draft</div>',
      ),
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.click).toHaveBeenCalledTimes(1);
  });
  it("will not imply complete comment discovery when no saved posts exist", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liIdentity,
    );
    await expect(recipe("linkedin").poll(f.ctx, [])).rejects.toMatchObject({ code: "unsupported" });
  });
  it("does not allow a token/foreign URL to become a target post selector", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liIdentity,
    );
    await expect(
      recipe("linkedin").send(f.ctx, job("comment", { postId: "https://evil.example/" })),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.goto).not.toHaveBeenCalled();
  });
});

describe("YouTube channel and comment acknowledgement", () => {
  const channel = "UCabcdefghijklmnopqrstuv";
  const replyId = "UgxyzReply_12345";
  const ack = (owner = channel, text = "A Bycoda update") =>
    JSON.stringify({
      actions: [
        {
          createCommentReplyAction: {
            commentRenderer: {
              commentId: replyId,
              contentText: { runs: [{ text }] },
              authorEndpoint: { browseEndpoint: { browseId: owner } },
            },
          },
        },
      ],
    });
  it("accepts only the exact comment text and selected author channel", () => {
    expect(youtubeCommentCreatedId(ack(), "A Bycoda update", channel)).toBe(replyId);
    expect(
      youtubeCommentCreatedId(ack("UCwrongabcdefghijklmnopq"), "A Bycoda update", channel),
    ).toBeUndefined();
    expect(
      youtubeCommentCreatedId(ack(channel, "Other text"), "A Bycoda update", channel),
    ).toBeUndefined();
  });
  it("ignores unrelated player/guide actions and malformed envelopes", () => {
    expect(
      youtubeCommentCreatedId(
        JSON.stringify({ actions: [{ commentId: replyId }] }),
        "A Bycoda update",
        channel,
      ),
    ).toBeUndefined();
    expect(youtubeCommentCreatedId("not JSON", "A Bycoda update", channel)).toBeUndefined();
  });
  it("requires the authenticated Studio channel to match the navigation link", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">Bycoda</a></ytcp-app>`,
    );
    f.window.location.href = `https://studio.youtube.com/channel/${channel}/videos/upload`;
    await expect(recipe("youtube").identity(f.page)).resolves.toEqual({
      platformId: `web:youtube:${channel}`,
      name: "Bycoda",
    });
    f.window.location.href =
      "https://studio.youtube.com/channel/UC0000000000000000000000/videos/upload";
    await expect(recipe("youtube").identity(f.page)).resolves.toBeUndefined();
  });
  it("rejects incomplete audience/synthetic declarations before uploading a file", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      "<ytcp-app></ytcp-app>",
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("youtube").send(f.ctx, job("publish", { media: [{ kind: "video", uploadId: "id" }] })),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
  it("rejects forbidden description characters before media upload", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      "<ytcp-app></ytcp-app>",
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("youtube").send(
        f.ctx,
        job("publish", {
          text: "bad <description>",
          media: [{ kind: "video", uploadId: "id" }],
          youtube: {
            title: "Bycoda",
            privacy: "private",
            madeForKids: false,
            containsSyntheticMedia: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

describe("TikTok recognized response boundaries", () => {
  const post = "1234567890123";
  const comment = {
    cid: "4567890123456",
    aweme_id: post,
    text: "Hello",
    create_time: now / 1000,
    user: { unique_id: "viewer", nickname: "Viewer" },
  };
  it("parses a bounded comment response tied to the opened video", () => {
    expect(
      tiktokCommentRows(JSON.stringify({ status_code: 0, comments: [comment] }), post),
    ).toEqual([
      {
        id: comment.cid,
        postId: post,
        contactId: "web:tiktok:viewer",
        name: "Viewer",
        text: "Hello",
        at: now,
      },
    ]);
    expect(tiktokCommentRows(JSON.stringify({ status_code: 0, comments: [] }), post)).toEqual([]);
  });
  it("rejects wrong-video and unrecognized payloads instead of empty reads", () => {
    expect(
      tiktokCommentRows(
        JSON.stringify({ status_code: 0, comments: [{ ...comment, aweme_id: "999" }] }),
        post,
      ),
    ).toBeUndefined();
    expect(tiktokCommentRows(JSON.stringify({ status_code: 0 }), post)).toBeUndefined();
    expect(
      tiktokCommentRows(JSON.stringify({ status_code: 1, comments: [] }), post),
    ).toBeUndefined();
  });
  it("binds comment delivery to sender, exact text and video", () => {
    const raw = JSON.stringify({ status_code: 0, comment });
    expect(tiktokCommentCreatedId(raw, post, "Hello", "web:tiktok:viewer")).toBe(comment.cid);
    expect(tiktokCommentCreatedId(raw, post, "Hello", "web:tiktok:other")).toBeUndefined();
    expect(tiktokCommentCreatedId(raw, "999", "Hello", "web:tiktok:viewer")).toBeUndefined();
    expect(tiktokCommentCreatedId(raw, post, "Different", "web:tiktok:viewer")).toBeUndefined();
  });
  it("does not treat a media-upload ID or a failed create response as a published video ID", () => {
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 0, data: { upload_id: "123" } })),
    ).toBeUndefined();
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 5, data: { video_id: "123" } })),
    ).toBeUndefined();
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 0, data: { video_id: "123" } })),
    ).toBe("123");
  });
  it("does not take a viewed creator profile as authenticated identity", async () => {
    const f = fixture(
      recipe("tiktok"),
      account("tiktok", "web:tiktok:bycoda"),
      '<main><a href="/@bycoda">Bycoda profile</a></main>',
    );
    await expect(recipe("tiktok").identity(f.page)).resolves.toBeUndefined();
  });
  it("requires explicit music consent and valid privacy before uploading", async () => {
    const f = fixture(
      recipe("tiktok"),
      account("tiktok", "web:tiktok:bycoda"),
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header>',
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("tiktok").send(
        f.ctx,
        job("publish", {
          media: [{ kind: "video", uploadId: "id" }],
          tiktok: {
            privacy: "SELF_ONLY",
            durationSeconds: 30,
            allowComment: true,
            allowDuet: false,
            allowStitch: false,
            brandContent: false,
            brandOrganic: false,
            isAigc: false,
            consent: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

describe("Snapchat existing-chat boundaries", () => {
  const own = account("snapchat", "web:snapchat:bycoda");
  const header =
    '<nav data-testid="chat-list"></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>';
  it("uses an own-profile surface and rejects a friend's profile as sender", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    await expect(recipe("snapchat").identity(f.page)).resolves.toEqual({
      platformId: own.platformId,
      name: "@bycoda",
      accountType: "member",
    });
    f.window.document.body.innerHTML =
      '<nav data-testid="chat-list"></nav><div data-testid="friend-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>';
    await expect(recipe("snapchat").identity(f.page)).resolves.toBeUndefined();
  });
  it("accepts the current Snapchat Web redirect while rejecting a public marketing route", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    f.window.location.href = "https://www.snapchat.com/web/";
    await expect(recipe("snapchat").identity(f.page, own)).resolves.toMatchObject({
      platformId: own.platformId,
    });
    f.window.location.href = "https://www.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, own)).resolves.toBeUndefined();
  });
  it("requires an observed existing conversation and exact recipient before editing", async () => {
    const f = fixture(
      recipe("snapchat"),
      own,
      header.replace(
        '<nav data-testid="chat-list"></nav>',
        '<nav data-testid="chat-list"><a href="/?chatId=thread-12345" data-username="friend">Friend</a></nav>',
      ),
    );
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("message", { recipientId: "web:snapchat:different", threadId: "thread-12345" }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("does not report an empty inbox for an unrecognized chat list", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    await expect(recipe("snapchat").poll(f.ctx, [])).rejects.toMatchObject({ code: "unsupported" });
  });
  it("supports the host's kind=reply existing-DM job and verifies persistence after reopening", async () => {
    let sent = false,
      submissions = 0;
    const message = (id: string, sender: string, to: string, text: string) =>
      `<div data-message-id="${id}" data-sender-username="${sender}" data-recipient-username="${to}"><span data-message-text>${text}</span><time datetime="${new Date(now).toISOString()}"></time></div>`;
    const html =
      () => `<nav data-testid="chat-list"><a href="/?chatId=thread-12345" data-username="friend">Friend</a></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>
      <div data-conversation-id="thread-12345"><span data-participant-username="bycoda"></span><span data-participant-username="friend"></span>
      ${message("old-message-123", "friend", "bycoda", "Hello")}${sent ? message("new-message-456", "bycoda", "friend", "A Bycoda update") : ""}
      <textarea aria-label="Send a chat"></textarea><button aria-label="Send">Send</button></div>`;
    const f = fixture(recipe("snapchat"), own, html(), {
      render: html,
      click: (el) => {
        if (el.getAttribute("aria-label") === "Send") {
          sent = true;
          submissions++;
        }
      },
    });
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("reply", { recipientId: "web:snapchat:friend", threadId: "thread-12345" }),
      ),
    ).resolves.toEqual({ platformId: "new-message-456" });
    expect(submissions).toBe(1);
  });
});

describe("authenticated uploaded video journeys", () => {
  it("carries explicit YouTube declarations through the wizard and reopens the saved channel row", async () => {
    const channel = "UCabcdefghijklmnopqrstuv",
      video = "abcDEF123_-";
    let saved = false,
      next = 0;
    const html =
      () => `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">Bycoda</a>
      ${
        saved
          ? `<ytcp-video-row><a id="video-title" href="/video/${video}/edit">Bycoda release</a><span id="visibility">Private</span><span id="status">Checks complete</span></ytcp-video-row>`
          : `
      <ytcp-button id="create-icon">Create</ytcp-button><tp-yt-paper-item>Upload videos</tp-yt-paper-item><ytcp-uploads-dialog>
      <input type="file"><div id="title-textarea"><div id="textbox" contenteditable="true"></div></div><div id="description-textarea"><div id="textbox" contenteditable="true"></div></div>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK"></tp-yt-paper-radio-button><ytcp-video-metadata-editor-advanced><ytcp-form-section><h3>Altered content</h3><div role="radio">Yes</div><div role="radio">No</div></ytcp-form-section></ytcp-video-metadata-editor-advanced>
      <ytcp-button id="next-button">Next</ytcp-button><ytcp-button id="done-button">Save</ytcp-button></ytcp-uploads-dialog>`
      }</ytcp-app>`;
    let f: ReturnType<typeof fixture>;
    f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.id === "next-button" && ++next === 3)
            f.window.document
              .querySelector("ytcp-uploads-dialog")!
              .insertAdjacentHTML(
                "beforeend",
                '<tp-yt-paper-radio-button name="PRIVATE"></tp-yt-paper-radio-button>',
              );
          if (el.matches('tp-yt-paper-radio-button,[role="radio"]')) el.setAttribute("checked", "");
          if (el.id === "done-button") {
            saved = true;
            f.window.document.body.innerHTML = html();
          }
        },
      },
    );
    vi.mocked(f.page.setFiles).mockImplementation(async () => {
      f.window.document
        .querySelector("ytcp-uploads-dialog")!
        .insertAdjacentHTML("beforeend", `<a href="https://youtu.be/${video}">Uploaded video</a>`);
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    const sent = job("publish", {
      text: "A product video",
      media: [{ kind: "video", uploadId: "id" }],
      youtube: {
        title: "Bycoda release",
        privacy: "private",
        madeForKids: false,
        containsSyntheticMedia: false,
      },
    });
    await expect(recipe("youtube").send(f.ctx, sent)).resolves.toEqual({
      platformId: video,
      url: `https://www.youtube.com/watch?v=${video}`,
      visibility: "private",
    });
    expect(next).toBe(3);
    expect(f.page.setFiles).toHaveBeenCalledOnce();
    expect(f.page.fill).toHaveBeenCalledWith(expect.any(String), "Bycoda release");
    expect(f.page.fill).toHaveBeenCalledWith(expect.any(String), "A product video");
  });
  it("reads TikTok creator choices from visible upload controls instead of assuming all privacy settings", async () => {
    const html =
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div><div data-e2e="upload-info">Videos up to 10 minutes</div><input name="comment" type="checkbox"><input name="duet" type="checkbox" disabled><input name="stitch" type="checkbox">';
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html, {
      render: () => html,
    });
    await expect(recipe("tiktok").creatorInfo!(f.ctx)).resolves.toEqual({
      nickname: "Bycoda",
      privacyOptions: ["SELF_ONLY"],
      maxDurationSeconds: 600,
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
    });
  });
  it("does not invent a TikTok duration limit when the uploader exposes none", async () => {
    const html =
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div>';
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html, {
      render: () => html,
    });
    await expect(recipe("tiktok").creatorInfo!(f.ctx)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it("requires every requested TikTok switch and confirms the acknowledged video on the owner's profile", async () => {
    let published = false;
    const post = "123456789012345";
    const html = () =>
      `<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header>${
        published
          ? `<div data-e2e="user-post-item"><a href="/@bycoda/video/${post}">Video</a><div data-e2e="user-post-item-desc">A Bycoda update</div></div>`
          : `
      <input type="file" accept="video/*"><div data-e2e="caption-editor" contenteditable="true"></div><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div>
      ${["allow-comment", "allow-duet", "allow-stitch", "content-disclosure", "ai-generated-content", "music-usage-confirmation"].map((name) => `<input type="checkbox" name="${name}">`).join("")}<button data-e2e="post_video_button">Post</button>`
      }`;
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html(), {
      render: html,
      response: JSON.stringify({ status_code: 0, data: { video_id: post } }),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.getAttribute("data-e2e") === "post_video_button") published = true;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("tiktok").send(
        f.ctx,
        job("publish", {
          media: [{ kind: "video", uploadId: "id" }],
          tiktok: {
            privacy: "SELF_ONLY",
            durationSeconds: 30,
            allowComment: true,
            allowDuet: false,
            allowStitch: false,
            brandContent: false,
            brandOrganic: false,
            isAigc: false,
            consent: true,
          },
        }),
      ),
    ).resolves.toEqual({ platformId: post, url: `https://www.tiktok.com/@bycoda/video/${post}` });
    expect(f.page.setFiles).toHaveBeenCalledOnce();
  });
});

describe("LinkedIn existing member chats", () => {
  function chat(
    options: { wrongRecipient?: boolean; oldDraft?: boolean; disappear?: boolean } = {},
  ) {
    let sent = false;
    const row = (id: string, text: string) =>
      `<div class="msg-s-message-group"><a class="msg-s-message-group__profile-link" href="/in/bycoda-owner/">Owner</a><div data-event-urn="urn:li:fsd_message:${id}"><div class="msg-s-event-listitem__body">${text}</div><time datetime="${new Date(now).toISOString()}"></time></div></div>`;
    const html =
      () => `${liIdentity}<div class="msg-conversations-container"><a class="msg-conversation-listitem__link" href="/messaging/thread/thread-1234/">Friend</a></div>
      <div class="msg-thread"><a class="msg-thread__link-to-profile" href="/in/${options.wrongRecipient ? "other" : "friend"}/">Friend</a><div class="msg-s-message-list">${row("old_12345", "Earlier")}${sent && !options.disappear ? row("new_67890", "A Bycoda update") : ""}</div>
      <div class="msg-form__contenteditable" contenteditable="true">${options.oldDraft ? "Unfinished personal draft" : ""}</div><button class="msg-form__send-button">Send</button></div>`;
    let submissions = 0;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.matches(".msg-form__send-button")) {
            sent = true;
            submissions++;
          }
        },
      },
    );
    return {
      ...f,
      submissions: () => submissions,
      message: job("message", { threadId: "thread-1234", recipientId: "web:linkedin:in:friend" }),
    };
  }
  it("checks the opened one-to-one participant before filling or sending", async () => {
    const f = chat({ wrongRecipient: true });
    await expect(recipe("linkedin").send(f.ctx, f.message)).rejects.toMatchObject({
      code: "denied",
    });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.submissions()).toBe(0);
  });
  it("preserves an existing unsent draft", async () => {
    const f = chat({ oldDraft: true });
    await expect(recipe("linkedin").send(f.ctx, f.message)).rejects.toMatchObject({
      code: "denied",
    });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.submissions()).toBe(0);
  });
  it("confirms a new remotely persisted message after reopening the exact conversation", async () => {
    const f = chat();
    await expect(recipe("linkedin").send(f.ctx, f.message)).resolves.toEqual({
      platformId: "urn:li:fsd_message:new_67890",
      url: "https://www.linkedin.com/messaging/thread/thread-1234/",
    });
    expect(f.submissions()).toBe(1);
  });
  it("routes a host DM reply job to its conversation rather than a post-comment editor", async () => {
    const f = chat();
    f.message.kind = "reply";
    await expect(recipe("linkedin").send(f.ctx, f.message)).resolves.toMatchObject({
      platformId: "urn:li:fsd_message:new_67890",
    });
    expect(f.submissions()).toBe(1);
  });
  it("holds a message absent after reopen and never clicks Send twice", async () => {
    const f = chat({ disappear: true });
    await expect(recipe("linkedin").send(f.ctx, f.message)).rejects.toMatchObject({
      code: "unknown",
    });
    expect(f.submissions()).toBe(1);
  });
});

describe("Snapchat official web Spotlight upload", () => {
  const own = account("snapchat", "web:snapchat:public_profile:bycoda", "public_profile");
  const options = (
    terms: boolean,
    extraProfile = false,
  ) => `<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div></header><main>
    <input type="file" accept="video/*"><label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></label>
    ${extraProfile ? '<label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/other">Other</a></label>' : ""}
    <label><input type="checkbox" name="spotlight">Spotlight Snaps</label><textarea name="caption"></textarea><label><input type="checkbox" name="creatorTerms" ${terms ? "checked" : ""}>Creator Terms</label><button>Post to Snapchat</button></main>`;
  it("does not accept Creator Terms on the owner's behalf", async () => {
    let submissions = 0;
    const f = fixture(recipe("snapchat"), own, options(false), {
      render: () => options(false),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submissions++;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(submissions).toBe(0);
  });
  it("refuses an upload selecting another Public Profile in addition to this account", async () => {
    let submissions = 0;
    const f = fixture(recipe("snapchat"), own, options(true, true), {
      render: () => options(true, true),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submissions++;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(submissions).toBe(0);
  });
  it("requires one newly persisted Spotlight with exact owner/text and a recent remote timestamp", async () => {
    let submitted = false;
    const publicUrl = "https://www.snapchat.com/spotlight/post_12345678";
    const html = () =>
      options(true) +
      (submitted
        ? `<article><a href="${publicUrl}">Spotlight</a><a href="https://www.snapchat.com/add/bycoda">Bycoda</a><div class="caption">A Bycoda update</div><time datetime="${new Date(now).toISOString()}"></time></article>`
        : "");
    const f = fixture(recipe("snapchat"), own, html(), {
      render: html,
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submitted = true;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).resolves.toEqual({ platformId: "post_12345678", url: publicUrl });
  });
});

describe("separate Snapchat browser subjects", () => {
  const member = account("snapchat", "web:snapchat:bycoda", "member");
  const profile = account("snapchat", "web:snapchat:public_profile:bycoda", "public_profile");
  const selected = (username = "bycoda") =>
    `<form data-testid="upload-form"><input type="file" accept="video/*"><label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/${username}">${username}</a></label></form>`;
  it("starts Public Profile setup on the documented uploader and preserves the member chat route", () => {
    expect(snapchatBrowserConnectionUrl(profile)).toBe("https://my.snapchat.com");
    expect(snapchatBrowserConnectionUrl(member)).toBe("https://web.snapchat.com");
    expect(() => snapchatBrowserConnectionUrl(account("snapchat", "", "business"))).toThrow(
      "member account or Public Profile",
    );
  });
  it("cannot verify a Public Profile from a generic chat username", async () => {
    const f = fixture(
      recipe("snapchat"),
      profile,
      '<nav data-testid="chat-list"></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>',
    );
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("requires exactly one selected uploader profile rather than the generic account header", async () => {
    const f = fixture(
      recipe("snapchat"),
      profile,
      `<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/account-owner">Account owner</a></div></header>${selected()}`,
    );
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toEqual({
      platformId: profile.platformId,
      name: "@bycoda",
      accountType: "public_profile",
    });
    f.window.document.body.innerHTML =
      '<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div></header><input type="file">';
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
  });
  it("rejects two selected profiles and a selected profile different from the saved subject", async () => {
    const f = fixture(recipe("snapchat"), profile, selected() + selected("other-profile"));
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
    f.window.document.body.innerHTML = selected("other-profile");
    await expect(f.ctx.verifyIdentity()).rejects.toMatchObject({ code: "denied" });
  });
  it("keeps the same username's member and Public Profile namespaces separate", async () => {
    const f = fixture(recipe("snapchat"), member, selected());
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, member)).resolves.toBeUndefined();
    await expect(recipe("snapchat").poll({ ...f.ctx, account: profile }, [])).rejects.toMatchObject(
      { code: "unsupported" },
    );
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

it("does not advertise arbitrary DM initiation for publishing surfaces", () => {
  expect(recipe("linkedin").operations).toContain("message.start");
  expect(recipe("youtube").operations).not.toContain("message.reply");
  expect(recipe("tiktok").operations).not.toContain("message.start");
  expect(recipe("snapchat").operations).not.toContain("message.start");
  expect(
    linkedInCreatedId(JSON.stringify({ value: { entityUrn: "urn:li:person:123" } })),
  ).toBeUndefined();
});
