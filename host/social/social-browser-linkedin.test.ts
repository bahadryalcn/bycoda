import { describe, expect, it, vi } from "vitest";
import { linkedInBrowserConnectionUrl } from "./social-browser-publishing";
import { linkedInCreatedId } from "./social-browser-linkedin";
import { account, fixture, job, now, recipe } from "./social-browser-publishing-test-support";
const liIdentity = `<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>`;
// The composer is a native dialog opened by LinkedIn's `shareActive` link; controls carry no stable class.
const liEditor = `${liIdentity}<dialog open><div role="textbox" contenteditable="true"></div><button type="button" aria-label="Media" aria-haspopup="dialog"></button><button type="button">Post</button></dialog>`;
const liId = "urn:li:activity:123456789";
const liPersisted = (owner = "bycoda-owner", text = "A Bycoda update", urn = liId, extra = "") =>
  `${liIdentity}<div role="article" data-urn="${urn}"><a class="update-components-actor__meta-link" href="/in/${owner}/?miniProfileUrn=x">Author</a><div class="update-components-text">${text}</div>${extra}</div>`;
/** LinkedIn IDs are snowflakes: the upper bits are the creation time in ms. */
const snowflake = (ms: number) => (BigInt(ms) << 22n).toString();
const liComment = (ms: number, owner: string, text: string, tail = "") =>
  `<article data-id="urn:li:comment:(ugcPost:123456789,${snowflake(ms)})"><div><a href="/in/${owner}"><img alt=""></a><a href="/in/${owner}"><span class="comments-comment-meta__description-title">${owner}</span></a></div><section><span class="comments-comment-item__main-content">${text}</span></section><div><button class="comments-comment-social-bar__reply-action-button--cr">Reply</button></div>${tail}</article>`;
const liCommentForm = (text = "") =>
  `<form class="comments-comment-box__form"><div class="ql-editor" role="textbox" contenteditable="true">${text}</div><button type="button">Emoji</button><button class="comments-comment-box__submit-button--cr">Comment</button></form>`;

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
  it("reads the member from the session's /me endpoint when the feed markup has no known identity controls", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      `<main data-view-name="feed"><a href="/in/stranger/">A different author</a></main>`,
    );
    const urn = "urn:li:fs_miniProfile:ACo1";
    f.window.document.cookie = 'JSESSIONID="ajax:123"';
    const fetch = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) => ({
      ok: true,
      json: async () => ({
        data: { "*miniProfile": urn },
        included: [
          { entityUrn: "urn:li:fs_miniProfile:other", publicIdentifier: "stranger" },
          { entityUrn: urn, publicIdentifier: "Bycoda-Owner", firstName: "By", lastName: "Coda" },
        ],
      }),
    }));
    Object.assign(f.window, { fetch });
    await expect(recipe("linkedin").identity(f.page, f.ctx.account)).resolves.toEqual({
      platformId: "web:linkedin:in:bycoda-owner",
      name: "By Coda",
    });
    expect(fetch.mock.calls[0][0]).toBe("/voyager/api/me");
    expect(fetch.mock.calls[0][1].headers["csrf-token"]).toBe("ajax:123");
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
    expect(f.page.goto).toHaveBeenCalledWith("https://www.linkedin.com/feed/?shareActive=true");
    expect(f.page.click).toHaveBeenCalledOnce();
    expect(f.ctx.verifyIdentity).toHaveBeenCalled();
    expect(f.page.cookies).not.toHaveBeenCalled();
  });
  it("accepts a share ID that LinkedIn renders under its activity URN on the exact detail URL", async () => {
    const share = "urn:li:share:7051450356165181440";
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      {
        response: JSON.stringify({ value: { entityUrn: share } }),
        render: (url) =>
          url.includes("/feed/update/")
            ? liPersisted("bycoda-owner", "A Bycoda update", "urn:li:activity:7051450356693663744")
            : liEditor,
      },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).resolves.toMatchObject({
      platformId: share,
    });
  });
  it("reads the server-driven create response and rejects an ambiguous one", () => {
    const share = "urn:li:share:7051450356165181440";
    expect(linkedInCreatedId(`0:{"x":"${share}"}\n1:"${share}"`)).toBe(share);
    expect(
      linkedInCreatedId(
        `"urn:li:activity:7051450356165181440" "urn:li:activity:7051450356165181441"`,
      ),
    ).toBeUndefined();
    expect(linkedInCreatedId('{"toast":"hello"}')).toBeUndefined();
  });
  it("attaches media through the captured file input, steps the editor to the composer, then publishes", async () => {
    let stepped = false;
    const composer = liEditor.replace(
      "</dialog>",
      '<img src="blob:https://www.linkedin.com/1"></dialog>',
    );
    const editor = `<dialog open><button type="button">Back</button><button type="button">İleri</button></dialog>`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      {
        response: JSON.stringify({ value: { entityUrn: liId } }),
        render: (url) =>
          url.includes("/feed/update/")
            ? liPersisted(
                "bycoda-owner",
                "A Bycoda update",
                liId,
                '<div class="update-components-image"><img src="https://media.licdn.com/dms/image/x.png"></div>',
              )
            : liEditor,
        click: (el) => {
          if (el.getAttribute("aria-label") === "Media") {
            const input = f.window.document.createElement("input");
            input.type = "file";
            input.accept = "image/png,video/*";
            input.setAttribute("data-bycoda-li-file", "true");
            f.window.document.body.append(input);
            f.window.document.body.insertAdjacentHTML("beforeend", editor);
          } else if (el.textContent === "İleri") {
            stepped = true;
            f.window.document.body.innerHTML = composer;
          }
        },
      },
    );
    f.ctx.files = [{ path: "/tmp/a.png", kind: "image" }];
    await expect(
      recipe("linkedin").send(f.ctx, job("publish", { media: [{ kind: "image" }] as never })),
    ).resolves.toMatchObject({ platformId: liId });
    expect(stepped).toBe(true);
    expect(f.page.setFiles).toHaveBeenCalledWith('[data-bycoda-web-control="media"]', [
      "/tmp/a.png",
    ]);
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
    expect(f.page.click).toHaveBeenCalledOnce();
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
          if (el.textContent === "Post") {
            expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
            submitted = true;
          } else expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
        },
      },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
    expect(submitted).toBe(true);
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
    expect(f.page.click).toHaveBeenCalledOnce();
  });
  it("marks comment submission before clicking and holds an identity failure during comment readback", async () => {
    let submitted = false;
    const row = liComment(now, "bycoda-owner", "A Bycoda update");
    const html = () =>
      `${submitted ? liIdentity.replace("/in/bycoda-owner/", "/in/switched-owner/") : liIdentity}<div class="comments-comments-list">${submitted ? row : '<div class="comments-empty-state">No comments yet</div>'}</div>${liCommentForm()}`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.matches(".comments-comment-box__submit-button--cr")) {
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
  it("returns a persisted comment whose snowflake ID dates it and whose author is the owner", async () => {
    let submitted = false;
    const html = () =>
      `${liIdentity}<div class="comments-comments-list">${submitted ? liComment(now, "bycoda-owner", "A Bycoda update") : '<div class="comments-empty-state">No comments yet</div>'}</div>${liCommentForm()}`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.matches(".comments-comment-box__submit-button--cr")) submitted = true;
        },
      },
    );
    await expect(
      recipe("linkedin").send(f.ctx, job("comment", { postId: liId })),
    ).resolves.toMatchObject({
      platformId: `urn:li:comment:(ugcPost:123456789,${snowflake(now)})`,
    });
  });
  it("replies inside the target comment, replacing the generated mention, and never uses the post box", async () => {
    const parent = `urn:li:comment:(ugcPost:123456789,${snowflake(now - 3_600_000)})`;
    let replied = false;
    let open = false;
    const mention = '<span class="ql-mention">@Friend</span>';
    const html = () =>
      `${liIdentity}<div class="comments-comments-list">${liComment(now - 3_600_000, "friend", "Hello", open ? liCommentForm(mention) : "")}${replied ? liComment(now, "bycoda-owner", "A Bycoda update") : ""}</div>${liCommentForm()}`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.matches('[class*="reply-action-button"]')) {
            open = true;
            f.window.document.body.innerHTML = html();
          } else if (el.matches(".comments-comment-box__submit-button--cr")) {
            expect(el.closest("article")).not.toBeNull();
            replied = true;
          }
        },
      },
    );
    await expect(
      recipe("linkedin").send(f.ctx, job("reply", { postId: liId, threadId: parent })),
    ).resolves.toMatchObject({ platformId: expect.stringContaining("urn:li:comment:") });
    expect(f.page.fill).toHaveBeenCalledOnce();
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
  });
  it("refuses a reply whose target comment is not on the page", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      `${liIdentity}<div class="comments-comments-list">${liComment(now, "friend", "Hello")}</div>${liCommentForm()}`,
    );
    await expect(
      recipe("linkedin").send(
        f.ctx,
        job("reply", { postId: liId, threadId: "urn:li:comment:(ugcPost:1,2)" }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("reads dated comments, skips Page comments and drops the owner's own", async () => {
    const page = `<article data-id="urn:li:comment:(ugcPost:123456789,${snowflake(now - 5000)})"><a href="https://www.linkedin.com/company/firisbe/posts"><img></a><span class="comments-comment-item__main-content">From a Page</span></article>`;
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      `${liIdentity}<div class="comments-comments-list">${liComment(now - 9000, "friend", "Hello")}${page}${liComment(now - 1000, "bycoda-owner", "Mine")}</div>`,
    );
    const result = await recipe("linkedin").poll(f.ctx, [liId]);
    expect(result.events).toEqual([
      expect.objectContaining({
        kind: "comment",
        contactId: "web:linkedin:in:friend",
        text: "Hello",
        at: now - 9000,
        postId: liId,
      }),
    ]);
  });
  it("never accepts an optimistic composer echo without an acknowledged platform ID", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liEditor,
      { response: JSON.stringify({ value: { text: "A Bycoda update" } }), render: () => liEditor },
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.click).toHaveBeenCalledOnce();
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
  it("reports a loaded comment box with a content-free list as a read, empty comments section", async () => {
    const f = fixture(
      recipe("linkedin"),
      account("linkedin", "web:linkedin:in:bycoda-owner"),
      liIdentity +
        '<div class="social-details-social-counts"><li class="social-details-social-counts__reactions">3</li></div><div class="comments-comments-list"><div class="comments-comment-list__container"><div></div></div></div>' +
        liCommentForm(),
    );
    const result = await recipe("linkedin").poll(f.ctx, [liId]);
    expect(result.events).toEqual([]);
    expect(result.coverage).toContainEqual({ channel: "comments", status: "read" });
  });
  it("keeps an empty-looking list unavailable when the counts show comments, a loader or no comment box", async () => {
    const list =
      '<div class="comments-comments-list"><div class="comments-comment-list__container">';
    for (const markup of [
      `<li class="social-details-social-counts__comments">5</li>${list}</div></div>${liCommentForm()}`,
      `${list}<div class="artdeco-loader"></div></div></div>${liCommentForm()}`,
      `${list}<button>Load more</button></div></div>${liCommentForm()}`,
      `${list}</div></div>`,
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
        '<div role="textbox" contenteditable="true"></div>',
        '<div role="textbox" contenteditable="true">An unfinished owner draft</div>',
      ),
    );
    await expect(recipe("linkedin").send(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
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

describe("LinkedIn existing member chats", () => {
  const threadId = "2-Yjkx=";
  const threadUrl = `https://www.linkedin.com/messaging/thread/${threadId}/`;
  /** Message IDs end in `2-<base64 of the creation time in ms>`; the thread shows only clock times. */
  const msgId = (ms: number, tag: string) =>
    `urn:li:msg_message:(urn:li:fsd_profile:ACo1,2-${Buffer.from(`${ms}-${tag}`).toString("base64")})`;
  const oldId = msgId(now - 3_600_000, "old");
  const newId = msgId(now, "new");
  const row = (id: string, text: string, owner: string | null) =>
    `<li><div data-event-urn="${id}">${owner ? `<a href="/in/${owner}/">${owner}</a>` : ""}<div class="msg-s-event-listitem__body">${text}</div></div></li>`;
  function chat(
    options: { wrongRecipient?: boolean; oldDraft?: boolean; disappear?: boolean } = {},
  ) {
    let sent = false;
    let active = false;
    const html =
      () => `${liIdentity}<ul class="msg-conversations-container__conversations-list"><li><div class="msg-conversation-listitem__link msg-conversations-container__convo-item-link${active ? " msg-conversations-container__convo-item-link--active" : ""}">Friend</div></li></ul>
      <div class="msg-thread"><a class="msg-thread__link-to-profile" href="/in/${options.wrongRecipient ? "other" : "friend"}/">Friend</a><ul class="msg-s-message-list">${row(oldId, "Earlier", "friend")}${sent && !options.disappear ? row(newId, "A Bycoda update", "bycoda-owner") : ""}</ul>
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
          } else if (el.matches(".msg-conversation-listitem__link")) {
            // Inbox rows have no href: opening one selects the thread in the address bar.
            active = true;
            f.window.location.href = threadUrl;
            el.classList.add("msg-conversations-container__convo-item-link--active");
          }
        },
      },
    );
    return {
      ...f,
      submissions: () => submissions,
      message: job("message", { threadId, recipientId: "web:linkedin:in:friend" }),
    };
  }
  it("reads the inbox by opening each row and decoding message times from their IDs", async () => {
    const f = chat();
    const result = await recipe("linkedin").poll(f.ctx, []);
    expect(result.events).toEqual([
      {
        eventId: oldId,
        threadId,
        contactId: "web:linkedin:in:friend",
        contactName: "friend",
        text: "Earlier",
        at: now - 3_600_000,
        kind: "message",
      },
    ]);
    expect(result.coverage).toContainEqual({ channel: "messages", status: "read" });
    expect(f.submissions()).toBe(0);
  });
  it("attributes a follow-up message without its own profile link to the previous sender", async () => {
    const f = chat();
    f.window.document.querySelector(".msg-s-message-list")!.innerHTML =
      row(oldId, "Earlier", "friend") + row(msgId(now - 1000, "next"), "Second", null);
    f.page.goto = vi.fn(async () => {});
    const result = await recipe("linkedin").poll(f.ctx, []);
    expect(result.events.map((event) => event.text)).toEqual(["Earlier", "Second"]);
  });
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
      platformId: newId,
      url: threadUrl,
    });
    expect(f.page.goto).toHaveBeenCalledWith(threadUrl);
    expect(f.submissions()).toBe(1);
  });
  it("routes a host DM reply job to its conversation rather than a post-comment editor", async () => {
    const f = chat();
    f.message.kind = "reply";
    await expect(recipe("linkedin").send(f.ctx, f.message)).resolves.toMatchObject({
      platformId: newId,
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
