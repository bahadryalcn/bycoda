import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { SharedBrowser, type BrowserLoader } from "../../host/browser/shared-browser";
import type { BrowserAnnotationCapture } from "../../src/shared/lib/browserAnnotation";

const site =
  "http://127.0.0.1:1444/tests/browser/browser-element-target.html?token=fixture-url-token#private-fragment";
async function fixture(page: Page, browser: Browser, language = "en", delayMs = 0) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 150)
    throw new Error("Invalid fixture delay");
  let context: BrowserContext | undefined,
    target: Page | undefined,
    offset = 0;
  let capture: BrowserAnnotationCapture | undefined;
  let failFrame = false;
  const calls: {
    method: string;
    params: Record<string, unknown>;
    start?: number;
    end?: number;
    bytes?: number;
    failure?: string;
  }[] = [];
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
    const record = {
      ...input,
      start: performance.now(),
      end: undefined as number | undefined,
      bytes: undefined as number | undefined,
      failure: undefined as string | undefined,
    };
    calls.push(record);
    try {
      if (input.method === "browser.frame" && failFrame) {
        failFrame = false;
        throw new Error("Fixture frame unavailable");
      }
      if (
        delayMs &&
        ["browser.input", "browser.frame", "browser.annotation.hover"].includes(input.method)
      )
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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
        record.end = performance.now();
        if ("data" in result && typeof result.data === "string")
          record.bytes = Math.floor((result.data.length * 3) / 4);
      }
      await route.fulfill({ json: { result } });
    } catch (error) {
      record.end = performance.now();
      record.failure = String(error);
      await route.fulfill({ json: { error: String(error) } });
    }
  });
  await page.goto(`/tests/browser/browser-annotation.html?lang=${language}`);
  // Wide panes show the tool tabs; narrow panes replace them with one tool menu.
  const toolName = language === "tr" ? "Tarayıcı" : "Host browser";
  const toolTab = page.getByRole("tab", { name: toolName, exact: true });
  const toolMenu = page.getByRole("button", {
    name: language === "tr" ? "Konuşma aracı seçimi" : "Conversation tool selection",
    exact: true,
  });
  await expect(toolTab.or(toolMenu)).toBeVisible();
  if (await toolTab.isVisible()) await toolTab.click();
  else {
    await toolMenu.click();
    await page.getByRole("menuitemradio", { name: toolName, exact: true }).click();
  }
  await expect(page.locator("img.host-browser-frame")).toBeVisible();
  return {
    source,
    target: target!,
    calls,
    capture: () => capture,
    failNextFrame: () => {
      failFrame = true;
    },
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
    await expect(
      page.getByRole("region", { name: "Selected browser element" }).getByRole("alert"),
    ).toContainText("Page changed");
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

test("real browser preserves frame identity, validates parent and exact capture IDs", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    const state = await f.source.dispatch("browser.status", {}, "fixture-device");
    const scope = { projectId: "project-a", sessionId: "host-a", leaseId: state.leaseId };
    const frame = await f.source.dispatch("browser.frame", scope, "fixture-device");
    const input = {
      ...scope,
      kind: "scroll",
      x: 0,
      y: 1,
      documentId: frame.documentId,
      requestId: "real-wheel",
    };
    const first = await f.source.dispatch("browser.input", input, "fixture-device");
    const repeated = await f.source.dispatch("browser.input", input, "fixture-device");
    expect(repeated.navigationId).toBe(first.navigationId);
    expect(first.documentId).toBe(frame.documentId);
    await expect(
      f.source.dispatch(
        "browser.input",
        { ...input, requestId: "stale", documentId: "stale" },
        "fixture-device",
      ),
    ).rejects.toThrow("document changed");
    const started = await f.source.dispatch(
      "browser.annotation.start",
      { ...scope, navigationId: first.navigationId },
      "fixture-device",
    );
    const annotation = {
      ...scope,
      navigationId: first.navigationId,
      annotationId: started.annotationId,
    };
    const bounds = await f.target.locator("#action").boundingBox();
    const selected = await f.source.dispatch(
      "browser.annotation.select",
      { ...annotation, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
      "fixture-device",
    );
    expect(selected.selection?.element.boxModel).toBeTruthy();
    expect(selected.selection?.element.nodeId).toBeTruthy();
    const sibling = await f.source.dispatch(
      "browser.annotation.traverse",
      { ...annotation, nodeId: selected.selection!.element.nodeId, direction: "nextSibling" },
      "fixture-device",
    );
    expect(sibling.selection?.element.tag).toBe("a");
    const previous = await f.source.dispatch(
      "browser.annotation.traverse",
      { ...annotation, nodeId: sibling.selection!.element.nodeId, direction: "previousSibling" },
      "fixture-device",
    );
    expect(previous.selection?.element.tag).toBe("button");
    const parent = await f.source.dispatch(
      "browser.annotation.parent",
      { ...annotation, nodeId: previous.selection!.element.nodeId },
      "fixture-device",
    );
    expect(parent.selection?.element.tag).not.toBe(selected.selection?.element.tag);
    const child = await f.source.dispatch(
      "browser.annotation.traverse",
      { ...annotation, nodeId: parent.selection!.element.nodeId, direction: "child" },
      "fixture-device",
    );
    expect(child.selection?.element.tag).toBe("button");
    const ancestor = await f.source.dispatch(
      "browser.annotation.traverse",
      {
        ...annotation,
        nodeId: child.selection!.element.nodeId,
        direction: "ancestor",
        ancestorIndex: 1,
      },
      "fixture-device",
    );
    expect(ancestor.selection?.element.tag).toBe("main");
    const exact = await f.source.dispatch(
      "browser.annotation.read",
      { ...annotation, captureId: selected.selection!.id },
      "fixture-device",
    );
    expect(exact.selection?.id).toBe(selected.selection?.id);
    await expect(
      f.source.dispatch(
        "browser.annotation.read",
        { ...annotation, captureId: "unknown" },
        "fixture-device",
      ),
    ).rejects.toThrow("not found");
  } finally {
    await f.close();
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`inspector ${theme} ${width}`, async ({ page, browser }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      const f = await fixture(page, browser);
      try {
        await page.evaluate(
          (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
          theme,
        );
        await f.target.locator("#action").evaluate((node) => {
          node.parentElement!.style.display = "flex";
        });
        await mark(page, f.target);
        await expect(page.locator(".host-browser-box-model").first()).toBeVisible();
        await page.getByRole("button", { name: "Select parent" }).click();
        await expect(page.locator(".host-browser-child-bound")).toHaveCount(2);
        await expect(page.getByRole("button", { name: "Select first child" })).toBeVisible();
        await page.getByText("Details", { exact: true }).click();
        await expect(page.getByText("Layout", { exact: true })).toBeVisible();
        await page.locator(".host-browser-selection").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `temp/verification/2026-11-04-session-tools/inspector-${theme}-${width}.png`,
        });
      } finally {
        await f.close();
      }
    });
  }
}

test("rejects transient password insertion and selected node replacement during capture", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  const original = f.target.screenshot.bind(f.target);
  try {
    const state = await f.source.dispatch("browser.status", {}, "fixture-device");
    const scope = {
      projectId: "project-a",
      sessionId: "host-a",
      leaseId: state.leaseId,
      navigationId: state.navigationId,
    };
    const started = await f.source.dispatch("browser.annotation.start", scope, "fixture-device");
    const params = { ...scope, annotationId: started.annotationId, x: 80, y: 105 };
    f.target.screenshot = (async (options) => {
      await f.target.evaluate(() => {
        const input = document.createElement("input");
        input.type = "password";
        input.value = "transient-secret";
        input.id = "transient-fixture";
        document.body.append(input);
      });
      const image = await original(options);
      await f.target.evaluate(() => document.getElementById("transient-fixture")?.remove());
      return image;
    }) as typeof f.target.screenshot;
    await expect(
      f.source.dispatch("browser.annotation.select", params, "fixture-device"),
    ).rejects.toThrow("Page changed");
    f.target.screenshot = (async (options) => {
      await f.target.evaluate(() => {
        const node = document.querySelector("#action")!;
        (window as any).__originalFixtureNode = node;
        const replacement = node.cloneNode(true);
        node.replaceWith(replacement);
      });
      const image = await original(options);
      await f.target.evaluate(() =>
        document.querySelector("#action")!.replaceWith((window as any).__originalFixtureNode),
      );
      return image;
    }) as typeof f.target.screenshot;
    await expect(
      f.source.dispatch("browser.annotation.select", params, "fixture-device"),
    ).rejects.toThrow("Page changed");
  } finally {
    f.target.screenshot = original as typeof f.target.screenshot;
    await f.close();
  }
});

test("inspector hover label at light 800", async ({ page, browser }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const f = await fixture(page, browser);
  try {
    await page.evaluate(() => document.documentElement.classList.add("theme-light"));
    await page
      .getByRole("button", { name: "Select element and add to composer", exact: true })
      .click();
    const bounds = await f.target.locator("#action").boundingBox();
    const target = page.locator("img.host-browser-frame");
    const image = await target.boundingBox();
    await target.hover({
      position: {
        x: ((bounds!.x + bounds!.width / 2) * image!.width) / 1280,
        y: ((bounds!.y + bounds!.height / 2) * image!.height) / 720,
      },
    });
    await expect(page.locator('.host-browser-highlight[data-selected="false"]')).toBeVisible();
    await page.screenshot({
      path: "temp/verification/2026-11-04-session-tools/inspector-hover-light-800.png",
    });
  } finally {
    await f.close();
  }
});

test("Chromium compositionend followed by input sends committed text once", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    const receiver = page.getByLabel("Direct browser input");
    await receiver.evaluate((node: HTMLTextAreaElement) => {
      node.focus();
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      node.value = "İstanbul";
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "İstanbul",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      node.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "İstanbul" }),
      );
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "İstanbul",
          inputType: "insertText",
          isComposing: false,
        }),
      );
    });
    await expect
      .poll(
        () =>
          f.calls.filter(
            (entry) =>
              entry.method === "browser.input" &&
              entry.params.kind === "text" &&
              entry.params.text === "İstanbul",
          ).length,
      )
      .toBe(1);
    await page.waitForTimeout(200);
    expect(
      f.calls.filter(
        (entry) =>
          entry.method === "browser.input" &&
          entry.params.kind === "text" &&
          entry.params.text === "İstanbul",
      ),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("Chromium preview cancels wheel and releases pointer after cancellation", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    const image = page.locator("img.host-browser-frame");
    await expect(
      page.getByRole("button", { name: "Select element and add to composer", exact: true }),
    ).toBeEnabled();
    await image.focus();
    const prevented = await image.evaluate(
      (element) =>
        !element.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 25 }),
        ),
    );
    expect(prevented).toBe(true);
    await expect
      .poll(() =>
        f.calls.some((entry) => entry.method === "browser.input" && entry.params.kind === "scroll"),
      )
      .toBe(true);
    const bounds = await image.boundingBox();
    await page.mouse.move(bounds!.x + 40, bounds!.y + 40);
    await page.mouse.down();
    await expect
      .poll(() =>
        f.calls.some(
          (entry) =>
            entry.method === "browser.input" &&
            entry.params.kind === "pointer" &&
            entry.params.action === "down",
        ),
      )
      .toBe(true);
    await image.dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    });
    await expect
      .poll(() =>
        f.calls.some(
          (entry) =>
            entry.method === "browser.input" &&
            entry.params.kind === "pointer" &&
            entry.params.action === "up",
        ),
      )
      .toBe(true);
    await page.mouse.up();
  } finally {
    await f.close();
  }
});

for (const delay of [0, 80, 150]) {
  test(`controlled browser input and hover baseline ${delay}ms`, async ({ page, browser }) => {
    const f = await fixture(page, browser, "en", delay);
    try {
      const processCpuStart = process.cpuUsage();
      const processMemoryStart = process.memoryUsage();
      const profileStart = performance.now();
      await expect(
        page.getByRole("button", { name: "Select element and add to composer", exact: true }),
      ).toBeEnabled();
      await f.target.locator("textarea").focus();
      const inputTimes: number[] = [];
      await page.evaluate(() => {
        const w = window as any;
        w.__fixtureBlankFrames = 0;
        const check = () => {
          if (!document.querySelector("img.host-browser-frame")) w.__fixtureBlankFrames++;
        };
        new MutationObserver(check).observe(document.querySelector(".host-browser-stage")!, {
          childList: true,
          subtree: true,
        });
      });
      const receiver = page.getByLabel("Direct browser input");
      await receiver.focus();
      for (const letter of "abcdefghijklmnopqrst") {
        const elapsed = await receiver.evaluate(async (node, text) => {
          const image = document.querySelector<HTMLImageElement>("img.host-browser-frame")!;
          const prior = image.src;
          const started = performance.now();
          const loaded = new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => {
              observer.disconnect();
              reject(new Error("Timed out waiting for decoded input frame"));
            }, 10000);
            const observer = new MutationObserver(() => {
              if (image.src === prior) return;
              void image.decode().then(() => {
                clearTimeout(timeout);
                observer.disconnect();
                resolve(performance.now() - started);
              });
            });
            observer.observe(image, { attributes: true, attributeFilter: ["src"] });
          });
          node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
          return loaded;
        }, letter);
        inputTimes.push(elapsed);
      }
      expect(await f.target.locator("textarea").inputValue()).toContain("abcdefghijklmnopqrst");
      expect(await page.evaluate(() => (window as any).__fixtureBlankFrames)).toBe(0);
      const sent = f.calls
        .filter((call) => call.method === "browser.input" && call.params.kind === "text")
        .map((call) => call.params.text);
      expect(sent).toEqual([..."abcdefghijklmnopqrst"]);
      await receiver.evaluate((node) => {
        for (const text of "123456") {
          node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
        }
      });
      await expect
        .poll(async () => await f.target.locator("textarea").inputValue(), { timeout: 15000 })
        .toContain("abcdefghijklmnopqrst123456");
      const allSent = f.calls
        .filter((call) => call.method === "browser.input" && call.params.kind === "text")
        .map((call) => call.params.text);
      expect(allSent).toEqual([..."abcdefghijklmnopqrst123456"]);
      expect(await page.evaluate(() => (window as any).__fixtureBlankFrames)).toBe(0);
      await page
        .getByRole("button", { name: "Select element and add to composer", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Cancel selection", exact: true }),
      ).toBeVisible();
      const image = page.locator("img.host-browser-frame");
      const frameBox = (await image.boundingBox())!;
      const targets = await Promise.all([
        f.target.locator("#action").boundingBox(),
        f.target.locator("#link").boundingBox(),
      ]);
      const hoverTimes: number[] = [];
      for (let index = 0; index < 20; index++) {
        const box = targets[index % 2]!;
        const x = ((box.x + box.width / 2) * frameBox.width) / 1280;
        const y = ((box.y + box.height / 2) * frameBox.height) / 720;
        const label = index % 2 ? "a" : "button";
        const elapsed = await image.evaluate(
          async (element, input) => {
            const bounds = element.getBoundingClientRect();
            const started = performance.now();
            const ready = new Promise<number>((resolve, reject) => {
              const timeout = setTimeout(() => {
                observer.disconnect();
                reject(new Error("Timed out waiting for hover overlay"));
              }, 10000);
              const observer = new MutationObserver(() => {
                const text =
                  document.querySelector(".host-browser-highlight-label")?.textContent ?? "";
                if (!text.startsWith(input.label)) return;
                requestAnimationFrame(() => {
                  clearTimeout(timeout);
                  observer.disconnect();
                  resolve(performance.now() - started);
                });
              });
              observer.observe(document.querySelector(".host-browser-surface")!, {
                childList: true,
                subtree: true,
                characterData: true,
              });
            });
            element.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                clientX: bounds.left + input.x,
                clientY: bounds.top + input.y,
              }),
            );
            return ready;
          },
          { x, y, label },
        );
        hoverTimes.push(elapsed);
      }
      const percentile = (values: number[], q: number) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
      const output = {
        delayMsPerRpc: delay,
        simulated: true,
        samples: inputTimes.length,
        inputToDecodedFrameMs: {
          p50: percentile(inputTimes, 0.5),
          p95: percentile(inputTimes, 0.95),
          values: inputTimes,
        },
        hoverToOverlayMs: {
          p50: percentile(hoverTimes, 0.5),
          p95: percentile(hoverTimes, 0.95),
          values: hoverTimes,
        },
        rpc: Object.fromEntries(
          ["browser.input", "browser.frame", "browser.annotation.hover"].map((method) => {
            const records = f.calls.filter(
              (call) =>
                call.method === method && call.end !== undefined && call.start !== undefined,
            );
            const durations = records.map((call) => call.end! - call.start!);
            return [
              method,
              {
                count: durations.length,
                p50: durations.length ? percentile(durations, 0.5) : null,
                p95: durations.length ? percentile(durations, 0.95) : null,
                maxFrameBytes: Math.max(0, ...records.map((call) => call.bytes ?? 0)),
              },
            ];
          }),
        ),
        fixtureProcess: {
          elapsedMs: performance.now() - profileStart,
          cpuMicros: process.cpuUsage(processCpuStart),
          rssStart: processMemoryStart.rss,
          rssEnd: process.memoryUsage().rss,
          heapStart: processMemoryStart.heapUsed,
          heapEnd: process.memoryUsage().heapUsed,
          frameBytesTotal: f.calls
            .filter((call) => call.method === "browser.frame")
            .reduce((sum, call) => sum + (call.bytes ?? 0), 0),
          frameCount: f.calls.filter(
            (call) => call.method === "browser.frame" && call.bytes !== undefined,
          ).length,
        },
        blankFrames: 0,
        inputCount: allSent.length,
      };
      expect(output.rpc["browser.frame"].maxFrameBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(allSent).toHaveLength(26);
      // Evidence goes to an ignored folder that a fresh checkout does not have yet.
      mkdirSync("temp/verification/2026-11-04-browser-host", { recursive: true });
      writeFileSync(
        `temp/verification/2026-11-04-browser-host/baseline-${delay}.json`,
        JSON.stringify(output, null, 2),
      );
      console.log(`BROWSER_BASELINE ${JSON.stringify(output)}`);
    } catch (error) {
      console.log(
        "BASELINE_METHODS",
        JSON.stringify(
          f.calls
            .slice(-16)
            .map(({ method, failure, end }) => ({ method, failure, completed: end !== undefined })),
        ),
      );
      throw error;
    } finally {
      await f.close();
    }
  });
}

test("failed frame refresh retains visible image and offers recovery", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    const image = page.locator("img.host-browser-frame");
    const before = await image.getAttribute("src");
    const live = page.getByRole("switch", { name: "Live view" });
    if (await live.isChecked()) await live.click();
    f.failNextFrame();
    await page.getByRole("button", { name: "Refresh frame", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Fixture frame unavailable");
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(before);
    await page.screenshot({
      path: "temp/verification/2026-11-04-session-tools/frame-failure-recovery.png",
    });
    await page.getByRole("button", { name: "Refresh frame", exact: true }).click();
    await expect(image).toBeVisible();
  } finally {
    await f.close();
  }
});

test("preview pointer drag selects real target text and preserves ordered pointer events", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    await expect(
      page.getByRole("button", { name: "Select element and add to composer", exact: true }),
    ).toBeEnabled();
    const image = page.locator("img.host-browser-frame");
    const imageBox = (await image.boundingBox())!;
    const textBox = (await f.target.locator("h1").boundingBox())!;
    const point = (x: number, y: number) => ({
      x: imageBox.x + (x * imageBox.width) / 1280,
      y: imageBox.y + (y * imageBox.height) / 720,
    });
    const start = point(textBox.x + 4, textBox.y + textBox.height / 2);
    const finish = point(
      textBox.x + Math.min(textBox.width - 4, 150),
      textBox.y + textBox.height / 2,
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(finish.x, finish.y, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => await f.target.evaluate(() => window.getSelection()?.toString() ?? ""), {
        timeout: 10000,
      })
      .toContain("Fixture");
    await expect
      .poll(
        () =>
          f.calls.some(
            (call) =>
              call.method === "browser.input" &&
              call.params.kind === "pointer" &&
              call.params.action === "up",
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    const pointerCalls = f.calls.filter(
      (call) => call.method === "browser.input" && call.params.kind === "pointer",
    );
    expect(pointerCalls[0]?.params.action).toBe("down");
    expect(pointerCalls.at(-1)?.params.action).toBe("up");
    expect(pointerCalls.some((call) => call.params.action === "move")).toBe(true);
  } finally {
    await f.close();
  }
});

test("preview keyboard Ctrl+A and committed text replace target input", async ({
  page,
  browser,
}) => {
  const f = await fixture(page, browser);
  try {
    await expect(
      page.getByRole("button", { name: "Select element and add to composer", exact: true }),
    ).toBeEnabled();
    const target = f.target.locator("textarea");
    await target.focus();
    const receiver = page.getByLabel("Direct browser input");
    await receiver.focus();
    await receiver.press("Control+a");
    await receiver.evaluate((node: HTMLTextAreaElement) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "Yeni" }));
    });
    await expect.poll(() => target.inputValue(), { timeout: 10000 }).toBe("Yeni");
    await receiver.press("Shift+ArrowLeft");
    await receiver.evaluate((node: HTMLTextAreaElement) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "!" }));
    });
    await expect.poll(() => target.inputValue(), { timeout: 10000 }).toBe("Yen!");
    const keys = f.calls.filter((call) => call.method === "browser.input");
    expect(keys.find((call) => call.params.kind === "key")?.params).toMatchObject({
      key: "A",
      modifiers: ["Control"],
    });
    expect(keys.find((call) => call.params.kind === "text")?.params.text).toBe("Yeni");
  } finally {
    await f.close();
  }
});
