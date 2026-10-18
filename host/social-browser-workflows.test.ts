import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { SocialService } from "./social";
import { SocialTransport } from "./social-transport";
import { SocialBrowserWorkflows } from "./social-browser-workflows";
import { XBrowserSessions, type PlainBrowserLauncher } from "./social-browser";
import {
  SOCIAL_ACCOUNT_TYPES,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../src/features/social/model/social";
import { socialBrowserUrl } from "../src/features/social/model/socialBrowser";
import type { SocialAdapters } from "../src/integrations/social/adapter";

const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(check()).toBe(true);
}
async function fixture(platform: SocialPlatform = "x") {
  const directory = mkdtempSync(join(tmpdir(), "social-workflows-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Fixture");
  const service = new SocialService(
    store,
    { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    {} as SocialAdapters,
    directory,
  );
  const account = (await service.call(owner, "accounts.create", {
    platform,
    name: "Fixture",
    accountType: SOCIAL_ACCOUNT_TYPES[platform][0],
    projectIds: [project.id],
  })) as SocialAccount;
  let now = 1000;
  const windows: { close: ReturnType<typeof vi.fn>; closed: Promise<void> }[] = [];
  const plain = vi.fn<PlainBrowserLauncher>(async () => {
    let resolve!: () => void;
    const closed = new Promise<void>((done) => {
      resolve = done;
    });
    const window = { closed, close: vi.fn(async () => resolve()) };
    windows.push(window);
    return window;
  });
  const manager = new SocialBrowserWorkflows(
    plain,
    (a) => join(directory, a.id),
    async (_id, action) => action(),
    () => now,
    async () => new Promise((resolve) => setTimeout(resolve, 1)),
  );
  cleanups.push(() => {
    manager.stop(service);
    service.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const status = () => manager.status(service, owner, account.id);
  const begin = (intent: "login" | "signup" | "inbox" = "login") =>
    manager.begin(service, owner, { accountId: account.id, intent, acknowledgeRisk: true });
  return {
    directory,
    store,
    service,
    account,
    manager,
    plain,
    windows,
    status,
    begin,
    advance: () => {
      now += 21 * 60_000;
    },
  };
}

describe("owner-assisted social browser workflows", () => {
  it.each(SOCIAL_PLATFORMS)(
    "opens an isolated %s login without granting send authority",
    async (platform) => {
      const f = await fixture(platform);
      const flow = f.begin();
      await until(() => f.status().workflows[0]?.status === "awaiting_owner");
      expect(f.plain).toHaveBeenCalledWith(
        join(f.directory, f.account.id),
        socialBrowserUrl(platform, "login"),
      );
      expect(f.status().workflows[0].outcome).toBe("unverified");
      await f.windows[0].close();
      await until(() => f.status().workflows[0]?.status === "window_closed");
      expect(f.status().workflows[0].id).toBe(flow.id);
      expect(f.service.accountForOAuth(owner, f.account.id).connected).toBe(false);
    },
  );
  it("does not create duplicate windows and requires cancellation before a different intent", async () => {
    const f = await fixture();
    const first = f.begin("signup");
    expect(f.begin("signup").id).toBe(first.id);
    expect(() => f.begin("inbox")).toThrow("Close or cancel");
    await until(() => f.windows.length === 1);
    await f.manager.cancel(f.service, owner, f.account.id);
    await until(() => !f.manager.hasActive(f.account.id));
    expect(f.status().workflows[0].status).toBe("cancelled");
    expect(f.windows[0].close).toHaveBeenCalled();
  });
  it("expires a window without marking registration successful", async () => {
    const f = await fixture();
    f.begin("signup");
    await until(() => f.status().workflows[0]?.status === "awaiting_owner");
    f.advance();
    await until(() => !f.manager.hasActive(f.account.id));
    expect(f.status().workflows[0]).toMatchObject({ status: "expired", outcome: "unverified" });
    expect(f.windows[0].close).toHaveBeenCalled();
  });
  it("marks persisted work interrupted after host restart, never resumes a registration automatically", async () => {
    const f = await fixture();
    f.begin("signup");
    const restarted = new SocialBrowserWorkflows(
      f.plain,
      () => "unused",
      async (_id, action) => action(),
    );
    expect(restarted.status(f.service, owner, f.account.id).workflows[0].status).toBe(
      "interrupted",
    );
    expect(f.plain).toHaveBeenCalledTimes(1);
  });
  it("denies session credentials, wrong executor hosts and missing acknowledgements", async () => {
    const f = await fixture();
    expect(() =>
      f.manager.status(
        f.service,
        { kind: "session", actorId: "session", provider: "codex", projectId: "other" },
        f.account.id,
      ),
    ).toThrow("owner device");
    expect(() =>
      f.manager.begin(f.service, owner, { accountId: f.account.id, intent: "login" }),
    ).toThrow("Acknowledge");
    await f.service.call(owner, "accounts.executor", {
      accountId: f.account.id,
      executorId: "another-host",
    });
    expect(() => f.begin()).toThrow("executor host");
    expect(f.plain).not.toHaveBeenCalled();
  });
  it("does not expose launcher paths, entered data or target URLs through persisted records", async () => {
    const f = await fixture();
    f.manager.begin(f.service, owner, {
      accountId: f.account.id,
      intent: "comments",
      acknowledgeRisk: true,
      targetUrl: "https://x.com/fixture/status/123?secret=synthetic",
    });
    expect(f.plain).toHaveBeenCalledWith(expect.any(String), "https://x.com/fixture/status/123");
    const stored = JSON.stringify(f.status());
    expect(stored).not.toContain("synthetic");
    expect(stored).not.toContain(f.directory);
    expect(stored).not.toContain("https://x.com");
  });
  it("cancels queued work without opening the browser when a profile becomes free", async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new SocialBrowserWorkflows(
      f.plain,
      () => "profile",
      async (_id, action) => {
        await held;
        return action();
      },
    );
    manager.begin(f.service, owner, {
      accountId: f.account.id,
      intent: "login",
      acknowledgeRisk: true,
    });
    await manager.cancel(f.service, owner, f.account.id);
    release();
    await until(() => !manager.hasActive(f.account.id));
    expect(f.plain).not.toHaveBeenCalled();
  });
  it("exposes owner RPC and prevents the X verifier from opening the same profile", async () => {
    const f = await fixture();
    const browser = new XBrowserSessions(
      f.directory,
      undefined,
      Date.now,
      undefined,
      true,
      f.plain,
    );
    const transport = new SocialTransport(f.service, browser);
    f.service.cancelBrowserWorkflow = (id) => browser.workflows.cancelAccount(f.service, id);
    await transport.rpc(owner, "social.browser.workflow.begin", {
      accountId: f.account.id,
      intent: "signup",
      acknowledgeRisk: true,
    });
    expect(() => browser.begin(f.service, owner, f.account.id, true)).toThrow("browser workflow");
    await until(() => f.windows.length === 1);
    await f.service.call(owner, "accounts.disconnect", { accountId: f.account.id });
    await until(() => !browser.workflows.hasActive(f.account.id));
    expect(
      await transport.rpc(owner, "social.browser.workflow.status", { accountId: f.account.id }),
    ).toMatchObject({ workflows: [expect.objectContaining({ status: "cancelled" })] });
    browser.workflows.stop(f.service);
  });
});

describe("browser route boundaries", () => {
  it.each([
    "http://x.com/fixture/status/1",
    "https://x.com.evil.test/fixture/status/1",
    "https://name:secret@x.com/fixture/status/1",
    "https://x.com:444/fixture/status/1",
    "file:///tmp/page",
    "https://x.com/settings",
    "https://x.com/i/flow/signup",
  ])("rejects arbitrary navigation: %s", (url) => {
    expect(() => socialBrowserUrl("x", "comments", url)).toThrow();
  });
  it("retains YouTube's video identifier, removes other query material and refuses non-video watch links", () => {
    expect(
      socialBrowserUrl(
        "youtube",
        "comments",
        "https://www.youtube.com/watch?v=abcdefghijk&auth=synthetic#secret",
      ),
    ).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(() =>
      socialBrowserUrl("youtube", "comments", "https://www.youtube.com/watch?v=bad"),
    ).toThrow();
    expect(() => socialBrowserUrl("youtube", "inbox")).toThrow("unavailable");
    expect(() => socialBrowserUrl("whatsapp", "signup")).toThrow("mobile app");
  });
});
