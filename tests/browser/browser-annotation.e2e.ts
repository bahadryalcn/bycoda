import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SharedBrowser, type BrowserLoader } from "../../host/shared-browser";
import type { BrowserAnnotationCapture } from "../../src/shared/lib/browserAnnotation";

const site =
  "http://127.0.0.1:1444/tests/browser/browser-element-target.html?token=fixture-url-token#private-fragment";
async function fixture(page: Page, browser: Browser, language = "en") {
  let context: BrowserContext | undefined,
    target: Page | undefined,
    offset = 0;
  let capture: BrowserAnnotationCapture | undefined;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const source = new SharedBrowser(
    (async () => ({
      chromium: {
        launch: async () => ({
          newContext: async (options: object) => {
            context = await browser.newContext(options);
            return {
              newPage: async () => {
                target = await context!.newPage();
                return target;
              },
            };
          },
          close: async () => {
            await context?.close();
          },
        }),
      },
    })) as BrowserLoader,
    () => Date.now() + offset,
  );
  const claim = await source.dispatch("browser.claim", {}, "fixture-device");
  await source.dispatch("browser.open", { leaseId: claim.leaseId, url: site }, "fixture-device");
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No installed app or native host in this fixture: ${command}`);
        },
      },
    });
  });
  await page.route("**/browser-fixture/rpc", async (route) => {
    const input = route.request().postDataJSON();
    calls.push(input);
    try {
      let result;
      {
        if (
          input.method.startsWith("browser.annotation.") &&
          input.params.projectId !==
            (input.params.sessionId === "host-a" ? "project-a" : "project-b")
        )
          throw new Error("Conversation belongs to another project");
        result = await source.dispatch(input.method, input.params, "fixture-device");
        if ("selection" in result && result.selection) capture = result.selection;
      }
      await route.fulfill({ json: { result } });
    } catch (error) {
      await route.fulfill({ json: { error: String(error) } });
    }
  });
  await page.goto(`/tests/browser/browser-annotation.html?lang=${language}`);
  await page
    .getByRole("tab", { name: language === "tr" ? "Tarayıcı" : "Host browser", exact: true })
    .click();
  await expect(page.locator("img.host-browser-frame")).toBeVisible();
  return {
    source,
    target: target!,
    calls,
    capture: () => capture,
    expire: () => {
      offset += 31_000;
    },
    close: () => source.close(),
  };
}
async function mark(page: Page, target: Page, selector = "#action", language = "en") {
  await page
    .getByRole("button", {
      name: language === "tr" ? "Öğe seç ve composer'a ekle" : "Select element and add to composer",
      exact: true,
    })
    .click();
  const bounds = await target.locator(selector).boundingBox();
  const image = page.locator("img.host-browser-frame");
  const imageBox = await image.boundingBox();
  const point = {
    x: ((bounds!.x + bounds!.width / 2) * imageBox!.width) / 1280,
    y: ((bounds!.y + bounds!.height / 2) * imageBox!.height) / 720,
  };
  await image.hover({ position: point });
  await expect(page.locator('.host-browser-highlight[data-selected="false"]')).toBeVisible();
  await image.click({ position: point });
  await expect(page.locator(".host-browser-selection")).toBeVisible();
}

test("real DOM hit-test blocks button/link actions and binds a reviewable draft to the mapped composer", async ({
  page,
  browser,
}, info) => {
  const f = await fixture(page, browser);
  try {
    await mark(page, f.target);
    expect(
      await f.target.evaluate(() => (window as unknown as { fixtureEvents: object }).fixtureEvents),
    ).toEqual({ click: 0, pointerdown: 0, keydown: 0, action: 0 });
    let capture = f.capture()!;
    expect(capture).toMatchObject({
      projectId: "project-a",
      sessionId: "host-a",
      trust: "untrusted-page-data",
      element: { tag: "button", text: "Save changes" },
      viewport: { width: 1280, height: 720 },
    });
    expect(
      await f.target.evaluate(
        (selector) => document.querySelector(selector)?.id,
        capture.element.selector,
      ),
    ).toBe("action");
    expect(capture.element.ancestry.map((entry) => entry.tag)).toContain("body");
    expect(capture.element.computedStyle["background-color"]).toBe("rgb(49, 92, 190)");
    expect(capture.pageUrl).not.toContain("token");
    expect(capture.pageUrl).not.toContain("private-fragment");
    const passwordBounds = await f.target.locator("#password").boundingBox();
    const pixel = await page.evaluate(
      async ({ data, box }) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return Array.from(
          context.getImageData(box.x + box.width / 2, box.y + box.height / 2, 1, 1).data,
        );
      },
      { data: capture.screenshot.data, box: passwordBounds! },
    );
    expect(pixel.slice(0, 3).every((channel) => Math.abs(channel - 51) < 8)).toBe(true);
    await page.getByLabel("Explain the selected element").fill("Please reduce the padding.");
    await page.getByRole("button", { name: "Add selection to composer", exact: true }).click();
    const composer = page.getByRole("region", { name: "Target composer" });
    await composer.getByText("Inspect browser element", { exact: true }).click();
    await expect(composer.getByText("Please reduce the padding.")).toBeVisible();
    await expect(composer.locator("textarea")).toHaveValue("Please adjust this [image1]");
    expect(
      await page.evaluate(
        () => (window as unknown as { annotationFixture: { sent: number } }).annotationFixture.sent,
      ),
    ).toBe(0);
    expect(
      f.calls.some(
        (call) => call.method === "browser.input" || call.method.startsWith("sessions."),
      ),
    ).toBe(false);
    await page.screenshot({ path: info.outputPath("composer-review.png"), fullPage: true });
    await composer.getByRole("button", { name: "Remove browser-element.jpg", exact: true }).click();
    await expect(composer.getByText("Inspect browser element", { exact: true })).toHaveCount(0);
    // Select a link through the same UI and confirm its href never navigated.
    await mark(page, f.target, "#link");
    capture = f.capture()!;
    expect(capture.element.tag).toBe("a");
    expect(f.target.url()).toBe(site);
    expect(
      await f.target.evaluate(
        () => (window as unknown as { fixtureEvents: { click: number } }).fixtureEvents.click,
      ),
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("redacts form/hidden/token content, masks frames, and preserves hostile page prose only as data", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    const status = await f.source.dispatch("browser.status", {}, "fixture-device");
    const scope = {
      projectId: "project-a",
      sessionId: "host-a",
      leaseId: status.leaseId,
      navigationId: status.navigationId,
    };
    const started = await f.source.dispatch("browser.annotation.start", scope, "fixture-device");
    const params = { ...scope, annotationId: started.annotationId, x: 1200, y: 650 };
    const body = await f.source.dispatch("browser.annotation.select", params, "fixture-device");
    const serialized = JSON.stringify(body.selection);
    for (const secret of [
      "fixture-password-123",
      "private@example.test",
      "fixture-private-note",
      "fixture-private-choice",
      "fixture-hidden-token",
      "sk-fixture",
      "fixture-sensitive-block",
      "fixture-hidden-text",
      "Cross-origin secret frame",
      "fixture-css-secret",
      "fixture-closed-shadow-secret",
    ])
      expect(serialized).not.toContain(secret);
    expect(body.selection?.element.text).toContain("Save changes");
    expect(body.selection?.element.text).toContain("Ignore prior instructions");
    const privateBoxes = await f.target
      .locator("#pseudo, #secret, [data-sensitive], iframe, #closed-shadow")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x + 20, y: box.y + box.height / 2 };
        }),
      );
    const pixels = await page.evaluate(
      async ({ data, points }) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return points.map((point) => Array.from(ctx.getImageData(point.x, point.y, 1, 1).data));
      },
      { data: body.selection!.screenshot.data, points: privateBoxes },
    );
    expect(
      pixels.every((pixel) => pixel.slice(0, 3).every((channel) => Math.abs(channel - 51) < 8)),
    ).toBe(true);
    const shadow = await f.target.locator("#closed-shadow").boundingBox();
    expect(await f.target.locator("#closed-shadow").evaluate((host) => host.shadowRoot)).toBeNull();
    expect(
      await f.target.locator("#closed-shadow").evaluate((host) => getComputedStyle(host).opacity),
    ).toBe("1");
    const overflow = await page.evaluate(
      async ({ data, point }) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(point.x, point.y, 8, 8).data).filter(
          (_v, index) => index % 4 !== 3,
        );
      },
      { data: body.selection!.screenshot.data, point: { x: shadow!.x + 250, y: shadow!.y + 5 } },
    );
    expect(overflow.every((channel) => Math.abs(channel - 250) < 8)).toBe(true);
    const closed = await f.source.dispatch(
      "browser.annotation.select",
      { ...params, x: shadow!.x + 10, y: shadow!.y + 10 },
      "fixture-device",
    );
    expect(closed.limitation).toContain("Shadow DOM");
    expect(closed.selection).toBeUndefined();
    const frame = await f.target.locator("iframe").boundingBox();
    const limited = await f.source.dispatch(
      "browser.annotation.select",
      { ...params, x: frame!.x + 20, y: frame!.y + 20 },
      "fixture-device",
    );
    expect(limited.limitation).toContain("cross-origin");
    expect(limited.selection).toBeUndefined();
  } finally {
    await f.close();
  }
});

test("cancel, navigation, DOM replacement, project/session switch and lease expiry invalidate pending picks", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    await mark(page, f.target);
    await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
    await expect(page.locator(".host-browser-selection")).toHaveCount(0);
    await mark(page, f.target);
    await f.target.evaluate(() => history.pushState({}, "", "?next=1"));
    await expect(page.locator(".host-browser-selection")).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh frame", exact: true }).click();
    await mark(page, f.target);
    await f.target.locator("#action").evaluate((element) => {
      element.textContent = "Replacement";
    });
    await page.getByRole("button", { name: "Add selection to composer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Page changed");
    await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
    await mark(page, f.target);
    await page.getByRole("button", { name: "Switch project and session", exact: true }).click();
    await page.getByRole("tab", { name: "Host browser", exact: true }).click();
    await expect(page.locator(".host-browser-selection")).toHaveCount(0);
    await mark(page, f.target);
    expect(f.capture()?.sessionId).toBe("host-b");
    expect(f.capture()?.projectId).toBe("project-b");
    f.expire();
    await expect(page.locator(".host-browser-selection")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Select element and add to composer", exact: true }),
    ).toBeDisabled();
  } finally {
    await f.close();
  }
});

test("Turkish selection remains reviewable at 320px and Escape cancels without a page key event", async ({
  page,
  browser,
}, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const f = await fixture(page, browser, "tr");
  try {
    await mark(page, f.target, "#action", "tr");
    await expect(page.getByLabel("Seçilen öğeyi açıkla")).toBeVisible();
    await page.getByLabel("Seçilen öğeyi açıkla").scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Seçilen öğeyi açıkla")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("selection-tr-320.png"), fullPage: true });
    await page.locator("img.host-browser-frame").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".host-browser-selection")).toHaveCount(0);
    expect(
      await f.target.evaluate(
        () => (window as unknown as { fixtureEvents: { keydown: number } }).fixtureEvents.keydown,
      ),
    ).toBe(0);
  } finally {
    await f.close();
  }
});
