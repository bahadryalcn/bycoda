import { Window } from "happy-dom";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import { SocialPlatformError } from "../src/integrations/social/adapter";
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
const profile = (degree = "1st", label = "Message") =>
  `${identity}<main><h1>Friend</h1><span class="dist-value">${degree}</span><button>${label}</button></main>`;
const messageRow = (id = "urn:li:msg_message:new", text = "Hello", sender = "owner") =>
  `<li class="msg-s-message-group"><a class="msg-s-message-group__profile-link" href="/in/${sender}/">Author</a><div data-event-urn="${id}"><p class="msg-s-event-listitem__body">${text}</p><time datetime="${new Date(now).toISOString()}"></time></div></li>`;
const conversation = (rows = "", recipient = "friend", draft = "", thread = false) =>
  `${identity}<section class="msg-thread"><a class="msg-thread__link-to-profile" href="/in/${recipient}/">Recipient</a>${thread ? '<a href="/messaging/thread/thread-123/">Open conversation</a>' : ""}<ul class="msg-s-message-list">${rows}</ul><div class="msg-form__contenteditable" contenteditable="true">${draft}</div><button class="msg-form__send-button">Send</button></section>`;
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
          : conversation(sent ? messageRow() : "", "friend", "", true),
      click: (el) => {
        if (el.textContent === "Message") f.window.document.body.innerHTML = conversation();
        if (el.textContent === "Send") {
          sent = true;
          f.window.document.body.innerHTML = conversation(messageRow(), "friend", "", true);
        }
      },
    });
    expect(await linkedInStartMessage(f.ctx, job())).toEqual({
      platformId: "urn:li:msg_message:new",
      url: "https://www.linkedin.com/messaging/thread/thread-123/",
    });
    const index = f.order.indexOf("submitted");
    expect(f.order[index - 1]).toBe("identity");
    expect(f.order[index + 1]).toBe("click:message-send");
    expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
    expect(f.page.cookies).not.toHaveBeenCalled();
  });
  it.each(["2nd", "3rd", ""])(
    "does not initiate for unverified free eligibility %s",
    async (degree) => {
      const f = fixture(profile(degree));
      await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
      expect(f.page.click).not.toHaveBeenCalled();
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
  it.each(["wrong-recipient", "existing-draft", "inmail", "group"])(
    "rejects %s before Send",
    async (reason) => {
      const f = fixture(profile(), {
        click: (el) => {
          if (el.textContent !== "Message") return;
          f.window.document.body.innerHTML = conversation(
            "",
            reason === "wrong-recipient" ? "stranger" : "friend",
            reason === "existing-draft" ? "Owner's unsent draft" : "",
          );
          if (reason === "inmail")
            f.window.document
              .querySelector(".msg-thread")!
              .insertAdjacentHTML("beforeend", '<input name="subject">');
          if (reason === "group")
            f.window.document
              .querySelector(".msg-thread")!
              .insertAdjacentHTML(
                "beforeend",
                '<a class="msg-thread__link-to-profile" href="/in/other/">Other</a>',
              );
        },
      });
      await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
  it("honors an identity/Stop change before irreversible Send", async () => {
    const f = fixture(profile(), {
      click: (el) => {
        if (el.textContent === "Message") f.window.document.body.innerHTML = conversation();
      },
    });
    const fill = f.page.fill;
    f.page.fill = async (selector, text) => {
      await fill(selector, text);
      f.window.document.querySelector("[data-own]")!.setAttribute("href", "/in/different/");
    };
    await expect(linkedInStartMessage(f.ctx, job())).rejects.toMatchObject({ code: "denied" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
  it.each(["no-thread", "unpersisted", "wrong-sender", "duplicate"])(
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
                      : messageRow(),
                "friend",
                "",
                true,
              ),
        click: (el) => {
          if (el.textContent === "Message") f.window.document.body.innerHTML = conversation();
          if (el.textContent === "Send") {
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
  it("saves and reopens one image's description without any external Post click", async () => {
    let saved = "",
      editing = false;
    const media = [{ kind: "image" as const, uploadId: "upload", alt: "Bycoda workflow" }];
    const render = () =>
      `${identity}<div role="dialog"><img src="blob:owner-upload">${editing ? `<textarea>${saved}</textarea><button>Save</button>` : "<button>Alt.text</button>"}</div>`;
    const f = fixture(render(), {
      click: (el) => {
        if (el.textContent === "Alt.text") {
          editing = true;
          f.window.document.body.innerHTML = render();
        }
        if (el.textContent === "Save") {
          saved = (f.window.document.querySelector("textarea") as any).value;
          editing = false;
          f.window.document.body.innerHTML = render();
        }
      },
    });
    await linkedInApplyImageAlt(f.ctx, media);
    expect(saved).toBe(media[0].alt);
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    const id = "urn:li:activity:123";
    f.window.document.body.innerHTML = `<article data-urn="${id}"><div class="update-components-image"><img src="https://media.licdn.com/a.jpg" alt="${saved}"></div></article>`;
    expect(await f.page.evaluate(linkedInImageAltEvidence(id, media))).toBe(true);
    f.window.document.querySelector("img")!.setAttribute("alt", "automatic description");
    expect(await f.page.evaluate(linkedInImageAltEvidence(id, media))).toBe(false);
  });
  it("rejects a lost saved description and ambiguous multiple-image mapping", async () => {
    const f = fixture(
      `${identity}<div role="dialog"><img src="blob:owner-upload"><button>Alt.text</button></div>`,
      {
        click: (el) => {
          if (el.textContent === "Alt.text")
            f.window.document.body.innerHTML = `${identity}<div role="dialog"><textarea></textarea><button>Save</button></div>`;
          else
            f.window.document.body.innerHTML = `${identity}<div role="dialog"><img src="blob:owner-upload"><button>Alt.text</button></div>`;
        },
      },
    );
    const media = [{ kind: "image" as const, uploadId: "one", alt: "Description" }];
    await expect(linkedInApplyImageAlt(f.ctx, media)).rejects.toMatchObject({ code: "denied" });
    await expect(
      linkedInApplyImageAlt(f.ctx, [...media, { kind: "image", uploadId: "two" }]),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
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
  it.each(["success", "unknown-receipt", "different-title", "identity-change"])(
    "requires exact reopened actor/text/document title after submit: %s",
    async (outcome) => {
      const file = await pdf();
      let stage = "initial";
      const id = "urn:li:activity:123456",
        title = "Bycoda guide";
      const initial = () =>
        `${identity}<button class="share-box-feed-entry__trigger">Start a post</button><div role="dialog"><button>Add a document</button></div>`;
      const document = () =>
        `${identity}<div role="dialog"><input type="file" accept="application/pdf"><input type="text" aria-label="Document title"><iframe title="Preview"></iframe><button>Done</button></div>`;
      const editor = () =>
        `${identity}<div role="dialog"><div class="ql-editor" contenteditable="true"></div><button class="share-actions__primary-action">Post</button></div>`;
      const persisted = () =>
        `${outcome === "identity-change" ? identity.replace("/in/owner/", "/in/stranger/") : identity}<article data-urn="${id}"><a class="update-components-actor__meta-link" href="/in/owner/">Owner</a><div class="update-components-text">Hello</div><iframe title="${outcome === "different-title" ? "Other guide" : title}"></iframe></article>`;
      const f = fixture(initial(), {
        response: outcome === "unknown-receipt" ? "{}" : JSON.stringify({ value: id }),
        render: (url) => (url.includes("/feed/update/") ? persisted() : initial()),
        click: (el) => {
          if (el.textContent === "Add a document") {
            stage = "document";
            f.window.document.body.innerHTML = document();
          }
          if (el.textContent === "Done") {
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
