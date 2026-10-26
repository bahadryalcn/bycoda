import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import { SocialPlatformError } from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { messagingBrowserRecipes } from "./social-browser-messaging";

type Platform = "whatsapp" | "telegram";
// WhatsApp's rendered timestamps use the browser's local timezone.
const now = new Date(2026, 9, 26, 12, 0, 5).getTime();
const ownPhone = "905551234567";
const peer = "905559876543";
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function fixture(
  platform: Platform,
  options: {
    wrongPeer?: boolean;
    pending?: boolean;
    disappearOnReopen?: boolean;
    noNewMessage?: boolean;
    draft?: string;
    unknown?: boolean;
    missingTimestamp?: boolean;
  } = {},
) {
  const recipe = messagingBrowserRecipes.find((r) => r.platform === platform)!;
  const window = new Window({ url: recipe.loginUrl });
  const document = window.document;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: function () {
      return [{ width: 100, height: 30 }];
    },
  });
  let menu = false,
    profile = false,
    attachment = false,
    preview = false;
  let draft = options.draft ?? "",
    caption = "",
    sent = false,
    gotos = 0;
  let currentPeer = peer;
  const account = {
    id: "synthetic",
    platform,
    platformId: `web:${platform}:+${ownPhone}`,
    name: "Bycoda",
    accountType: "member",
    connected: true,
    paused: false,
    connection: "browser",
    accessApproved: true,
    scopes: [],
    executorId: "host",
    grants: {},
    createdAt: 1,
  } as SocialAccount;

  const message = (id: string, outgoing: boolean, body: string, media = false, pending = false) =>
    platform === "telegram"
      ? `<div class="bubble ${outgoing ? `is-out ${pending ? "is-sending" : "is-sent"}` : ""}" data-mid="${id}" data-peer-id="${currentPeer}" ${options.missingTimestamp ? "" : `data-timestamp="${(now - 5000) / 1000}"`}><div class="message">${escape(body)}<span class="time">10:00</span></div>${media ? '<div class="attachment"><video></video></div>' : ""}</div>`
      : `<div class="${outgoing ? "message-out" : "message-in"}" data-id="${outgoing ? "true" : "false"}_${currentPeer}@c.us_${id}"><div ${options.missingTimestamp ? "" : `data-pre-plain-text="[12:00, 26/10/2026] Sender: "`}><span class="selectable-text copyable-text">${escape(body)}</span></div>${outgoing ? `<span data-icon="${pending ? "msg-time" : "msg-check"}"></span>` : ""}${media ? "<video></video>" : ""}</div>`;
  const render = () => {
    document.documentElement.lang = "tr";
    const rows =
      message("101", false, "Hello Bycoda") +
      message("102", true, "Earlier") +
      (sent
        ? message("103", true, preview ? caption : draft || "Reply", attachment, options.pending)
        : "");
    if (options.unknown) {
      document.body.innerHTML = "<main>Unlock messages</main>";
      return;
    }
    if (platform === "telegram") {
      document.body.innerHTML = `<div id="column-left"><button class="sidebar-tools-button" data-action="menu">Menu</button>
        <div class="chatlist"><div class="chatlist-chat" data-peer-id="${peer}" data-action="chat">Contact</div></div>
        ${menu ? '<div class="btn-menu-item" data-action="profile"><span class="tgico-settings"></span>Settings</div>' : ""}
        ${profile ? `<div class="settings-container"><div class="sidebar-header"><button class="sidebar-close-button" data-action="back">Back</button></div><div class="profile-name">Bycoda</div><div class="row-title">+${ownPhone}</div></div>` : ""}</div>
        <div id="column-center"><div class="chat tabs-tab active"><div class="chat-info-container"><span class="peer-title" data-peer-id="${currentPeer}">Contact</span></div>
        <div class="bubbles"><div class="bubbles-inner">${rows}</div></div><div class="chat-input"><div class="input-message-input" contenteditable="true" role="textbox" data-editor="draft">${escape(draft)}</div><button class="btn-send" data-action="send">Send</button><attach-menu-button data-action="attach">Attach</attach-menu-button>${attachment ? '<div class="btn-menu-item" data-action="select-media"><span class="tgico-image"></span>Photo or video</div>' : ""}<input type="file" accept="image/*,video/*"></div></div></div>
        ${preview ? `<div class="popup-send-photo"><div contenteditable="true" data-editor="caption">${escape(caption)}</div><button class="btn-primary btn-color-primary" data-action="send-media">Send</button></div>` : ""}`;
    } else {
      document.body.innerHTML = `<div id="app"><button data-testid="profile" data-action="profile">Profile</button>
        <div id="pane-side"><div role="row" data-action="chat">Contact</div></div>
        ${profile ? `<div data-testid="drawer-left"><header>Profile</header><div>Your phone number</div><div data-testid="phone-number" dir="auto">+${ownPhone}</div><div data-testid="profile-name">Bycoda</div><button data-testid="back" data-action="back">Back</button></div>` : ""}
        <div id="main"><header><span title="+${currentPeer}">Contact</span></header>${rows}<footer><div contenteditable="true" role="textbox" data-editor="draft">${escape(draft)}</div><button data-testid="compose-btn-send" data-action="send">Send</button><button aria-label="Attach" data-action="attach">Attach</button></footer></div>
        ${attachment ? '<input type="file" accept="image/*,video/*">' : ""}
        ${preview ? `<div data-testid="media-editor"><video></video><div contenteditable="true" data-editor="caption">${escape(caption)}</div><button data-testid="send" data-action="send-media">Send</button></div>` : ""}</div>`;
    }
  };
  render();
  const evaluate = async <T>(expression: string): Promise<T> => window.eval(expression) as T;
  const page = {
    goto: vi.fn(async (url: string) => {
      gotos++;
      const parsed = new URL(url);
      window.location.href = url;
      const selected =
        platform === "telegram"
          ? decodeURIComponent(parsed.hash.slice(1))
          : parsed.searchParams.get("phone");
      currentPeer = options.wrongPeer ? "905550000000" : selected || peer;
      if (sent && options.disappearOnReopen) sent = false;
      render();
    }),
    evaluate: vi.fn(evaluate),
    click: vi.fn(async (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error("Missing control: " + selector);
      const action = element.getAttribute("data-action");
      if (action === "menu") menu = true;
      if (action === "profile") {
        profile = true;
        menu = false;
      }
      if (action === "back") profile = false;
      if (action === "attach") attachment = true;
      if (action === "chat") currentPeer = peer;
      if (action === "send" || action === "send-media") {
        if (!options.noNewMessage) sent = true;
      }
      render();
    }),
    fill: vi.fn(async (selector: string, body: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error("Missing editor");
      if (element.getAttribute("data-editor") === "caption") caption = body;
      else draft = body;
      render();
    }),
    setFiles: vi.fn(async () => {
      preview = true;
      render();
    }),
    cookies: vi.fn(async () => {
      throw new Error("Credential access prohibited");
    }),
  } as unknown as BrowserPage;
  const verifyIdentity = vi.fn(async () => {
    const actual = await recipe.identity(page, account);
    if (actual?.platformId !== account.platformId) throw new SocialPlatformError("denied");
  });
  const context: BrowserRecipeContext = {
    page,
    account,
    files: [],
    now: () => now,
    verifyIdentity,
    waitFor: async <T>(expression: string) => await evaluate<T>(expression),
  };
  const job = {
    id: "job",
    operationId: "operation",
    dedupeKey: "dedupe",
    accountId: account.id,
    projectIds: ["project"],
    provider: "owner",
    kind: "message",
    payload: { text: "Reply", media: [], recipientId: peer },
    status: "running",
    scheduledAt: now,
    attempts: 1,
  } as SocialJob;
  const submissions = () =>
    vi
      .mocked(page.click)
      .mock.calls.filter(
        ([selector]) =>
          selector.includes("compose-btn-send") ||
          selector.includes(".btn-send") ||
          selector.includes('media-editor"] [data-testid="send') ||
          selector.includes(".popup-send-photo .btn-primary"),
      ).length;
  return {
    recipe,
    window,
    document,
    page,
    context,
    job,
    verifyIdentity,
    submissions,
    get draft() {
      return draft;
    },
    get peer() {
      return currentPeer;
    },
    get gotos() {
      return gotos;
    },
  };
}

describe.each(["whatsapp", "telegram"] as const)("%s personal browser recipe", (platform) => {
  it("obtains own profile identity without reading credential stores and preserves chat draft", async () => {
    const f = fixture(platform, { draft: "Owner unfinished text" });
    expect(await f.recipe.identity(f.page, f.context.account)).toMatchObject({
      platformId: `web:${platform}:+${ownPhone}`,
      accountType: "member",
    });
    expect(f.draft).toBe("Owner unfinished text");
    expect(f.peer).toBe(peer);
    expect(f.document.querySelector('[data-testid="drawer-left"], .settings-container')).toBeNull();
    expect(f.page.cookies).not.toHaveBeenCalled();
    expect(f.page.goto).not.toHaveBeenCalled();
  });

  it("submits exactly once and verifies a new sent message again after reopening the same chat", async () => {
    const f = fixture(platform);
    const result = await f.recipe.send(f.context, f.job);
    expect(result.platformId).toBe(
      platform === "telegram" ? `telegram:${peer}:103` : `whatsapp:true_${peer}@c.us_103`,
    );
    expect(f.submissions()).toBe(1);
    expect(f.gotos).toBe(2);
    expect(f.verifyIdentity.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("marks irreversible delivery only after preparing the message and immediately before the send click", async () => {
    const f = fixture(platform);
    const mark = vi.fn(() => {
      expect(f.draft).toBe("Reply");
      expect(f.submissions()).toBe(0);
      expect(f.page.fill).toHaveBeenCalledOnce();
    });
    f.context.markSubmitted = mark;
    await f.recipe.send(f.context, f.job);
    expect(mark).toHaveBeenCalledOnce();
    expect(f.submissions()).toBe(1);
  });

  it("rejects a different selected recipient without filling or submitting", async () => {
    const f = fixture(platform, { wrongPeer: true });
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "denied" });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.submissions()).toBe(0);
  });

  it("rejects mismatched thread and recipient before browser interaction", async () => {
    const f = fixture(platform);
    const mark = vi.fn();
    f.context.markSubmitted = mark;
    f.job.payload.threadId = "905550000001";
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "denied" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.verifyIdentity).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });

  it("preserves an existing owner composer without replacing its contents", async () => {
    const f = fixture(platform, { draft: "Keep this" });
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "denied" });
    expect(f.draft).toBe("Keep this");
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.submissions()).toBe(0);
  });

  it("rechecks identity immediately before submission", async () => {
    const f = fixture(platform);
    f.verifyIdentity
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "denied" });
    expect(f.submissions()).toBe(0);
  });

  it("does not send composer content changed during the last identity check", async () => {
    const f = fixture(platform);
    f.verifyIdentity
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        await f.page.fill(
          platform === "telegram"
            ? ".input-message-input"
            : '#main footer [contenteditable="true"]',
          "Unexpected changed content",
        );
      });
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "denied" });
    expect(f.submissions()).toBe(0);
  });

  it.each([{ pending: true }, { noNewMessage: true }, { disappearOnReopen: true }])(
    "holds uncertain delivery rather than resending: %j",
    async (options) => {
      const f = fixture(platform, options);
      await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "unknown" });
      expect(f.submissions()).toBe(1);
    },
  );

  it("associates one uploaded attachment and caption with the persisted sent message", async () => {
    const f = fixture(platform);
    f.context.files = [{ path: "synthetic-owned-video.mp4", kind: "video" }];
    f.job.payload.media = [{ kind: "video", uploadId: "synthetic-upload" }];
    expect((await f.recipe.send(f.context, f.job)).platformId).toContain("103");
    expect(f.page.setFiles).toHaveBeenCalledOnce();
    expect(f.submissions()).toBe(1);
  });

  it("reads bounded incoming rendered messages, excluding own sent rows", async () => {
    const f = fixture(platform);
    const result = await f.recipe.poll(f.context, []);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      threadId: peer,
      contactId: peer,
      text: "Hello Bycoda",
      kind: "message",
    });
    expect(result.events[0].at).toBeGreaterThan(0);
    expect(result.coverage).toEqual([{ channel: "messages", status: "read" }]);
  });

  it("does not interpret an unlock/challenge or changed layout as an empty inbox", async () => {
    const f = fixture(platform, { unknown: true });
    expect(await f.recipe.identity(f.page, f.context.account)).toBeUndefined();
    await expect(f.recipe.poll(f.context, [])).rejects.toMatchObject({ code: "denied" });
    expect(f.submissions()).toBe(0);
  });

  it("does not fabricate incoming timestamps or accept malformed cursors", async () => {
    const f = fixture(platform, { missingTimestamp: true });
    await expect(f.recipe.poll(f.context, [])).rejects.toMatchObject({ code: "unsupported" });
    await expect(f.recipe.poll(f.context, [], '{"v":1,"next":-1}')).rejects.toMatchObject({
      code: "rejected",
    });
  });

  it("rejects unsupported job kinds, malformed targets and mismatched staged media before sending", async () => {
    const f = fixture(platform);
    f.job.kind = "publish";
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "unsupported" });
    f.job.kind = "message";
    f.job.payload.recipientId = "some-display-name";
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "rejected" });
    f.job.payload.recipientId = peer;
    f.job.payload.media = [{ kind: "image", uploadId: "missing-staged-file" }];
    await expect(f.recipe.send(f.context, f.job)).rejects.toMatchObject({ code: "rejected" });
    expect(f.page.goto).not.toHaveBeenCalled();
  });
});
