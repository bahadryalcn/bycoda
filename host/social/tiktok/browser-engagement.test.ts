import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { account, fixture, job, recipe } from "../social-browser-publishing-test-support";
import {
  type TikTokCommentMutation,
  tiktokManageComment,
  tiktokStudioComments,
} from "./browser-comments";
import { tiktokDirectMessage, tiktokMessages } from "./browser-dm";
import { tiktokMentions } from "./browser-mentions";

const viewer = "web:tiktok:viewer_one";
const owner = account("tiktok", "web:tiktok:bycoda");
const html = (name: string) =>
  readFileSync(new URL(`../fixtures/tiktok/${name}.html`, import.meta.url), "utf8");
const comment = (action: TikTokCommentMutation["action"]): TikTokCommentMutation => ({
  action,
  postId: "9001",
  commentId: "101",
  contactId: viewer,
});

function page(name: string) {
  const body = html(name);
  return fixture(recipe("tiktok"), owner, body, { render: () => body });
}

describe("TikTok Studio comment engagement fixtures", () => {
  it("reads identified comments across video and photo posts", async () => {
    const { ctx, page: browser } = page("studio-comments");
    const { events, coverage } = await tiktokStudioComments(ctx);
    expect(events.map(({ postId, threadId, contactId }) => [postId, threadId, contactId])).toEqual([
      ["9001", "101", viewer],
      ["9002", "102", "web:tiktok:viewer_two"],
    ]);
    expect(coverage).toEqual([{ channel: "comments", status: "read" }]);
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("rejects a changed layout and never reports an empty manager", async () => {
    const { ctx, page: browser } = page("studio-comments-changed");
    await expect(tiktokStudioComments(ctx)).rejects.toMatchObject({ code: "unsupported" });
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("stops at a captcha before any comment mutation", async () => {
    const { ctx, page: browser } = page("studio-captcha");
    const authorize = vi.fn(async () => {});
    await expect(tiktokManageComment(ctx, comment("delete"), authorize)).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("requires authorization before any delete click", async () => {
    const { ctx, page: browser } = page("studio-comments");
    const authorize = vi.fn(async () => {
      throw new SocialPlatformError("denied");
    });
    await expect(tiktokManageComment(ctx, comment("delete"), authorize)).rejects.toMatchObject({
      code: "denied",
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(browser.click).not.toHaveBeenCalled();
    expect(ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("cannot mutate a comment for a different post", async () => {
    const { ctx, page: browser } = page("studio-comments");
    const authorize = vi.fn(async () => {});
    await expect(
      tiktokManageComment(ctx, { ...comment("like"), postId: "9002" }, authorize),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(authorize).not.toHaveBeenCalled();
    expect(browser.click).not.toHaveBeenCalled();
  });

  it.each(["like", "hide", "pin"] as const)("verifies %s after navigation", async (action) => {
    const initial = html("studio-comments");
    let applied = false;
    const { ctx, page: browser } = fixture(recipe("tiktok"), owner, initial, {
      render: () =>
        !applied
          ? initial
          : action === "like"
            ? initial.replace('aria-pressed="false"', 'aria-pressed="true"')
            : initial.replace(
                'data-comment-id="101"',
                `data-comment-id="101" data-comment-${action === "hide" ? "hidden" : "pinned"}="true"`,
              ),
      click: (el) => {
        expect(el.getAttribute("data-e2e")).toBe(`comment-${action}`);
        const row = el.closest('[data-comment-id="101"]')!;
        if (action === "like") el.setAttribute("aria-pressed", "true");
        else row.setAttribute(`data-comment-${action === "hide" ? "hidden" : "pinned"}`, "true");
        applied = true;
      },
    });
    const authorize = vi.fn(async () => {});
    await expect(tiktokManageComment(ctx, comment(action), authorize)).resolves.toEqual({
      platformId: "101",
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(browser.click).toHaveBeenCalledOnce();
    expect(browser.goto).toHaveBeenCalledTimes(2);
  });

  it("confirms only the exact delete and requires positive evidence", async () => {
    const initial = html("studio-comments");
    const { ctx, page: browser } = fixture(recipe("tiktok"), owner, initial, {
      click: (el) => {
        if (el.getAttribute("data-e2e") === "comment-delete") {
          el.closest("main")!.insertAdjacentHTML(
            "afterbegin",
            `<div role="dialog" data-e2e="comment-delete-dialog" data-comment-id="101"><button data-e2e="comment-delete-confirm">Delete</button></div>`,
          );
        } else {
          const list = el.closest("main")!;
          list.querySelector('article[data-comment-id="101"]')!.remove();
          list.insertAdjacentHTML("afterbegin", '<p data-comment-deleted-id="101">Deleted</p>');
        }
      },
    });
    const authorize = vi.fn(async () => {});
    await expect(tiktokManageComment(ctx, comment("delete"), authorize)).resolves.toEqual({
      platformId: "101",
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(browser.click).toHaveBeenCalledTimes(2);
    const withoutEvidence = page("studio-comments");
    await expect(
      tiktokManageComment(withoutEvidence.ctx, comment("delete"), authorize),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(withoutEvidence.page.click).toHaveBeenCalledOnce();
  });
});

const chat = (
  draft = "",
  sent = false,
) => `<section data-e2e="chat-conversation" data-conversation-id="301">
  <a data-e2e="chat-peer" href="/@viewer_one">Viewer One</a>
  <div data-e2e="chat-history">${sent ? sentMessage : ""}</div>
  <div contenteditable="true" data-e2e="chat-input">${draft}</div><button data-e2e="chat-send">Send</button>
</section>`;
const sentMessage =
  '<article data-message-id="403" data-direction="outgoing" data-status="sent"><p data-e2e="chat-message-text">Yes, in stock.</p></article>';
const reply = () =>
  job("message", { recipientId: viewer, threadId: "tiktok:301", text: "Yes, in stock." });

function directMessage({ newThread = false, draft = "", acknowledge = true } = {}) {
  const list = html("messages");
  const empty =
    '<header><a data-e2e="nav-profile" href="/@bycoda">Bycoda</a></header><main data-e2e="message-list"><p data-e2e="no-messages">No messages</p></main>';
  const profile =
    '<header><a data-e2e="nav-profile" href="/@bycoda">Bycoda</a></header><main data-e2e="user-page"><button data-e2e="message-button">Message</button></main>';
  let sent = false;
  return fixture(recipe("tiktok"), owner, list, {
    render: (url) => (url.endsWith("/messages") ? (newThread && !sent ? empty : list) : profile),
    click: (el) => {
      switch (el.getAttribute("data-e2e")) {
        case "conversation-open":
        case "message-button":
          el.ownerDocument.body.insertAdjacentHTML("beforeend", chat(draft, sent));
          break;
        case "chat-send":
          if (!acknowledge) break;
          el.closest('[data-e2e="chat-conversation"]')!
            .querySelector('[data-e2e="chat-history"]')!
            .insertAdjacentHTML("beforeend", sentMessage);
          sent = true;
          break;
      }
    },
  });
}

describe("TikTok direct message browser fixtures", () => {
  it("reads incoming previews only and reports partial coverage", async () => {
    const { ctx, page: browser } = page("messages");
    await expect(tiktokMessages(ctx)).resolves.toMatchObject({
      events: [
        {
          eventId: "tiktok:dm:301:401",
          threadId: "tiktok:301",
          contactId: viewer,
          kind: "message",
        },
      ],
      coverage: [{ channel: "messages", status: "partial" }],
    });
    expect(browser.click).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "sends to the exact peer and rereads acknowledgment (new thread: %s)",
    async (newThread) => {
      const { ctx, page: browser } = directMessage({ newThread });
      const authorization = vi.fn(async () => {});
      const message = reply();
      if (newThread) delete message.payload.threadId;
      ctx.beforeSubmit = authorization;
      await expect(recipe("tiktok").send(ctx, message)).resolves.toEqual({
        platformId: "tiktok:dm:301:403",
      });
      expect(authorization).toHaveBeenCalledOnce();
      expect(ctx.markSubmitted).toHaveBeenCalledOnce();
      expect(authorization.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(ctx.markSubmitted!).mock.invocationCallOrder[0],
      );
      expect(browser.goto).toHaveBeenLastCalledWith("https://www.tiktok.com/messages");
    },
  );

  it("never submits when the Host denies authority", async () => {
    const { ctx, page: browser } = directMessage();
    const authorization = vi.fn(async () => {
      throw new SocialPlatformError("denied");
    });
    await expect(tiktokDirectMessage(ctx, reply(), authorization)).rejects.toMatchObject({
      code: "denied",
    });
    expect(authorization).toHaveBeenCalledOnce();
    expect(ctx.markSubmitted).not.toHaveBeenCalled();
    expect(browser.click).toHaveBeenCalledOnce();
  });

  it("does not open a browser chat without a Host authorization callback", async () => {
    const { ctx, page: browser } = directMessage();
    await expect(tiktokDirectMessage(ctx, reply())).rejects.toMatchObject({ code: "denied" });
    expect(browser.goto).not.toHaveBeenCalled();
    expect(browser.fill).not.toHaveBeenCalled();
  });

  it("leaves an existing owner draft intact", async () => {
    const { ctx, page: browser } = directMessage({ draft: "Work in progress" });
    await expect(tiktokDirectMessage(ctx, reply(), async () => {})).rejects.toMatchObject({
      code: "denied",
    });
    expect(browser.fill).not.toHaveBeenCalled();
    expect(ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("hands off a TikTok messaging restriction without typing or clicking", async () => {
    const list = html("messages") + '<p data-e2e="message-restricted">You can’t send messages</p>';
    const { ctx, page: browser } = fixture(recipe("tiktok"), owner, list);
    await expect(tiktokDirectMessage(ctx, reply(), async () => {})).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(browser.fill).not.toHaveBeenCalled();
    expect(browser.click).not.toHaveBeenCalled();
  });

  it("treats missing post-click evidence as uncertain and never retries", async () => {
    const { ctx, page: browser } = directMessage({ acknowledge: false });
    await expect(tiktokDirectMessage(ctx, reply(), async () => {})).rejects.toMatchObject({
      code: "unknown",
    });
    expect(ctx.markSubmitted).toHaveBeenCalledOnce();
    expect(browser.goto).toHaveBeenCalledOnce();
    expect(browser.click).toHaveBeenCalledTimes(2);
  });
});

describe("TikTok mentions browser fixtures", () => {
  it("reads only the exact mentions filter with stable IDs", async () => {
    const body = html("studio-mentions");
    const { ctx } = fixture(recipe("tiktok"), owner, body, {
      click: (el) => {
        expect(el.getAttribute("data-e2e")).toBe("notifications-mentions-tab");
        el.setAttribute("aria-selected", "true");
      },
    });
    await expect(tiktokMentions(ctx)).resolves.toMatchObject({
      events: [
        {
          eventId: "tiktok:mention:501",
          postId: "9003",
          threadId: "103",
          contactId: viewer,
          replyAllowed: false,
        },
      ],
      coverage: [{ channel: "mentions", status: "read" }],
    });
  });

  it("cannot ingest a list when the mentions filter is never applied", async () => {
    const { ctx } = page("studio-mentions");
    await expect(tiktokMentions(ctx)).rejects.toMatchObject({ code: "unsupported" });
  });
});
