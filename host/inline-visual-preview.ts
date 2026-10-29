import type { Browser, BrowserType } from "@playwright/test";
import type { BrowserLoader } from "./shared-browser";
import { sandboxedInlineVisual, type InlineVisualSnapshot } from "../src/features/sessions/model/inlineVisual";

let active = false;
/** Separate ephemeral browser: never touches a shared browser lease, profile or app bridge. */
export async function previewInlineVisual(
  snapshot: InlineVisualSnapshot,
  authorized: () => boolean | Promise<boolean>,
  load: BrowserLoader,
) {
  if (active) throw new Error("A visual preview is already running on this Host. Retry after it completes.");
  active = true;
  let browser: Browser | undefined;
  try {
    // BrowserRuntime exposes a narrow shared-browser facade over the same
    // Playwright module. Only this dedicated renderer uses its context API.
    const chromium = (await load()).chromium as unknown as BrowserType;
    if (!(await authorized())) throw new Error("Session authority revoked.");
    browser = await chromium.launch({ headless: true, timeout: 10000 });
    const context = await browser.newContext({ viewport: { width: 960, height: snapshot.height }, acceptDownloads: false, serviceWorkers: "block", offline: true, permissions: [] });
    // Defense beyond document CSP: this also denies script-driven navigation and WebSockets.
    await context.route("**/*", route => route.abort("blockedbyclient"));
    await context.routeWebSocket("**/*", socket => socket.close());
    const page = await context.newPage();
    await page.setContent('<!doctype html><meta name="color-scheme" content="light"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>', { timeout: 5000 });
    await page.evaluate(source => {
      const frame = document.createElement("iframe");
      frame.sandbox.add("allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.srcdoc = source;
      document.body.append(frame);
    }, sandboxedInlineVisual(snapshot.html, false));
    const frame = page.frames().find(frame => frame.parentFrame());
    if (!frame) throw new Error("Visual sandbox did not mount.");
    await frame.waitForLoadState("load", { timeout: 5000 });
    const text = (await frame.locator("body").innerText({ timeout: 1000 })).slice(0, 1200);
    const data = await page.screenshot({ type: "jpeg", quality: 65, timeout: 5000 });
    if (!(await authorized())) throw new Error("Session authority revoked.");
    return { title: snapshot.title, width: 960, height: snapshot.height, text, frame: { mime: "image/jpeg", data: data.toString("base64") }, next: "Call visuals.render with the same source to publish the immutable visual inside this conversation." };
  } finally {
    try { await browser?.close(); } finally { active = false; }
  }
}
