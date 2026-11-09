import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  SharedBrowser,
  SessionBrowserRegistry,
  sharedBrowserUrl,
  type BrowserLoader,
} from "./shared-browser";
import { RuntimeLogsService } from "../execution/runtime-logs";

it("resizes the owned session to390px, reports real frame dimensions and bounds pointer input", async () => {
  const page = {
    goto: vi.fn(),
    url: () => "http://localhost:3000/",
    setViewportSize: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("mobile-frame")),
    mouse: { click: vi.fn(), wheel: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
  };
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: vi.fn(),
      }),
    },
  });
  const browser = new SharedBrowser(loader);
  try {
    const context = { projectId: "project", sessionId: "session" };
    const claim = await browser.dispatchForSession("browser.claim", context, "agent");
    const params = { ...context, leaseId: claim.leaseId };
    await browser.dispatchForSession("browser.open", { ...params, url: page.url() }, "agent");
    const original = await browser.dispatchForSession("browser.status", context, "agent");
    const resized = await browser.dispatchForSession(
      "browser.resize",
      { ...params, width: 390, height: 844 },
      "agent",
    );
    expect(resized.viewport).toEqual({ width: 390, height: 844 });
    expect(resized.navigationId).not.toBe(original.navigationId);
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 });
    expect(await browser.dispatchForSession("browser.frame", params, "agent")).toMatchObject({
      width: 390,
      height: 844,
    });
    await browser.dispatchForSession(
      "browser.input",
      { ...params, kind: "click", x: 389, y: 843 },
      "agent",
    );
    expect(page.mouse.click).toHaveBeenCalledWith(389, 843);
    await expect(
      browser.dispatchForSession(
        "browser.input",
        { ...params, kind: "click", x: 390, y: 844 },
        "agent",
      ),
    ).rejects.toThrow("position");
    await expect(
      browser.dispatchForSession(
        "browser.resize",
        { ...params, sessionId: "other", width: 390, height: 844 },
        "agent",
      ),
    ).rejects.toThrow("this session");
    await expect(
      browser.dispatchForSession("browser.resize", { ...params, width: 0, height: 844 }, "agent"),
    ).rejects.toThrow("dimensions");
    await expect(
      browser.dispatchForSession(
        "browser.resize",
        { ...params, width: 390.5, height: 844 },
        "agent",
      ),
    ).rejects.toThrow("dimensions");
  } finally {
    await browser.close();
  }
  expect((await browser.dispatch("browser.status", {}, "agent")).viewport).toEqual({
    width: 1280,
    height: 720,
  });
});

it("lets the owner explicitly take over control with a fresh lease and rejects the old controller", async () => {
  const browser = new SharedBrowser(undefined, () => 1000);
  const agent = await browser.dispatchForSession("browser.claim", {}, "agent");
  const owner = await browser.dispatch("browser.claim", {}, "desktop", { takeover: true });
  expect(owner.controlling).toBe(true);
  expect(owner.leaseId).not.toBe(agent.leaseId);
  await expect(
    browser.dispatch("browser.release", { leaseId: agent.leaseId }, "agent"),
  ).rejects.toThrow("Claim");
  await expect(
    browser.dispatchForSession("browser.claim", { takeover: true }, "agent"),
  ).rejects.toThrow("Another");
  expect(await browser.dispatch("browser.status", {}, "desktop")).toMatchObject({
    controlling: true,
    leaseId: owner.leaseId,
  });
});

it("does not grant takeover through untrusted browser parameters", async () => {
  const browser = new SharedBrowser(undefined, () => 1000);
  await browser.dispatch("browser.claim", {}, "owner");
  await expect(browser.dispatch("browser.claim", { takeover: true }, "other")).rejects.toThrow(
    "Another",
  );
});

it("loads lazily, enforces device control leases and rejects unsupported URLs/inputs", async () => {
  let now = 1_000;
  const page = {
    goto: vi.fn(),
    url: () => "http://localhost:3000/",
    screenshot: vi.fn(async () => Buffer.from("frame")),
    mouse: { click: vi.fn(), wheel: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
  };
  const close = vi.fn();
  const loader: BrowserLoader = vi.fn(async () => ({
    chromium: {
      launch: async () => ({ newContext: async () => ({ newPage: async () => page }), close }),
    },
  }));
  const browser = new SharedBrowser(loader, () => now);
  await browser.dispatch("browser.status", {}, "a");
  expect(loader).not.toHaveBeenCalled();
  const claim = await browser.dispatch("browser.claim", {}, "a");
  await expect(browser.dispatch("browser.claim", {}, "b")).rejects.toThrow("Another client");
  await expect(
    browser.dispatch("browser.open", { url: "http://localhost:3000", leaseId: claim.leaseId }, "b"),
  ).rejects.toThrow("Claim");
  await browser.dispatch(
    "browser.open",
    { url: "http://localhost:3000", leaseId: claim.leaseId },
    "a",
  );
  expect(loader).toHaveBeenCalledTimes(1);
  const shared = await browser.dispatch("browser.frame", {}, "b");
  expect(shared.leaseId).toBeUndefined();
  expect(shared.data).toBe(Buffer.from("frame").toString("base64"));
  await expect(
    browser.dispatch("browser.input", { leaseId: claim.leaseId, kind: "click", x: -1, y: 2 }, "a"),
  ).rejects.toThrow("position");
  now += 31_000;
  const other = await browser.dispatch("browser.claim", {}, "b");
  expect(other.controlling).toBe(true);
  browser.revoke("b");
  await expect(
    browser.dispatch("browser.input", { leaseId: other.leaseId, kind: "text", text: "x" }, "b"),
  ).rejects.toThrow("Claim");
  await browser.close();
  expect(close).toHaveBeenCalledOnce();
});
it("restricts URL protocol and rejects embedded credentials", () => {
  expect(() => sharedBrowserUrl("file:///etc/passwd")).toThrow();
  expect(() => sharedBrowserUrl("https://user:secret@host.example")).toThrow();
  expect(sharedBrowserUrl("http://localhost:3000")).toBe("http://localhost:3000/");
});

it("reads only the agent's session without acquiring or renewing browser control", async () => {
  let now = 1000;
  const page = {
    goto: vi.fn(),
    url: () => "http://localhost:3000",
    screenshot: vi.fn(async () => Buffer.from("frame")),
    mouse: { click: vi.fn(), wheel: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
  };
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: vi.fn(),
      }),
    },
  });
  const browser = new SharedBrowser(loader, () => now);
  const context = { projectId: "p", sessionId: "s" };
  const claim = await browser.dispatchForSession("browser.claim", context, "agent");
  await browser.dispatchForSession(
    "browser.open",
    { ...context, leaseId: claim.leaseId, url: "http://localhost:3000" },
    "agent",
  );
  await expect(
    browser.dispatchForSession(
      "browser.frame",
      { ...context, sessionId: "other", leaseId: claim.leaseId },
      "agent",
    ),
  ).rejects.toThrow("this session");
  try {
    now += 10_000;
    expect(await browser.dispatchForSession("browser.frame", context, "agent")).toMatchObject({
      data: Buffer.from("frame").toString("base64"),
      leaseExpiresAt: claim.leaseExpiresAt,
    });
    now = claim.leaseExpiresAt!;
    const expired = await browser.dispatchForSession("browser.frame", context, "agent");
    expect(expired).toMatchObject({ controlling: false });
    expect(expired.leaseId).toBeUndefined();
    await browser.dispatchForSession("browser.status", context, "agent");
    await expect(
      browser.dispatchForSession("browser.frame", context, "agent"),
    ).resolves.toHaveProperty("data");
    for (const [method, input] of [
      ["browser.input", { kind: "click", x: 1, y: 1 }],
      ["browser.resize", { width: 800, height: 600 }],
      ["browser.close", {}],
      ["browser.annotation.start", {}],
    ] as const) {
      await expect(
        browser.dispatchForSession(
          method,
          { ...context, ...input, leaseId: claim.leaseId },
          "agent",
        ),
      ).rejects.toThrow("Claim");
    }
    const owner = await browser.dispatch("browser.claim", context, "desktop");
    const observed = await browser.dispatchForSession(
      "browser.frame",
      { ...context, leaseId: claim.leaseId },
      "agent",
    );
    expect(observed.controlling).toBe(false);
    expect(observed.leaseId).toBeUndefined();
    expect(await browser.dispatch("browser.status", context, "desktop")).toMatchObject(owner);
    await expect(
      browser.dispatchForSession(
        "browser.input",
        {
          ...context,
          leaseId: claim.leaseId,
          kind: "click",
          x: 1,
          y: 1,
        },
        "agent",
      ),
    ).rejects.toThrow("Claim");
    for (const scope of [
      { ...context, projectId: "other" },
      { ...context, threadId: "other" },
    ])
      await expect(browser.dispatchForSession("browser.frame", scope, "agent")).rejects.toThrow(
        "this session",
      );
    await browser.dispatch("browser.release", { ...context, leaseId: owner.leaseId }, "desktop");
    await expect(
      browser.dispatchForSession("browser.frame", context, "agent"),
    ).resolves.toHaveProperty("data");
  } finally {
    await browser.close();
  }
});

function logsFixture() {
  const logs = new RuntimeLogsService();
  const pages: (EventEmitter & { goto: ReturnType<typeof vi.fn>; url(): string })[] = [];
  const close = vi.fn(async () => {});
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => ({
        close,
        newContext: async () => ({
          newPage: async () => {
            let currentUrl = "about:blank";
            const page = Object.assign(new EventEmitter(), {
              goto: vi.fn(async (url: string) => {
                currentUrl = url;
              }),
              url: () => currentUrl,
              screenshot: vi.fn(async () => Buffer.from("frame")),
              mouse: { click: vi.fn(), wheel: vi.fn() },
              keyboard: { type: vi.fn(), press: vi.fn() },
            });
            pages.push(page);
            return page;
          },
        }),
      }),
    },
  });
  const browser = new SharedBrowser(loader, () => 1000, { runtimeLogs: logs });
  return { logs, pages, browser, close };
}

it("bounds property inspection for large console objects before host transfer", async () => {
  const { logs, pages, browser } = logsFixture();
  const claim = await browser.dispatch("browser.claim", {}, "owner");
  await browser.dispatch(
    "browser.open",
    { leaseId: claim.leaseId, url: "https://app.test", projectId: "project" },
    "owner",
  );
  const input: Record<string, unknown> = {};
  for (let i = 0; i < 500_000; i++) input[`field${i}`] = i;
  input.status = 503;
  let inspected = 0;
  const proxy = new Proxy(input, {
    ownKeys() {
      throw new Error("must not enumerate console objects");
    },
    getOwnPropertyDescriptor(target, key) {
      inspected++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  let captured: unknown;
  pages[0].emit("console", {
    text: () => "large diagnostic",
    type: () => "log",
    args: () => [
      {
        evaluate: async (callback: (value: unknown) => unknown) => {
          captured = callback(proxy);
          return captured;
        },
      },
    ],
  });
  await vi.waitFor(() => expect(logs.read().entries).toHaveLength(1));
  expect(captured).toMatchObject({
    status: 503,
    $capture: expect.stringContaining("other properties omitted"),
  });
  expect(inspected).toBeLessThan(50);
  await browser.close();
});

it("captures console objects, stack traces and network failures with bounded redacted values", async () => {
  const { logs, pages, browser } = logsFixture();
  const claim = await browser.dispatch("browser.claim", {}, "owner");
  await browser.dispatch(
    "browser.open",
    {
      leaseId: claim.leaseId,
      url: "https://app.test/?token=url-secret",
      projectId: "project",
      sessionId: "session",
    },
    "owner",
  );
  const page = pages[0];
  const arg = { message: "ready", token: "object-secret", large: "x".repeat(40_000) };
  page.emit("console", {
    text: () => "ready token=text-secret",
    type: () => "log",
    location: () => ({ url: "https://app.test/src/app.ts", lineNumber: 4, columnNumber: 2 }),
    args: () => [
      {
        jsonValue: async () => arg,
        evaluate: async (callback: (value: unknown) => unknown) => callback(arg),
      },
    ],
  });
  const error = new Error("page failed password=error-secret");
  error.stack = "Error: page failed\n    at render (https://app.test/view.ts:12:7)";
  page.emit("pageerror", error);
  page.emit("requestfailed", {
    url: () => "https://app.test/api?access_token=request-secret",
    method: () => "POST",
    failure: () => ({ errorText: "net::ERR_CONNECTION_REFUSED" }),
  });
  page.emit("requestfailed", {
    url: () => "https://app.test/old",
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
  });
  page.emit("response", {
    url: () => "https://app.test/api",
    status: () => 500,
    statusText: () => "Server Error",
  });
  page.emit("response", { url: () => "https://app.test/okay", status: () => 200 });
  await vi.waitFor(() => expect(logs.read().entries).toHaveLength(5));
  const snapshot = logs.read({ projectId: "project", sessionId: "session" });
  expect(
    snapshot.entries.every((entry) => entry.source === "browser" && entry.timestamp === 1000),
  ).toBe(true);
  expect(snapshot.entries.find((entry) => entry.message.startsWith("ready"))).toMatchObject({
    level: "info",
    location: { file: "https://app.test/src/app.ts", line: 5, column: 3 },
    details: [{ message: "ready", token: "[REDACTED]" }],
  });
  expect(snapshot.entries.find((entry) => entry.stack)).toMatchObject({
    level: "error",
    location: { file: "https://app.test/view.ts", line: 12, column: 7 },
  });
  expect(snapshot.entries.find((entry) => entry.message.includes("ERR_ABORTED"))?.level).toBe(
    "info",
  );
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    "url-secret",
    "object-secret",
    "text-secret",
    "error-secret",
    "request-secret",
  ])
    expect(serialized).not.toContain(secret);
  expect(serialized.length).toBeLessThan(15_000);
  await browser.close();
  expect(logs.sources()[0].available).toBe(false);
  expect(page.eventNames()).toEqual([]);
});

it("fences late events and pending console values when a new conversation opens or the browser closes", async () => {
  const { logs, pages, browser, close } = logsFixture();
  const claim = await browser.dispatch("browser.claim", {}, "owner");
  const open = (projectId: string, sessionId: string) =>
    browser.dispatch(
      "browser.open",
      { leaseId: claim.leaseId, url: "https://app.test", projectId, sessionId },
      "owner",
    );
  await open("a", "one");
  const oldPage = pages[0];
  const staleErrorHandler = oldPage.listeners("pageerror")[0];
  let finishArgument!: (value: unknown) => void;
  oldPage.emit("console", {
    text: () => "old deferred",
    type: () => "log",
    args: () => [
      {
        evaluate: () =>
          new Promise((resolve) => {
            finishArgument = resolve;
          }),
      },
    ],
  });
  await open("b", "two");
  expect(close).toHaveBeenCalledTimes(1);
  expect(oldPage.eventNames()).toEqual([]);
  oldPage.emit("pageerror", new Error("old emitted"));
  staleErrorHandler(new Error("old queued"));
  finishArgument({ value: "old resolved" });
  await Promise.resolve();
  const newPage = pages[1];
  newPage.emit("console", { text: () => "current", type: () => "log" });
  expect(logs.read({ projectId: "a" }).entries).toEqual([]);
  expect(
    logs.read({ projectId: "b", sessionId: "two" }).entries.map((entry) => entry.message),
  ).toEqual(["current"]);
  const closedErrorHandler = newPage.listeners("pageerror")[0];
  await browser.close();
  closedErrorHandler(new Error("after close"));
  await Promise.resolve();
  expect(logs.read().entries.map((entry) => entry.message)).toEqual(["current"]);
});

it("closes a page created after host shutdown rather than resurrecting the browser", async () => {
  let finishPage!: (value: unknown) => void;
  const close = vi.fn(async () => {});
  const loader = (async () => ({
    chromium: {
      launch: async () => ({
        close,
        newContext: async () => ({
          newPage: () =>
            new Promise((resolve) => {
              finishPage = resolve;
            }),
        }),
      }),
    },
  })) as BrowserLoader;
  const browser = new SharedBrowser(loader);
  const claim = await browser.dispatch("browser.claim", {}, "owner");
  const opening = browser.dispatch(
    "browser.open",
    { leaseId: claim.leaseId, url: "https://app.test" },
    "owner",
  );
  await vi.waitFor(() => expect(finishPage).toBeTypeOf("function"));
  await browser.close();
  finishPage({ goto: vi.fn() });
  await expect(opening).rejects.toThrow("closed during startup");
  expect(close).toHaveBeenCalledTimes(1);
  expect(await browser.dispatch("browser.status", {}, "owner")).toMatchObject({ open: false });
});

it("isolates scoped browser pages and keeps document identity through input", async () => {
  let count = 0;
  let launches = 0;
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => {
        launches++;
        return {
          newContext: async () => {
            const id = ++count;
            return {
              newPage: async () => ({
                goto: async () => {},
                url: () => `https://example.com/${id}`,
                screenshot: async () => Buffer.from(`frame-${id}`),
                mouse: { click: async () => {}, wheel: async () => {} },
                keyboard: { type: async () => {}, press: async () => {} },
              }),
            };
          },
          close: async () => {},
        };
      },
    },
  });
  const registry = new SessionBrowserRegistry(loader);
  try {
    const a = { projectId: "p", sessionId: "a" };
    const b = { projectId: "p", sessionId: "b" };
    const claimA = await registry.dispatch("browser.claim", a, "owner");
    const claimB = await registry.dispatch("browser.claim", b, "owner");
    const pa = { ...a, leaseId: claimA.leaseId };
    const pb = { ...b, leaseId: claimB.leaseId };
    await registry.dispatch("browser.open", { ...pa, url: "https://example.com/a" }, "owner");
    await registry.dispatch("browser.open", { ...pb, url: "https://example.com/b" }, "owner");
    const before = await registry.dispatch("browser.frame", pa, "owner");
    await registry.dispatch("browser.input", { ...pa, kind: "click", x: 1, y: 1 }, "owner");
    const after = await registry.dispatch("browser.frame", pa, "owner");
    expect(launches).toBe(1);
    expect(before.data).not.toBe((await registry.dispatch("browser.frame", pb, "owner")).data);
    expect(after.documentId).toBe(before.documentId);
    expect(after.navigationId).not.toBe(before.navigationId);
    await registry.dispatch("browser.release", pa, "owner");
    const observedA = await registry.dispatchForSession("browser.frame", a, "agent");
    const observedB = await registry.dispatchForSession("browser.frame", b, "agent");
    expect(observedA.data).toBe(before.data);
    expect(observedB.data).not.toBe(observedA.data);
    await expect(
      registry.dispatchForSession("browser.frame", { ...a, projectId: "other" }, "agent"),
    ).rejects.toThrow("this session");
    await expect(registry.dispatch("browser.status", { sessionId: "a" }, "owner")).rejects.toThrow(
      "validated project",
    );
  } finally {
    await registry.close();
  }
});

it("deduplicates acknowledged input and rejects stale document coordinates", async () => {
  const click = vi.fn(async () => {});
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => {},
            url: () => "https://example.com/",
            screenshot: async () => Buffer.from("frame"),
            mouse: { click, wheel: async () => {} },
            keyboard: { type: async () => {}, press: async () => {} },
          }),
        }),
        close: async () => {},
      }),
    },
  });
  const browser = new SharedBrowser(loader);
  try {
    const claim = await browser.dispatch("browser.claim", {}, "owner");
    const opened = await browser.dispatch(
      "browser.open",
      { leaseId: claim.leaseId, url: "https://example.com/" },
      "owner",
    );
    const input = {
      leaseId: claim.leaseId,
      kind: "click",
      x: 1,
      y: 1,
      documentId: opened.documentId,
      requestId: "one",
    };
    await browser.dispatch("browser.input", input, "owner");
    await browser.dispatch("browser.input", input, "owner");
    expect(click).toHaveBeenCalledTimes(1);
    await expect(browser.dispatch("browser.input", { ...input, x: 2 }, "owner")).rejects.toThrow(
      "reused",
    );
    await expect(
      browser.dispatch(
        "browser.input",
        { ...input, requestId: "two", documentId: "stale" },
        "owner",
      ),
    ).rejects.toThrow("document changed");
  } finally {
    await browser.close();
  }
});

it("isolates paired-owner presentation namespaces from native session browsers", async () => {
  const loader: BrowserLoader = async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => {},
            url: () => "https://example.com",
            screenshot: async () => Buffer.from("frame"),
            mouse: { click: async () => {}, wheel: async () => {} },
            keyboard: { type: async () => {}, press: async () => {} },
          }),
        }),
        close: async () => {},
      }),
    },
  });
  const registry = new SessionBrowserRegistry(loader);
  try {
    const scope = { ownerPresentationScope: "origin", projectId: "p", sessionId: "s" };
    const claim = await registry.dispatch("browser.claim", scope, "owner-a");
    await registry.dispatch(
      "browser.open",
      { ...scope, leaseId: claim.leaseId, url: "https://example.com" },
      "owner-a",
    );
    expect((await registry.dispatch("browser.status", scope, "owner-b")).open).toBe(false);
    expect(
      (await registry.dispatch("browser.status", { projectId: "p", sessionId: "s" }, "owner-a"))
        .open,
    ).toBe(false);
    await expect(registry.dispatchForSession("browser.status", scope, "agent")).rejects.toThrow(
      "unavailable to agents",
    );
  } finally {
    await registry.close();
  }
});
