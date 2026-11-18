import { Window, type HTMLTextAreaElement } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import {
  parseLinkedInMemberProfileUpdate,
  readLinkedInMemberProfile,
  updateLinkedInMemberProfile,
} from "./social-browser-linkedin-member-profile";

const profile = "https://www.linkedin.com/in/owner/";
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function fixture(
  options: { redirect?: string; duplicate?: boolean; persist?: boolean; clickError?: boolean } = {},
) {
  const window = new Window({ url: profile });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  const stored = { headline: "Old headline", about: "Old about" };
  const fields = {
    headline: { path: "edit/intro", heading: "Edit intro", label: "Headline" },
    about: { path: "edit/forms/summary/new", heading: "Edit about", label: "About" },
  } as const;
  const render = (url: string) => {
    window.location.href = options.redirect ?? url;
    const section = Object.values(fields).find((field) =>
      window.location.pathname.endsWith(field.path + "/"),
    );
    window.document.body.innerHTML = section
      ? `<div role="dialog"><h2>${section.heading}</h2><label for="field">${section.label}</label><textarea id="field"></textarea><button>Save</button>${options.duplicate ? "<button>Save</button>" : ""}</div>`
      : '<main><a href="/in/owner/edit/intro/">Edit intro</a><a href="/in/owner/edit/forms/summary/new/">Edit about</a><a href="/in/other/edit/intro/">Unrelated</a></main>';
    if (section)
      window.document.querySelector<HTMLTextAreaElement>("#field")!.value =
        section === fields.headline ? stored.headline : stored.about;
  };
  const page = {
    goto: vi.fn(async (url: string) => render(url)),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    fill: vi.fn(async (selector: string, value: string) => {
      window.document.querySelector<HTMLTextAreaElement>(selector)!.value = value;
    }),
    click: vi.fn(async () => {
      if (options.clickError) throw new Error("Browser lost after dispatch.");
      if (options.persist !== false) {
        const key = window.location.pathname.includes("/edit/intro/") ? "headline" : "about";
        stored[key] = window.document.querySelector<HTMLTextAreaElement>("#field")!.value;
      }
      render(profile);
    }),
  } as unknown as BrowserPage;
  const beforeSubmit = vi.fn(async () => undefined);
  const markSubmitted = vi.fn();
  const verifyIdentity = vi.fn(async () => undefined);
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
    verifyIdentity,
    markSubmitted,
  };
  return { ctx, page, beforeSubmit, markSubmitted, verifyIdentity };
}

it("rejects unrecognized and mixed edits and enforces profile text limits", () => {
  for (const raw of [
    { section: "password", expectedValue: "", value: "secret" },
    { section: "about", value: "new" },
    { section: "headline", expectedValue: "", value: "" },
    { section: "headline", expectedValue: "", value: "x".repeat(221) },
    { section: "about", expectedValue: "", value: "new", website: "https://example.com" },
  ])
    expect(() => parseLinkedInMemberProfileUpdate(raw)).toThrow();
  expect(
    parseLinkedInMemberProfileUpdate({ section: "about", expectedValue: "old", value: "" }),
  ).toEqual({ section: "about", expectedValue: "old", value: "" });
});

it.each(["headline", "about"] as const)(
  "reads and writes the exact member %s editor with persisted verification",
  async (section) => {
    const { ctx, page, beforeSubmit, markSubmitted } = fixture();
    const reviewed = await readLinkedInMemberProfile(ctx, section);
    expect(reviewed).toEqual({ section, value: `Old ${section}` });
    expect(
      await updateLinkedInMemberProfile(
        ctx,
        { section, expectedValue: reviewed.value, value: "Updated" },
        beforeSubmit,
      ),
    ).toEqual({ section, value: "Updated" });
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(markSubmitted).toHaveBeenCalledTimes(1);
    expect(page.click).toHaveBeenCalledTimes(1);
  },
);

it("holds stale review and duplicate controls without a Save click", async () => {
  const stale = fixture();
  await expect(
    updateLinkedInMemberProfile(
      stale.ctx,
      { section: "headline", expectedValue: "Wrong", value: "New" },
      stale.beforeSubmit,
    ),
  ).rejects.toMatchObject({ code: "denied" });
  expect(stale.page.fill).not.toHaveBeenCalled();
  const ambiguous = fixture({ duplicate: true });
  await expect(
    updateLinkedInMemberProfile(
      ambiguous.ctx,
      { section: "headline", expectedValue: "Old headline", value: "New" },
      ambiguous.beforeSubmit,
    ),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(ambiguous.page.click).not.toHaveBeenCalled();
});

it.each(["https://www.linkedin.com/checkpoint/challenge/", "https://www.linkedin.com/login/"])(
  "stops at human-only screen %s before browser input",
  async (redirect) => {
    const { ctx, page, beforeSubmit, verifyIdentity } = fixture({ redirect });
    await expect(
      updateLinkedInMemberProfile(
        ctx,
        { section: "headline", expectedValue: "Old headline", value: "New" },
        beforeSubmit,
      ),
    ).rejects.toMatchObject({ code: "needs_human" });
    expect(verifyIdentity).not.toHaveBeenCalled();
    expect(page.fill).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  },
);

it.each([{ persist: false }, { clickError: true }])(
  "requires inspection when persistence is uncertain",
  async (options) => {
    const { ctx, page, beforeSubmit } = fixture(options);
    await expect(
      updateLinkedInMemberProfile(
        ctx,
        { section: "about", expectedValue: "Old about", value: "New" },
        beforeSubmit,
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(page.click).toHaveBeenCalledTimes(1);
  },
);
