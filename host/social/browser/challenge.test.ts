import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserPage } from "../social-browser";
import {
  captureNeedsHumanScreenshot,
  detectChallenge,
  challengeError,
  needsHumanError,
} from "./challenge";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A DOM-backed page whose interaction methods are spies; detection must never call them. */
function pageAt(url: string, html: string) {
  const window = new Window({ url });
  window.document.body.innerHTML = html;
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

it("recognizes a captcha iframe as captcha without interacting", async () => {
  const { page, interactions } = pageAt(
    "https://www.linkedin.com/checkpoint/challenge/AgE",
    `<iframe src="https://www.google.com/recaptcha/api2/anchor?k=1"></iframe>`,
  );
  await expect(detectChallenge(page)).resolves.toEqual({
    kind: "captcha",
    url: "https://www.linkedin.com/checkpoint/challenge/AgE",
  });
  for (const spy of Object.values(interactions)) expect(spy).not.toHaveBeenCalled();
});

it("recognizes a human-verification heading as captcha", async () => {
  const { page } = pageAt("https://www.facebook.com/login/", `<h1>Verify you are human</h1>`);
  await expect(detectChallenge(page)).resolves.toMatchObject({ kind: "captcha" });
});

it("recognizes a one-time verification code field", async () => {
  const { page } = pageAt(
    "https://www.instagram.com/accounts/login/two_factor",
    `<input autocomplete="one-time-code" name="verificationCode">`,
  );
  await expect(detectChallenge(page)).resolves.toMatchObject({ kind: "verification" });
});

it("classifies checkpoint and challenge URLs as suspicious login", async () => {
  const { page } = pageAt("https://www.linkedin.com/checkpoint/lg/login-submit", "<p>Hello</p>");
  await expect(detectChallenge(page)).resolves.toEqual({
    kind: "suspicious_login",
    url: "https://www.linkedin.com/checkpoint/lg/login-submit",
  });
});

it("classifies a logged-out login route as login", async () => {
  const { page } = pageAt("https://www.instagram.com/accounts/login/", "<form></form>");
  await expect(detectChallenge(page)).resolves.toMatchObject({ kind: "login" });
});

it("keeps captcha ahead of URL classification and drops query strings from the result", async () => {
  const { page } = pageAt(
    "https://www.linkedin.com/checkpoint/challenge/x?token=secret123",
    `<iframe src="https://hcaptcha.com/1/api.js"></iframe>`,
  );
  const hit = await detectChallenge(page);
  expect(hit?.kind).toBe("captcha");
  expect(hit?.url).toBe("https://www.linkedin.com/checkpoint/challenge/x");
  expect(JSON.stringify(hit)).not.toContain("secret123");
});

it("returns null for an ordinary authenticated page", async () => {
  const { page, interactions } = pageAt(
    "https://www.linkedin.com/feed/",
    `<main><button>Start a post</button></main>`,
  );
  await expect(detectChallenge(page)).resolves.toBeNull();
  for (const spy of Object.values(interactions)) expect(spy).not.toHaveBeenCalled();
});

it("maps a recognized challenge to NEEDS_HUMAN and leaves ordinary and logged-out pages alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-challenge-"));
  directories.push(directory);
  const challenged = pageAt("https://www.linkedin.com/checkpoint/x", "<p></p>").page;
  await expect(challengeError(challenged, directory)).resolves.toMatchObject({
    code: "needs_human",
    detail: { url: "https://www.linkedin.com/checkpoint/x" },
  });
  const clean = pageAt("https://www.linkedin.com/feed/", "<p></p>").page;
  await expect(challengeError(clean, directory)).resolves.toBeUndefined();
  // A logged-out page keeps the existing expired outcome instead of asking the owner for a challenge.
  const loggedOut = pageAt("https://www.facebook.com/login/", "<form></form>").page;
  await expect(challengeError(loggedOut, directory)).resolves.toBeUndefined();
  const error = needsHumanError({ kind: "captcha", url: "https://x.test/" }, "shot-1");
  expect(error.code).toBe("needs_human");
  expect(error.detail).toEqual({ url: "https://x.test/", screenshotId: "shot-1" });
});

it("stores a screenshot under needs-human when the adapter can capture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-challenge-"));
  directories.push(directory);
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const { page } = pageAt("https://www.linkedin.com/checkpoint/x", "<p></p>");
  page.screenshot = vi.fn(async () => bytes);
  const id = await captureNeedsHumanScreenshot(page, directory);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await readFile(join(directory, "needs-human", `${id}.jpg`))).toEqual(Buffer.from(bytes));
});

it("returns no screenshot id when the adapter has no capture method", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-challenge-"));
  directories.push(directory);
  const { page } = pageAt("https://www.linkedin.com/checkpoint/x", "<p></p>");
  await expect(captureNeedsHumanScreenshot(page, directory)).resolves.toBeUndefined();
});
