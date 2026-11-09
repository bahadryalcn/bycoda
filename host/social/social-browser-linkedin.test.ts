import { describe, expect, it } from "vitest";
import { linkedInBrowserConnectionUrl } from "./social-browser-publishing";
import { account, fixture, job, now, recipe } from "./social-browser-publishing-test-support";
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
