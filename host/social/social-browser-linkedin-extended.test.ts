import { Window } from "happy-dom";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import {
  linkedInApplyImageAlt,
  linkedInImageAltEvidence,
  linkedInPublishDocument,
  linkedInStartMessage,
  validateLinkedInPdf,
} from "./social-browser-linkedin-extended";

const now = Date.parse("2026-10-26T12:00:00Z");
const own: SocialAccount = {
  id: "owner",
  platform: "linkedin",
  platformId: "web:linkedin:in:owner",
  name: "Owner",
  accountType: "member",
  connection: "browser",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "test",
  grants: {},
  createdAt: 1,
};
const job = (
  payload: Partial<SocialJob["payload"]> = {},
  kind: SocialJob["kind"] = "message",
): SocialJob => ({
  id: "job",
  operationId: "op",
  accountId: own.id,
  projectIds: [],
  actorId: "owner",
  provider: "owner",
  dedupeKey: "key",
  kind,
  payload: { text: "Hello", media: [], recipientId: "web:linkedin:in:friend", ...payload },
  status: "running",
  scheduledAt: now,
  attempts: 1,
  createdAt: now,
});
const identity = '<a data-own href="/in/owner/">Owner</a>';
const composeUrl =
  "https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoFriend123&recipient=ACoFriend123";
/** The profile top card has no h1: the degree is a "· 1." paragraph before the Message link. */
const profile = (degree = "1st", label = "Message", href = composeUrl) =>
  `${identity}<main><h2>Friend</h2>${degree ? `<p>· ${degree}</p>` : ""}<div data-view-name="profile-primary-message"><a href="${href}">${label}</a></div></main>`;
/** Message rows keep the msg-* classes, but the sender link moved and timestamps lost datetime. */
const messageRow = (id = "urn:li:msg_message:new", text = "Hello", sender = "owner") =>
  `<li class="msg-s-message-list__event"><div class="msg-s-event-listitem" data-event-urn="${id}"><a class="msg-s-event-listitem__link" href="/in/${sender}/"><img alt=""></a><div class="msg-s-event-listitem__message-bubble"><p class="msg-s-event-listitem__body">${text}</p></div></div></li>`;
const conversation = (
  rows = "",
  recipient = "friend",
  draft = "",
  thread = false,
  sendButtons = "Gönder",
) =>
  `${identity}<section class="msg-thread"><a class="ember-view" href="/in/${recipient}/">Recipient</a>${thread ? '<a href="/messaging/thread/thread-123/">Open conversation</a>' : ""}<ul class="msg-s-message-list">${rows}</ul><div class="msg-form__contenteditable" contenteditable="true">${draft}</div>${sendButtons
    .split("|")
    .map((label) => `<button class="msg-form__send-button">${label}</button>`)
    .join("")}</section>`;
type Options = {
  render?(url: string): string;
  click?(element: Element): void;
  response?: string;
};
function fixture(html: string, options: Options = {}) {
  const window = new Window({ url: "https://www.linkedin.com/feed/" });
  window.document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  const order: string[] = [];
  const page: BrowserPage = {
    goto: vi.fn(async (url) => {
      order.push("goto");
      window.location.href = url;
      if (options.render) window.document.body.innerHTML = options.render(url);
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression)),
    click: vi.fn(async (selector) => {
      const el = window.document.querySelector(selector);
      if (!el) throw new Error("Missing control");
      order.push(`click:${el.getAttribute("data-bycoda-linkedin-extended") || el.textContent}`);
      options.click?.(el as unknown as Element);
    }),
    fill: vi.fn(async (selector, text) => {
      const el = window.document.querySelector(selector) as any;
      if (!el) throw new Error("Missing editor");
      if ("value" in el) el.value = text;
      else el.textContent = text;
    }),
    insertText: vi.fn(async () => {}),
    setFiles: vi.fn(async () => {}),
    cookies: vi.fn(async () => {
      throw new Error("No cookie access");
    }),
    watchResponse: vi.fn((_path, accept) => ({
      body: async () =>
        options.response && (!accept || accept(options.response)) ? options.response : undefined,
      stop: vi.fn(),
    })),
  };
  const ctx: BrowserRecipeContext = {
    page,
    account: { ...own },
    files: [],
    now: () => now,
    waitFor: async <T>(expression: string) => await page.evaluate<T>(expression),
    verifyIdentity: vi.fn(async () => {
      order.push("identity");
      if (window.document.querySelector("[data-own]")?.getAttribute("href") !== "/in/owner/")
        throw new SocialPlatformError("denied");
    }),
    markSubmitted: vi.fn(() => {
      order.push("submitted");
    }),
  };
  return { window, page, ctx, order };
}
const cleanup: string[] = [];
afterEach(async () => {
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});
async function pdf(
  bytes = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  name = "brief.pdf",
) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-li-pdf-"));
  cleanup.push(directory);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

describe("LinkedIn free first-degree conversation initiation", () => {
  it("marks once immediately before Send and accepts only a reopened exact durable message", async () => {
    let sent = false;
    const f = fixture(profile(), {
      render: (url) =>
        url.includes("/in/")
          ? profile()
          : conversation(sent ? messageRow() : "", "friend", "", sent),
      click: (el) => {
        if (el.textContent === "Gönder") {
          sent = true;
          f.window.document.body.innerHTML = conversation(messageRow(), "friend", "", true);
        }
      },
    });
    expect(await linkedInStartMessage(f.ctx, job())).toEqual({
      platformId: "urn:li:msg_message:new",
      url: "https://www.linkedin.com/messaging/thread/thread-123/",
    });
    expect(f.page.goto).toHaveBeenCalledWith(composeUrl);
    const index = f.order.indexOf("submitted");
    expect(f.order[index - 1]).toBe("identity");
    expect(f.order[index + 1]).toBe("click:message-send");
    expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
    expect(f.page.cookies).not.toHaveBeenCalled();
  });
  it.each(["Send", "Senden", "Envoyer", "Enviar", "发送", "送信"])(
    "sends once with the localized %s button and still marks before the click",
    async (label) => {
      let sent = false;
      const f = fixture(profile(), {
        render: (url) =>
          url.includes("/in/")
            ? profile()
            : conversation(sent ? messageRow() : "", "friend", "", sent, label),
        click: (el) => {
          if (el.textContent === label) {
            sent = true;
            f.window.document.body.innerHTML = conversation(
              messageRow(),
              "friend",
              "",
              true,
              label,
            );
          }
        },
      });
      await linkedInStartMessage(f.ctx, job());
      expect(sent).toBe(true);
      expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
      const index = f.order.indexOf("submitted");
      expect(f.order[index - 1]).toBe("identity");
      expect(f.order[index + 1]).toBe("click:message-send");
    },
  );
  it.each([
    ["an unrecognised label", "Löschen"],
    ["two matching send buttons", "Senden|Envoyer"],
  ])("refuses without any click for %s", async (_name, buttons) => {
    const f = fixture(profile(), {
      render: (url) =>
        url.includes("/in/") ? profile() : conversation("", "friend", "", false, buttons),
    });
    await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "unsupported" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    expect(f.order.some((entry) => entry.startsWith("click:message-send"))).toBe(false);
  });
  it.each(["2nd", "3. derece", ""])(
    "does not initiate for unverified free eligibility %s",
    async (degree) => {
      const f = fixture(profile(degree));
      await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
      expect(f.page.goto).toHaveBeenCalledTimes(1);
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
  it("ignores a hidden first-degree duplicate when the visible degree is second", async () => {
    const f = fixture(profile("2."));
    f.window.document
      .querySelector("main")!
      .insertAdjacentHTML("afterbegin", '<p data-hidden="true">· 1.</p>');
    const rects = f.window.HTMLElement.prototype.getClientRects;
    Object.defineProperty(f.window.HTMLElement.prototype, "getClientRects", {
      configurable: true,
      value(this: Element) {
        return this.getAttribute("data-hidden") ? [] : rects.call(this);
      },
    });
    await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
  });
  it.each([
    ["offsite", "https://example.com/messaging/compose/?recipient=ACoFriend123"],
    ["other path", "https://www.linkedin.com/messaging/thread/new/?recipient=ACoFriend123"],
    ["no recipient", "https://www.linkedin.com/messaging/compose/"],
  ])("never follows a %s Message link", async (_name, href) => {
    const f = fixture(profile("1st", "Message", href));
    await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.page.goto).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong-recipient", "existing-draft", "inmail", "group"])(
    "rejects %s before Send",
    async (reason) => {
      const f = fixture(profile(), {
        render: (url) => {
          if (url.includes("/in/")) return profile();
          const html = conversation(
            "",
            reason === "wrong-recipient" ? "stranger" : "friend",
            reason === "existing-draft" ? "Owner's unsent draft" : "",
          );
          if (reason === "inmail")
            return html.replace("</section>", '<input name="subject"></section>');
          if (reason === "group")
            return html.replace("</section>", '<a href="/in/other/">Other</a></section>');
          return html;
        },
      });
      await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
  it("honors an identity/Stop change before irreversible Send", async () => {
    const f = fixture(profile(), {
      render: (url) => (url.includes("/in/") ? profile() : conversation()),
    });
    const fill = f.page.fill;
    f.page.fill = async (selector, text) => {
      await fill(selector, text);
      f.window.document.querySelector("[data-own]")!.setAttribute("href", "/in/different/");
    };
    await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
  it.each(["no-thread", "unpersisted", "wrong-sender", "duplicate", "not-latest"])(
    "holds %s as unknown after Send",
    async (reason) => {
      let sent = false;
      const f = fixture(profile(), {
        render: (url) =>
          url.includes("/in/")
            ? profile()
            : conversation(
                reason === "unpersisted"
                  ? ""
                  : reason === "wrong-sender"
                    ? messageRow(undefined, undefined, "stranger")
                    : reason === "duplicate"
                      ? messageRow() + messageRow("urn:li:msg_message:second")
                      : reason === "not-latest"
                        ? messageRow() + messageRow("urn:li:msg_message:reply", "Thanks", "friend")
                        : messageRow(),
                "friend",
                "",
                true,
              ),
        click: (el) => {
          if (el.textContent === "Gönder") {
            sent = true;
            f.window.document.body.innerHTML = conversation(
              messageRow(),
              "friend",
              "",
              reason !== "no-thread",
            );
          }
        },
      });
      await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "unknown" });
      expect(sent).toBe(true);
      expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
    },
  );
});

describe("LinkedIn image description", () => {
  const thumbs = (count = 1) =>
    `<img src="blob:owner-upload" alt="Resim Önizleme">${Array.from({ length: count }, (_, index) => `<img src="blob:owner-upload" alt="image ${index}">`).join("")}`;
  it("saves and reopens one image's description without any external Post click", async () => {
    let saved = "",
      editing = false;
    const media = [{ kind: "image" as const, uploadId: "upload", alt: "Bycoda workflow" }];
    // The media editor is a native <dialog>; reopened unchanged, the alt view shows a disabled Update.
    const render = () =>
      `${identity}<dialog open>${thumbs()}${editing ? `<textarea>${saved}</textarea><button aria-label="Geri"></button>${saved ? "<button disabled>Güncelle</button>" : "<button>Ekle</button>"}` : '<button aria-label="Alternatif metin"></button><button>Ekle</button>'}</dialog>`;
    const f = fixture(render(), {
      click: (el) => {
        if (el.getAttribute("aria-label") === "Alternatif metin") editing = true;
        else if (el.textContent === "Ekle" && editing) {
          saved = (f.window.document.querySelector("textarea") as any).value;
          editing = false;
        } else if (el.getAttribute("aria-label") === "Geri") editing = false;
        f.window.document.body.innerHTML = render();
      },
    });
    await linkedInApplyImageAlt(f.ctx, media);
    expect(saved).toBe(media[0].alt);
    expect(editing).toBe(false);
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    const id = "urn:li:activity:123";
    f.window.document.body.innerHTML = `<article data-urn="${id}"><div class="update-components-image"><img src="https://media.licdn.com/a.jpg" alt="${saved}"></div></article>`;
    expect(await f.page.evaluate(linkedInImageAltEvidence(id, media))).toBe(true);
    f.window.document.querySelector("img")!.setAttribute("alt", "automatic description");
    expect(await f.page.evaluate(linkedInImageAltEvidence(id, media))).toBe(false);
  });
  it("rejects a lost saved description and ambiguous multiple-image mapping", async () => {
    const initial = `${identity}<dialog open>${thumbs()}<button aria-label="Alternatif metin"></button></dialog>`;
    const f = fixture(initial, {
      click: (el) => {
        f.window.document.body.innerHTML =
          el.getAttribute("aria-label") === "Alternatif metin"
            ? `${identity}<dialog open>${thumbs()}<textarea></textarea><button>Ekle</button></dialog>`
            : initial;
      },
    });
    const media = [{ kind: "image" as const, uploadId: "one", alt: "Description" }];
    await expect(linkedInApplyImageAlt(f.ctx, media)).rejects.toMatchObject({ code: "denied" });
    await expect(
      linkedInApplyImageAlt(f.ctx, [...media, { kind: "image", uploadId: "two" }]),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
  it("does not edit when the media editor holds more than one image", async () => {
    const f = fixture(
      `${identity}<dialog open>${thumbs(2)}<button aria-label="Alternatif metin"></button></dialog>`,
    );
    await expect(
      linkedInApplyImageAlt(f.ctx, [{ kind: "image", uploadId: "one", alt: "Description" }]),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).not.toHaveBeenCalled();
  });
});

describe("LinkedIn document upload", () => {
  it.each(["not a PDF", "%PDF-1.7\nmissing trailer", "%PDF-1.7\n%%EOF\ntrailing replacement"])(
    "rejects malformed local content before any navigation",
    async (bytes) => {
      const file = await pdf(bytes);
      const f = fixture(identity);
      f.ctx.files = [{ path: file, kind: "document" }];
      await expect(
        linkedInPublishDocument(
          f.ctx,
          job({ media: [{ kind: "document", uploadId: "document" }] }, "publish"),
          "Guide",
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(f.page.goto).not.toHaveBeenCalled();
    },
  );
  it("requires an actual PDF extension and terminal PDF signature", async () => {
    await expect(validateLinkedInPdf(await pdf())).resolves.toBeUndefined();
    await expect(validateLinkedInPdf(await pdf(undefined, "brief.jpg"))).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it.each(
    ["view", "plain"].flatMap((variant) =>
      ["success", "unknown-receipt", "different-title", "identity-change"].map(
        (outcome) => [variant, outcome] as const,
      ),
    ),
  )(
    "requires exact reopened actor/text/document title after submit: %s %s",
    async (variant, outcome) => {
      const file = await pdf();
      let stage = "initial";
      const id = "urn:li:activity:123456",
        title = "Bycoda guide";
      // The `plain` variant is LinkedIn's A/B markup without any data-view-name attribute.
      const view = (name: string) => (variant === "view" ? ` data-view-name="${name}"` : "");
      const initial = () =>
        `${identity}<dialog open><button aria-label="İçerik türlerini genişlet"></button></dialog>`;
      const expanded = () =>
        `${identity}<dialog open><button aria-label="İçerik türlerini daralt"></button><a${view("share-sharebox-bottom-bar-document")} aria-label="Belge">Belge</a></dialog>`;
      const picker = () =>
        `${identity}<dialog open><button${view("media-document-share-select-file")}>Dosya seçin</button></dialog>`;
      const document = () =>
        `${identity}<input type="file" data-bycoda-li-file="true" accept="application/pdf,application/msword"><dialog open><input type="text" placeholder="Belgenize açıklayıcı bir başlık ekleyin"><button>Geri</button><button${view("media-document-share-confirm")}>Bitti</button></dialog>`;
      const editor = () =>
        `${identity}<dialog open><div contenteditable="true" role="textbox"></div><button${view("share-post")}>Yayınla</button></dialog>`;
      const persisted = () =>
        `${outcome === "identity-change" ? identity.replace("/in/owner/", "/in/stranger/") : identity}<article data-urn="${id}"><a class="update-components-actor__meta-link" href="/in/owner/">Owner</a><div class="update-components-text">Hello</div><iframe title="${outcome === "different-title" ? "Other guide" : title}"></iframe></article>`;
      const f = fixture(initial(), {
        response: outcome === "unknown-receipt" ? "{}" : JSON.stringify({ value: id }),
        render: (url) => (url.includes("/feed/update/") ? persisted() : initial()),
        click: (el) => {
          const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
          if (label === "İçerik türlerini genişlet") f.window.document.body.innerHTML = expanded();
          if (label === "Belge") f.window.document.body.innerHTML = picker();
          if (label === "Dosya seçin") {
            stage = "document";
            f.window.document.body.innerHTML = document();
          }
          if (label === "Bitti") {
            stage = "editor";
            f.window.document.body.innerHTML = editor();
          }
        },
      });
      f.ctx.files = [{ path: file, kind: "document" }];
      const operation = linkedInPublishDocument(
        f.ctx,
        job({ media: [{ kind: "document", uploadId: "owner-pdf" }] }, "publish"),
        title,
      );
      if (outcome === "success")
        expect(await operation).toEqual({
          platformId: id,
          url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
        });
      else await expect(operation).rejects.toMatchObject({ code: "unknown" });
      expect(stage).toBe("editor");
      expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
      const index = f.order.indexOf("submitted");
      expect(f.order[index - 1]).toBe("identity");
      expect(f.order[index + 1]).toBe("click:document-post");
      expect(f.page.setFiles).toHaveBeenCalledWith(expect.any(String), [file]);
    },
  );
});
