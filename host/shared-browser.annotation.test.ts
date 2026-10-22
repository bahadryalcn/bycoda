import { expect, it, vi } from "vitest";
import { SharedBrowser, type BrowserLoader } from "./shared-browser";
import type { ElementInspection } from "./browser-annotation";

const inspection: ElementInspection = {
  pageUrl: "https://example.test/",
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
  devicePixelRatio: 1,
  masks: ["input", "iframe"],
  element: {
    tag: "button",
    text: "Save",
    selector: "html > body > button",
    path: "html > body > button",
    ancestry: [{ tag: "body", selectorPart: "body" }],
    computedStyle: { color: "rgb(0, 0, 0)" },
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
  },
};
async function fixture(sessionScoped = false) {
  let now = 1000;
  let navigation = (_frame: { parentFrame(): unknown }) => {};
  const page = {
    goto: vi.fn(),
    url: () => "https://example.test/",
    evaluate: vi.fn(async () => structuredClone(inspection)),
    locator: vi.fn((selector: string) => selector),
    screenshot: vi.fn(async () => Buffer.from("safe-frame")),
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({ root: { nodeType: 9 } }),
        detach: vi.fn(),
      }),
    }),
    mouse: { click: vi.fn(), wheel: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
    on: vi.fn((_event: string, handler: typeof navigation) => {
      navigation = handler;
    }),
  };
  const browser = new SharedBrowser(
    (async () => ({
      chromium: {
        launch: async () => ({
          newContext: async () => ({ newPage: async () => page }),
          close: vi.fn(),
        }),
      },
    })) as BrowserLoader,
    () => now,
  );
  const dispatch = sessionScoped
    ? browser.dispatchForSession.bind(browser)
    : browser.dispatch.bind(browser);
  const context = sessionScoped ? { projectId: "project-a", sessionId: "session-a" } : {};
  const claim = await dispatch("browser.claim", context, "owner");
  const opened = await dispatch(
    "browser.open",
    { ...context, leaseId: claim.leaseId, url: "https://example.test" },
    "owner",
  );
  const scope = {
    projectId: "project-a",
    sessionId: "session-a",
    leaseId: claim.leaseId,
    navigationId: opened.navigationId,
  };
  const start = await dispatch("browser.annotation.start", scope, "owner");
  const params = { ...scope, annotationId: start.annotationId, x: 50, y: 35 };
  return {
    browser,
    page,
    params,
    navigate: () => navigation({ parentFrame: () => null }),
    expire: () => {
      now += 31_000;
    },
  };
}

it("selects without dispatching page input and binds the masked snapshot to its scope", async () => {
  const { browser, page, params } = await fixture();
  try {
    const result = await browser.dispatch("browser.annotation.select", params, "owner");
    expect(result.selection).toMatchObject({
      sessionId: "session-a",
      projectId: "project-a",
      navigationId: params.navigationId,
      trust: "untrusted-page-data",
      element: inspection.element,
    });
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(page.keyboard.press).not.toHaveBeenCalled();
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ mask: ["input", "iframe"] }),
    );
    await expect(
      browser.dispatch("browser.input", { ...params, kind: "click" }, "owner"),
    ).rejects.toThrow("Cancel element selection");
    for (const changes of [
      { sessionId: "session-b" },
      { projectId: "project-b" },
      { annotationId: "stale" },
      { navigationId: "stale" },
    ])
      await expect(
        browser.dispatch("browser.annotation.read", { ...params, ...changes }, "owner"),
      ).rejects.toThrow("expired");
    const read = await browser.dispatch("browser.annotation.read", params, "owner");
    expect(read.selection).toEqual(result.selection);
  } finally {
    await browser.close();
  }
});

it("keeps every conversation annotation action in its source session and current lease", async () => {
  const f = await fixture(true);
  try {
    for (const name of ["start", "hover", "select", "read", "clear", "cancel"]) {
      const action = `browser.annotation.${name}`;
      for (const changes of [{ projectId: "foreign" }, { sessionId: "foreign" }])
        await expect(
          f.browser.dispatchForSession(action, { ...f.params, ...changes }, "owner"),
        ).rejects.toThrow("this session");
      await expect(
        f.browser.dispatchForSession(action, { ...f.params, leaseId: "foreign" }, "owner"),
      ).rejects.toThrow("Claim");
    }
    expect(f.page.evaluate).not.toHaveBeenCalled();
    const selected = await f.browser.dispatchForSession(
      "browser.annotation.select",
      f.params,
      "owner",
    );
    expect(selected.selection).toMatchObject({ sessionId: "session-a", projectId: "project-a" });
    expect(f.page.mouse.click).not.toHaveBeenCalled();
    await f.browser.dispatchForSession("browser.annotation.read", f.params, "owner");
    f.expire();
    await expect(
      f.browser.dispatchForSession("browser.annotation.read", f.params, "owner"),
    ).rejects.toThrow("Claim");
  } finally {
    await f.browser.close();
  }
});

it("supports the conversation selection lifecycle without dispatching page input", async () => {
  const f = await fixture(true);
  try {
    const hover = await f.browser.dispatchForSession("browser.annotation.hover", f.params, "owner");
    expect(hover.hover).toEqual(inspection.element);
    await f.browser.dispatchForSession("browser.annotation.select", f.params, "owner");
    await f.browser.dispatchForSession("browser.annotation.clear", f.params, "owner");
    await expect(
      f.browser.dispatchForSession("browser.annotation.read", f.params, "owner"),
    ).rejects.toThrow("Select an element");
    await f.browser.dispatchForSession("browser.annotation.select", f.params, "owner");
    await f.browser.dispatchForSession("browser.annotation.cancel", f.params, "owner");
    await expect(
      f.browser.dispatchForSession("browser.annotation.read", f.params, "owner"),
    ).rejects.toThrow("expired");
    expect(f.page.mouse.click).not.toHaveBeenCalled();
    expect(f.page.keyboard.press).not.toHaveBeenCalled();
  } finally {
    await f.browser.close();
  }
});

for (const invalidation of ["navigation", "expiry", "revoke", "cancel", "clear"] as const) {
  it(`invalidates a selected element after ${invalidation}`, async () => {
    const f = await fixture();
    try {
      await f.browser.dispatch("browser.annotation.select", f.params, "owner");
      if (invalidation === "navigation") f.navigate();
      if (invalidation === "expiry") f.expire();
      if (invalidation === "revoke") f.browser.revoke("owner");
      if (invalidation === "cancel" || invalidation === "clear")
        await f.browser.dispatch(`browser.annotation.${invalidation}`, f.params, "owner");
      await expect(
        f.browser.dispatch("browser.annotation.read", f.params, "owner"),
      ).rejects.toThrow();
    } finally {
      await f.browser.close();
    }
  });
}

it("rejects changed DOM and revocation while a screenshot is in flight", async () => {
  const f = await fixture();
  try {
    f.page.evaluate
      .mockResolvedValueOnce(structuredClone(inspection))
      .mockResolvedValueOnce({ ...inspection, viewport: { ...inspection.viewport, scrollY: 500 } });
    await expect(
      f.browser.dispatch("browser.annotation.select", f.params, "owner"),
    ).rejects.toThrow("Page changed");
    let finish!: (data: Buffer) => void;
    f.page.screenshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const selection = f.browser.dispatch("browser.annotation.select", f.params, "owner");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.browser.revoke("owner");
    finish(Buffer.from("frame"));
    await expect(selection).rejects.toThrow("expired");
  } finally {
    await f.browser.close();
  }
});

it("reports inaccessible targets without creating a selection", async () => {
  const f = await fixture();
  try {
    f.page.evaluate.mockResolvedValueOnce({
      ...inspection,
      element: undefined,
      limitation: "Iframe content cannot be inspected",
    });
    const result = await f.browser.dispatch("browser.annotation.select", f.params, "owner");
    expect(result.limitation).toContain("Iframe");
    expect(result.selection).toBeUndefined();
    expect(f.page.screenshot).not.toHaveBeenCalled();
  } finally {
    await f.browser.close();
  }
});
