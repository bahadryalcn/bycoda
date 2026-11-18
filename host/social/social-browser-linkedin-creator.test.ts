import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import {
  linkedInPrepareArticle,
  parseLinkedInArticleDraft,
} from "./social-browser-linkedin-creator";

const feed = "https://www.linkedin.com/feed/";
const article = "https://www.linkedin.com/article/new/";
const saved = "https://www.linkedin.com/article/edit/7371/";
const draft = { title: "Product launch", body: "Read about our new product." };
const windows: Window[] = [];

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function fixture(
  options: {
    publisher?: string;
    prior?: string;
    challenge?: boolean;
    saved?: boolean;
    ambiguousLink?: boolean;
  } = {},
) {
  const window = new Window({ url: feed });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  const accessibilityLink = '<a href="/article/new/">Write article</a>';
  const goto = vi.fn(async (url: string) => {
    window.location.href = url;
    window.document.body.innerHTML =
      url === feed
        ? `<main>${accessibilityLink}${options.ambiguousLink ? accessibilityLink : ""}</main>`
        : `<main>
        <a aria-current="true" href="/in/${options.publisher ?? "owner"}/">Author</a>
        <input type="text" aria-label="Title" value="${options.prior ?? ""}">
        <div role="textbox" contenteditable="true" aria-label="Write here"></div>
        <div role="status"></div><button>Publish</button>
        ${options.challenge ? "<h1>Security verification</h1>" : ""}
      </main>`;
  });
  const fill = vi.fn(async (selector: string, value: string) => {
    const field = window.document.querySelector(selector)!;
    if (field instanceof window.HTMLInputElement) field.value = value;
    else {
      field.textContent = value;
      if (options.saved !== false) {
        window.location.href = saved;
        window.document.querySelector('[role="status"]')!.textContent = "Saved";
      }
    }
  });
  const click = vi.fn();
  const evaluate = vi.fn(async <T>(expression: string) => window.eval(expression) as T);
  const page = { click, evaluate, fill, goto } as unknown as BrowserPage;
  const beforeDraftWrite = vi.fn(async () => undefined);
  const markSubmitted = vi.fn();
  const ctx: BrowserRecipeContext = {
    account: {
      platform: "linkedin",
      accountType: "member",
      connection: "browser",
      platformId: "web:linkedin:in:owner",
    } as SocialAccount,
    page,
    files: [],
    now: () => 0,
    waitFor: (expression) => page.evaluate(expression),
    verifyIdentity: vi.fn(async () => undefined),
    markSubmitted,
  };
  return { ctx, beforeDraftWrite, click, fill, goto, markSubmitted };
}

describe("LinkedIn native article drafts", () => {
  it("requires exact plain text fields and normalizes line endings", () => {
    expect(parseLinkedInArticleDraft({ title: " News ", body: "First\r\nSecond" })).toEqual({
      title: "News",
      body: "First\nSecond",
    });
    expect(() => parseLinkedInArticleDraft({ ...draft, publish: true })).toThrow();
    expect(() => parseLinkedInArticleDraft({ ...draft, title: "Two\nLines" })).toThrow();
  });

  it("prepares a verified saved draft without selecting Next or Publish", async () => {
    const { ctx, beforeDraftWrite, click, fill, goto, markSubmitted } = fixture();
    await expect(linkedInPrepareArticle(ctx, draft, beforeDraftWrite)).resolves.toEqual({
      state: "draft",
      url: saved,
    });
    expect(goto.mock.calls).toEqual([[feed], [article]]);
    expect(fill.mock.calls.map((args) => args[1])).toEqual([draft.title, draft.body]);
    expect(beforeDraftWrite).toHaveBeenCalledTimes(1);
    expect(beforeDraftWrite.mock.invocationCallOrder[0]).toBeLessThan(
      fill.mock.invocationCallOrder[0]!,
    );
    expect(markSubmitted.mock.invocationCallOrder[0]).toBeLessThan(
      fill.mock.invocationCallOrder[0]!,
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    { publisher: "another" },
    { prior: "Existing draft" },
    { challenge: true },
    { ambiguousLink: true },
  ])("requires an owner before editing an unknown screen %j", async (options) => {
    const { ctx, beforeDraftWrite, click, fill, markSubmitted } = fixture(options);
    await expect(linkedInPrepareArticle(ctx, draft, beforeDraftWrite)).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(beforeDraftWrite).not.toHaveBeenCalled();
    expect(markSubmitted).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
  });

  it("does not type on revoked approval or retry after an unconfirmed autosave", async () => {
    const first = fixture();
    first.beforeDraftWrite.mockRejectedValue(new Error("revoked"));
    await expect(linkedInPrepareArticle(first.ctx, draft, first.beforeDraftWrite)).rejects.toThrow(
      "revoked",
    );
    expect(first.fill).not.toHaveBeenCalled();
    const second = fixture({ saved: false });
    await expect(
      linkedInPrepareArticle(second.ctx, draft, second.beforeDraftWrite),
    ).rejects.toMatchObject({
      code: "unknown",
    });
    expect(second.fill).toHaveBeenCalledTimes(2);
  });
});
