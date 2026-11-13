import { expect, it, vi } from "vitest";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { SocialService } from "./social";
import { XBrowserSessions } from "./social-browser-x";
import type { ExistingChromeBindings } from "./browser/existing-chrome-bindings";

function pendingChrome() {
  const account = {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "x",
    platformId: "42",
    connection: "browser",
    accountType: "member",
    executorId: "host",
  } as SocialAccount;
  let resume!: () => void;
  let entered!: () => void;
  const navigating = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const close = vi.fn(async () => {});
  const chrome = {
    openSelection: vi.fn(async () => ({
      close,
      page: {
        goto: vi.fn(async () => {
          entered();
          await pending;
        }),
        cookies: vi.fn(async () => [
          { name: "twid", value: "u=42" },
          { name: "auth_token", value: "private" },
        ]),
        evaluate: vi.fn(async (expression: string) =>
          expression.includes("AppTabBar_Profile_Link") ? "/owner" : undefined,
        ),
      },
    })),
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const service = {
    store: { environmentId: "host" },
    accountForOAuth: vi.fn(async () => ({ ...account })),
    connectionReviewEpoch: vi.fn(async () => "original"),
    connectAccount: vi.fn(async () => account),
  };
  const manager = new XBrowserSessions(
    "unused",
    vi.fn(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    chrome as unknown as ExistingChromeBindings,
  );
  const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
  const begin = () =>
    manager.begin(service as unknown as SocialService, owner, account.id, true, undefined, {
      targetId: "selected",
      acknowledgeAccess: true,
    });
  return {
    account,
    close,
    chrome,
    service,
    manager,
    owner,
    begin,
    navigating,
    resume: () => resume(),
  };
}

it.each(["cancel", "stop"])(
  "invalidates an attachment on %s while navigation is pending",
  async (action) => {
    const f = pendingChrome();
    const run = f.begin();
    const rejected = expect(run).rejects.toThrow("cancelled");
    await f.navigating;
    if (action === "cancel")
      await f.manager.cancelLogin(f.service as unknown as SocialService, f.owner, f.account.id);
    else await f.manager.stop(f.service as unknown as SocialService);
    f.resume();
    await rejected;
    expect(f.service.connectAccount).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  },
);

it("rechecks queued executor ownership before opening local Chrome", async () => {
  const f = pendingChrome();
  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  (f.manager as unknown as { locks: Map<string, Promise<unknown>> }).locks.set(f.account.id, lock);
  const run = f.begin();
  const rejected = expect(run).rejects.toThrow("account changed");
  await vi.waitFor(() => expect(f.service.connectionReviewEpoch).toHaveBeenCalled());
  f.account.executorId = "other-host";
  release();
  await rejected;
  expect(f.chrome.openSelection).not.toHaveBeenCalled();
});

it("routes saved-session checks through Chrome without launching or closing the owner's browser", async () => {
  const account = {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "x",
    platformId: "42",
    connected: true,
    connection: "browser",
    executorId: "host",
  } as SocialAccount;
  const close = vi.fn(async () => {});
  const page = {
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
    cookies: vi.fn(async () => [
      { name: "auth_token", value: "private" },
      { name: "twid", value: "u=42" },
    ]),
  };
  const chrome = {
    get: vi.fn(async () => ({ platform: "x", targetId: "selected" })),
    open: vi.fn(async () => ({ page, close, closed: new Promise<void>(() => {}) })),
    stop: vi.fn(async () => {}),
  } as unknown as ExistingChromeBindings;
  const launcher = vi.fn();
  const manager = new XBrowserSessions(
    "unused",
    launcher,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    chrome,
  );
  const service = {
    store: { environmentId: "host" },
    accountForOAuth: vi.fn(async () => account),
  } as unknown as SocialService;
  const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
  expect(await manager.status(service, owner, account.id)).toMatchObject({ status: "connected" });
  expect(chrome.open).toHaveBeenCalledWith(account.id);
  expect(launcher).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  await manager.stop(service);
  expect(chrome.stop).toHaveBeenCalledOnce();
});

it("refuses discovery and attachment without owner profile acknowledgement", async () => {
  const manager = new XBrowserSessions("unused", vi.fn());
  const service = {} as SocialService;
  const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
  await expect(manager.chromeTabs(service, owner, "account", false)).rejects.toThrow(
    "Confirm access",
  );
});
