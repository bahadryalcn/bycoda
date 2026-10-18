import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { SharedBrowser, sharedBrowserUrl, type BrowserLoader } from "./shared-browser";
import { RuntimeLogsService } from "./runtime-logs";

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

it("scopes agent browser frames to their session and a current control lease", async () => {
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
  await expect(
    browser.dispatchForSession("browser.frame", { ...context, leaseId: claim.leaseId }, "agent"),
  ).resolves.toHaveProperty("data");
  now += 31000;
  await expect(
    browser.dispatchForSession("browser.frame", { ...context, leaseId: claim.leaseId }, "agent"),
  ).rejects.toThrow("Claim");
  await browser.close();
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
  const arg = { user: "Alice", token: "object-secret", large: "x".repeat(40_000) };
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
    details: [{ user: "Alice", token: "[REDACTED]" }],
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
        jsonValue: () =>
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
