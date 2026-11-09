import type { Browser, BrowserType } from "@playwright/test";
import type { BrowserLoader } from "../browser/shared-browser";
import {
  MAX_INLINE_VISUAL_HEIGHT,
  MIN_INLINE_VISUAL_HEIGHT,
  sandboxedInlineVisual,
  type InlineVisualSource,
} from "../../src/features/sessions/model/inlineVisual";

let active = false;
/** Separate ephemeral browser: never touches a shared browser lease, profile or app bridge. */
export async function previewInlineVisual(
  visual: InlineVisualSource,
  view: { width: number; dark: boolean },
  authorized: () => boolean | Promise<boolean>,
  load: BrowserLoader,
) {
  if (active)
    throw new Error("A visual preview is already running on this Host. Retry after it completes.");
  active = true;
  let browser: Browser | undefined;
  try {
    // BrowserRuntime exposes a narrow shared-browser facade over the same
    // Playwright module. Only this dedicated renderer uses its context API.
    const chromium = (await load()).chromium as unknown as BrowserType;
    if (!(await authorized())) throw new Error("Session authority revoked.");
    browser = await chromium.launch({ headless: true, timeout: 10000 });
    const context = await browser.newContext({
      viewport: { width: view.width, height: MAX_INLINE_VISUAL_HEIGHT },
      acceptDownloads: false,
      serviceWorkers: "block",
      offline: true,
      permissions: [],
    });
    // Defense beyond document CSP: this also denies script-driven navigation and WebSockets.
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    const consoleLines: string[] = [];
    page.on("console", (message) => {
      if (consoleLines.length < 20)
        consoleLines.push(`${message.type()}: ${message.text().slice(0, 300)}`);
    });
    page.on("pageerror", (error) => {
      if (consoleLines.length < 20) consoleLines.push(`error: ${error.message.slice(0, 300)}`);
    });
    await page.setContent(
      `<!doctype html><meta name="color-scheme" content="${view.dark ? "dark" : "light"}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>`,
      { timeout: 5000 },
    );
    await page.evaluate(
      (source) => {
        const frame = document.createElement("iframe");
        frame.sandbox.add("allow-scripts");
        frame.referrerPolicy = "no-referrer";
        frame.srcdoc = source;
        document.body.append(frame);
      },
      sandboxedInlineVisual(visual.html, view.dark),
    );
    const frame = page.frames().find((frame) => frame.parentFrame());
    if (!frame) throw new Error("Visual sandbox did not mount.");
    await frame.waitForLoadState("load", { timeout: 5000 });
    // Let first-frame animations and layout scripts settle before measuring.
    await page.waitForTimeout(150);
    const measured = await frame.evaluate(() =>
      Math.ceil(
        Math.max(
          document.documentElement.getBoundingClientRect().height,
          document.body.scrollHeight,
        ),
      ),
    );
    const contentHeight = Math.min(
      MAX_INLINE_VISUAL_HEIGHT,
      Math.max(MIN_INLINE_VISUAL_HEIGHT, measured),
    );
    await page.setViewportSize({ width: view.width, height: contentHeight });
    const text = (await frame.locator("body").innerText({ timeout: 1000 })).slice(0, 1200);
    const data = await page.screenshot({
      type: "jpeg",
      quality: 65,
      timeout: 5000,
    });
    if (!(await authorized())) throw new Error("Session authority revoked.");
    return {
      title: visual.title,
      width: view.width,
      contentHeight,
      ...(measured > MAX_INLINE_VISUAL_HEIGHT ? { clipped: true } : {}),
      console: consoleLines,
      text,
      frame: { mime: "image/jpeg", data: data.toString("base64") },
      next: `Call visuals.render with the same source and height ${contentHeight} to show the visual in this conversation.`,
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      active = false;
    }
  }
}
