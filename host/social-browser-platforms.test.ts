import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformBrowserSessions } from "./social-browser-platforms";
import type { BrowserLauncher, BrowserPage, PlainBrowserLauncher } from "./social-browser";
import type { BrowserRecipe } from "./social-browser-recipe";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import type { SocialService } from "./social";
import { SocialPlatformError } from "../src/integrations/social/adapter";

const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});
const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "social-platform-browser-"));
  cleanup.push(directory);
  const account: SocialAccount = {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "facebook",
    platformId: "web:facebook:123",
    name: "Fixture",
    accountType: "member",
    connection: "browser",
    scopes: ["browser:publish", "browser:poll"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
  };
  const job = {
    id: "job",
    kind: "publish",
    accountId: account.id,
    payload: { text: "Exact approved text", media: [] },
  } as unknown as SocialJob;
  const page = {
    goto: vi.fn(),
    evaluate: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    cookies: vi.fn(),
    watchResponse: vi.fn(),
  } as unknown as BrowserPage;
  const close = vi.fn(async () => {});
  const launcher: BrowserLauncher = vi.fn(async () => ({
    page,
    close,
    closed: new Promise<void>(() => {}),
  }));
  const recipe: BrowserRecipe = {
    platform: "facebook",
    loginUrl: "https://www.facebook.com/",
    operations: ["publish", "poll"],
    identity: vi.fn(async () => ({
      platformId: account.platformId,
      name: account.name,
      accountType: "member" as const,
    })),
    send: vi.fn(async (context) => {
      await context.verifyIdentity();
      await context.page.click("exact-submit");
      return { platformId: "confirmed-post" };
    }),
    poll: vi.fn(async () => ({ events: [] })),
  };
  let now = 1000;
  const locks = new Map<string, Promise<unknown>>();
  const exclusive = <T>(id: string, action: () => Promise<T>) => {
    const pending = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    locks.set(
      id,
      pending.catch(() => {}),
    );
    return pending;
  };
  let closeLogin!: () => void;
  const plain: PlainBrowserLauncher = vi.fn(async () => ({
    close: async () => closeLogin(),
    closed: new Promise<void>((done) => {
      closeLogin = done;
    }),
  }));
  const manager = new PlatformBrowserSessions(
    directory,
    [recipe],
    launcher,
    plain,
    (id) => join(directory, id),
    exclusive,
    () => now,
    async () => {
      now += 500;
      await new Promise<void>((done) => setTimeout(done, 0));
    },
    true,
  );
  const connectAccount = vi.fn(async () => account);
  const service = {
    store: { environmentId: "host" },
    accountForOAuth: vi.fn(async () => account),
    connectAccount,
  } as unknown as SocialService;
  return {
    manager,
    account,
    job,
    recipe,
    page,
    launcher,
    close,
    service,
    connectAccount,
    closeLogin: () => closeLogin(),
    advance: () => {
      now += 31_000;
    },
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise<void>((done) => setTimeout(done, 1));
  expect(check()).toBe(true);
}

describe("platform browser sessions", () => {
  it("uses the saved isolated identity and existing pre-submit authorization before a single send", async () => {
    const f = await fixture();
    const guard = vi.fn(async () => {});
    await expect(
      f.manager.adapter().send(f.account, f.job, "browser-session", vi.fn(), undefined, guard),
    ).resolves.toEqual({ platformId: "confirmed-post" });
    expect(guard).toHaveBeenCalled();
    expect(f.page.click).toHaveBeenCalledExactlyOnceWith("exact-submit");
    expect(f.close).toHaveBeenCalledOnce();
    await expect(
      f.manager.adapter().send(f.account, f.job, "browser-session", vi.fn()),
    ).rejects.toMatchObject({ code: "rate_limit" });
    expect(f.page.click).toHaveBeenCalledOnce();
  });
  it("rejects another signed-in identity before touching a composer", async () => {
    const f = await fixture();
    vi.mocked(f.recipe.identity).mockResolvedValue({ platformId: "another-user", name: "Other" });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).rejects.toMatchObject({
      code: "denied",
    });
    expect(f.recipe.send).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("honors Stop that arrives while the browser composer is being prepared", async () => {
    const f = await fixture();
    let stopped = false;
    vi.mocked(f.recipe.send).mockImplementation(async (context) => {
      stopped = true;
      await context.verifyIdentity();
      await context.page.click("exact-submit");
      return { platformId: "never" };
    });
    await expect(
      f.manager.adapter().send(f.account, f.job, "", vi.fn(), undefined, async () => {
        if (stopped) throw new Error("Stopped");
      }),
    ).rejects.toThrow("Stopped");
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("does not turn a missing acknowledgement into success or retry the mutation", async () => {
    const f = await fixture();
    vi.mocked(f.recipe.send).mockImplementation(async (context) => {
      await context.verifyIdentity();
      await context.page.click("exact-submit");
      throw new SocialPlatformError("unknown");
    });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).rejects.toMatchObject({
      code: "unknown",
    });
    expect(f.page.click).toHaveBeenCalledOnce();
  });
  it("holds a post-submit identity change for review rather than returning a retryable failure", async () => {
    const f = await fixture();
    vi.mocked(f.recipe.send).mockImplementation(async (context) => {
      await context.verifyIdentity();
      await context.page.click("exact-submit");
      vi.mocked(f.recipe.identity).mockResolvedValue({
        platformId: "different-user",
        name: "Other",
      });
      return { platformId: "confirmed-but-identity-changed" };
    });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).rejects.toMatchObject({
      code: "unknown",
    });
    expect(f.page.click).toHaveBeenCalledOnce();
  });
  it("rejects a web identity that changes during a read before ingesting events", async () => {
    const f = await fixture();
    vi.mocked(f.recipe.identity)
      .mockResolvedValueOnce({ platformId: f.account.platformId, name: "Owner" })
      .mockResolvedValue({ platformId: "different", name: "Other" });
    await expect(f.manager.adapter().poll(f.account, "", [])).rejects.toMatchObject({
      code: "denied",
    });
  });
  it("only connects after closing owner login and verifying the persisted session", async () => {
    const f = await fixture();
    f.account.connected = false;
    f.account.platformId = "";
    vi.mocked(f.recipe.identity).mockResolvedValue({
      platformId: "web:facebook:123",
      name: "Owner",
      accountType: "member",
    });
    expect((await f.manager.begin(f.service, owner, f.account)).status).toBe("waiting");
    expect(f.connectAccount).not.toHaveBeenCalled();
    await until(
      () => vi.mocked(f.launcher).mock.calls.length === 0 && f.manager.waiting(f.account.id),
    );
    await new Promise<void>((done) => setTimeout(done, 1));
    f.closeLogin();
    await until(() => f.manager.status(f.account.id).status === "connected");
    expect(f.connectAccount).toHaveBeenCalledWith(
      f.account.id,
      expect.objectContaining({
        connection: "browser",
        platformId: "web:facebook:123",
        scopes: ["browser:publish", "browser:poll"],
      }),
      { accessToken: "browser-session" },
    );
  });
  it("stops a pending owner login without connecting or deleting the saved profile", async () => {
    const f = await fixture();
    await f.manager.begin(f.service, owner, f.account);
    await new Promise<void>((done) => setTimeout(done, 1));
    await f.manager.stop();
    await new Promise<void>((done) => setTimeout(done, 1));
    expect(f.manager.status(f.account.id)).toEqual({ status: "idle" });
    expect(f.connectAccount).not.toHaveBeenCalled();
    expect(f.launcher).not.toHaveBeenCalled();
    await expect(f.manager.begin(f.service, owner, f.account)).rejects.toThrow("stopping");
  });
});
