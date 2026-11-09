import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import { detectChallenge } from "./browser/challenge";

/** Recorded Meta page shapes. The fixtures are synthetic markup, never copied from a live session. */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/meta/${name}`, import.meta.url), "utf8");

/** A DOM-backed page at a URL; interaction methods are spies that detection must never call. */
function pageAt(url: string, html: string) {
  const window = new Window({ url });
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
  window.document.body.innerHTML = body;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  const interactions = {
    goto: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    cookies: vi.fn(),
    watchResponse: vi.fn(),
  };
  const page = {
    ...interactions,
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression) as T),
  } as unknown as BrowserPage;
  return { page, interactions };
}

describe("Meta recorded page fixtures", () => {
  it("treats an ordinary logged-in Instagram inbox as no challenge", async () => {
    const { page, interactions } = pageAt(
      "https://www.instagram.com/direct/inbox/",
      fixture("instagram-inbox.html"),
    );
    await expect(detectChallenge(page)).resolves.toBeNull();
    for (const spy of Object.values(interactions)) expect(spy).not.toHaveBeenCalled();
  });

  it("recognizes an Instagram security-code step as verification, without entering the code", async () => {
    const { page, interactions } = pageAt(
      "https://www.instagram.com/challenge/",
      fixture("instagram-verification.html"),
    );
    await expect(detectChallenge(page)).resolves.toEqual({
      kind: "verification",
      url: "https://www.instagram.com/challenge/",
    });
    expect(interactions.fill).not.toHaveBeenCalled();
    expect(interactions.click).not.toHaveBeenCalled();
  });

  it("recognizes a Facebook captcha checkpoint as captcha without solving it", async () => {
    const { page, interactions } = pageAt(
      "https://www.facebook.com/checkpoint/1501092823525282/",
      fixture("facebook-captcha-checkpoint.html"),
    );
    await expect(detectChallenge(page)).resolves.toEqual({
      kind: "captcha",
      url: "https://www.facebook.com/checkpoint/1501092823525282/",
    });
    expect(interactions.click).not.toHaveBeenCalled();
    expect(interactions.setFiles).not.toHaveBeenCalled();
  });

  it("recognizes the Facebook login page as login (logged out, not escalated as a challenge)", async () => {
    const { page } = pageAt("https://www.facebook.com/login/", fixture("facebook-login.html"));
    await expect(detectChallenge(page)).resolves.toEqual({
      kind: "login",
      url: "https://www.facebook.com/login/",
    });
  });
});
