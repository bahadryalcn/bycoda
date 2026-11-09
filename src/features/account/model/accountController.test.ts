import { AccountApiError } from "@bycoda/account-contracts";
import { createMockAccountServer } from "@bycoda/account-contracts/mock";
import { describe, expect, it, vi } from "vitest";
import { createAccountController } from "./accountController";
import { readDeviceId } from "./accountCache";
import { AccountNativeError, type AccountNative, type SignInPoll } from "./accountNative";
import { ACCOUNT_CONTEXT, memoryStorage } from "./testFixtures";

const CACHE_KEY = "bycoda.account.cache.v1";
const LOCAL_DATA_KEY = "bycoda.sessions.draft"; // stands in for any local app data

function setup(
  options: { signedIn?: boolean; poll?: SignInPoll[]; storage?: Record<string, string> } = {},
) {
  const server = createMockAccountServer();
  const requests: { url: string; headers: Record<string, string> }[] = [];
  let online = true;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!online) throw new TypeError("Failed to fetch");
    requests.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
    });
    return server.fetch(input, init);
  }) as typeof fetch;
  let signedIn = options.signedIn ?? false;
  let tokenError: AccountNativeError | null = null;
  let token = "mock-test-token";
  const polls = [...(options.poll ?? [{ status: "done" } as SignInPoll])];
  const native = {
    status: vi.fn(async () => ({
      configured: true,
      signedIn,
      apiBaseUrl: "https://api.test",
      environment: "staging" as const,
    })),
    signInStart: vi.fn(async () => ({
      handle: "h1",
      authorizeUrl: "https://login.test/auth",
      expiresIn: 300,
    })),
    signInPoll: vi.fn(async () => polls.shift() ?? ({ status: "pending" } as SignInPoll)),
    signInCancel: vi.fn(async () => undefined),
    accessToken: vi.fn(async () => {
      if (tokenError) throw tokenError;
      if (!signedIn) throw new AccountNativeError("signedOut", "Signed out.");
      return { accessToken: token, expiresAt: Date.now() + 3_600_000 };
    }),
    signOut: vi.fn(async () => {
      signedIn = false;
    }),
    deviceInfo: vi.fn(async () => ({
      name: "Ada laptop",
      platform: "windows" as const,
      osVersion: "Windows 11",
      appVersion: "0.7.5",
      channel: "stable" as const,
    })),
  } satisfies AccountNative;
  const storage = memoryStorage({ [LOCAL_DATA_KEY]: "unsent draft", ...options.storage });
  const openExternal = vi.fn(async () => undefined);
  let clock = 10 * 86_400_000;
  const controller = createAccountController({
    native,
    openExternal,
    fetchImpl,
    storage,
    now: () => clock,
    sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
  });
  return {
    controller,
    native,
    storage,
    openExternal,
    requests,
    server,
    goOffline: () => (online = false),
    goOnline: () => (online = true),
    failToken: (error: AccountNativeError) => (tokenError = error),
    useToken: (value: string) => (token = value),
    setSignedIn: (value: boolean) => (signedIn = value),
    advance: (ms: number) => (clock += ms),
  };
}

describe("account controller", () => {
  it("starts signed out and never needs the account", async () => {
    const { controller, native } = setup();
    await controller.start();
    expect(controller.getState()).toMatchObject({ phase: "signed-out", notice: null });
    expect(native.accessToken).not.toHaveBeenCalled();
  });

  it("stays unavailable when the build has no account service", async () => {
    const { controller, native } = setup();
    native.status.mockResolvedValueOnce({
      configured: false,
      signedIn: false,
      apiBaseUrl: null,
      environment: null,
    });
    await controller.start();
    expect(controller.getState().phase).toBe("unavailable");
  });

  it("signs in through the browser, registers the device and caches the view", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    expect(t.openExternal).toHaveBeenCalledWith("https://login.test/auth");
    const state = t.controller.getState();
    expect(state).toMatchObject({ phase: "signed-in", stale: false });
    if (state.phase !== "signed-in") throw new Error("expected signed in");
    expect(state.deviceId).toBeTruthy();
    expect(readDeviceId(state.context.user.id, t.storage)).toBe(state.deviceId);
    expect(state.context.organizations).toEqual([]);
    expect(t.storage.data.has(CACHE_KEY)).toBe(true);
    // The registration reached the service.
    const registered = [...t.server.state.devices.values()];
    expect(
      registered.some((device) => device.id === state.deviceId && device.name === "Ada laptop"),
    ).toBe(true);
  });

  it("sends the device header on requests after registration", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    await t.controller.api().listDevices();
    const last = t.requests.at(-1)!;
    expect(last.url).toBe("https://api.test/v1/devices");
    expect(last.headers["X-Bycoda-Device"]).toBeTruthy();
    expect(last.headers.Authorization).toBe("Bearer mock-test-token");
  });

  it("reports a declined or failed sign-in and returns to signed out", async () => {
    const declined = setup({ poll: [{ status: "pending" }, { status: "denied" }] });
    await declined.controller.start();
    await declined.controller.signIn();
    expect(declined.controller.getState()).toMatchObject({
      phase: "signed-out",
      notice: "declined",
    });

    const failed = setup({
      poll: [{ status: "failed", error: { kind: "failed", message: "Sign-in failed (x)." } }],
    });
    await failed.controller.start();
    await failed.controller.signIn();
    expect(failed.controller.getState()).toMatchObject({
      phase: "signed-out",
      notice: "sign-in-failed",
      message: "Sign-in failed (x).",
    });
  });

  it("cancel frees the native flow and goes back to signed out", async () => {
    const t = setup({ poll: [] });
    await t.controller.start();
    const pending = t.controller.signIn();
    await vi.waitFor(() => expect(t.native.signInPoll).toHaveBeenCalled());
    await t.controller.cancelSignIn();
    await pending;
    expect(t.native.signInCancel).toHaveBeenCalledWith("h1");
    expect(t.controller.getState()).toMatchObject({ phase: "signed-out", notice: null });
  });

  it("restores the cached view at start and confirms it with the service", async () => {
    const first = setup();
    await first.controller.start();
    first.setSignedIn(true);
    await first.controller.signIn();

    const second = setup({ signedIn: true, storage: Object.fromEntries(first.storage.data) });
    const seen: string[] = [];
    second.controller.subscribe(() => {
      const state = second.controller.getState();
      seen.push(
        state.phase === "signed-in" ? `in:${state.stale ? "stale" : "fresh"}` : state.phase,
      );
    });
    await second.controller.start();
    expect(seen).toEqual(["in:stale", "in:fresh"]);
  });

  it("keeps the cached view, marked stale, when offline", async () => {
    const first = setup();
    await first.controller.start();
    first.setSignedIn(true);
    await first.controller.signIn();

    const second = setup({ signedIn: true, storage: Object.fromEntries(first.storage.data) });
    second.goOffline();
    await second.controller.start();
    expect(second.controller.getState()).toMatchObject({ phase: "signed-in", stale: true });
    second.goOnline();
    await second.controller.refresh();
    expect(second.controller.getState()).toMatchObject({ phase: "signed-in", stale: false });
  });

  it("ignores a cache older than seven days", async () => {
    const stale = {
      [CACHE_KEY]: JSON.stringify({
        verifiedAt: 1,
        deviceId: "dev_old",
        context: ACCOUNT_CONTEXT,
      }),
    };
    const t = setup({ signedIn: true, storage: stale });
    t.goOffline();
    await t.controller.start();
    expect(t.controller.getState().phase).toBe("signed-out");
    expect(t.storage.data.has(CACHE_KEY)).toBe(false);
  });

  it("a refresh failure signs out with a clear notice and keeps local data", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    t.failToken(new AccountNativeError("sessionExpired", "Your bycoda session ended."));
    await t.controller.refresh();
    expect(t.controller.getState()).toMatchObject({ phase: "signed-out", notice: "session-ended" });
    expect(t.storage.data.has(CACHE_KEY)).toBe(false);
    expect(t.storage.data.get(LOCAL_DATA_KEY)).toBe("unsent draft");
  });

  it("a remote sign-out of this device ends the session and forgets the tokens", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    // The service answers device_revoked for a device that was signed out remotely.
    t.useToken("mock-revoked");
    await t.controller.refresh();
    expect(t.native.signOut).toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({
      phase: "signed-out",
      notice: "device-revoked",
    });
  });

  it("signing out forgets the account but never touches local data", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    const before = new Map(t.storage.data);
    await t.controller.signOut();
    expect(t.native.signOut).toHaveBeenCalled();
    expect(t.controller.getState()).toMatchObject({ phase: "signed-out", notice: null });
    expect(t.storage.data.has(CACHE_KEY)).toBe(false);
    expect(t.storage.data.get(LOCAL_DATA_KEY)).toBe(before.get(LOCAL_DATA_KEY));
    // Only the account cache went away; the device id survives for the next sign-in.
    const removed = [...before.keys()].filter((key) => !t.storage.data.has(key));
    expect(removed).toEqual([CACHE_KEY]);
  });

  it("a failed native sign-out keeps the signed-in state so it can be retried", async () => {
    const t = setup();
    await t.controller.start();
    t.setSignedIn(true);
    await t.controller.signIn();
    t.native.signOut.mockRejectedValueOnce(new AccountNativeError("keychain", "no store"));
    await expect(t.controller.signOut()).rejects.toThrow("no store");
    expect(t.controller.getState().phase).toBe("signed-in");
  });
  describe("deactivation", () => {
    async function signedIn() {
      const t = setup({ signedIn: true });
      await t.controller.start();
      return t;
    }
    const user = (c: { getState: () => unknown }) =>
      (c.getState() as { context: { user: { status?: string } } }).context.user;

    it("stays signed in without a device after deactivating, and restores on reactivate", async () => {
      const t = await signedIn();
      expect(t.controller.getState()).toMatchObject({ phase: "signed-in" });
      await t.controller.deactivate("taking a break");
      expect(t.controller.getState()).toMatchObject({ phase: "signed-in", deviceId: null });
      expect(user(t.controller).status).toBe("deactivated");
      await t.controller.reactivate();
      expect(user(t.controller).status).toBe("active");
      expect((t.controller.getState() as { deviceId: string | null }).deviceId).not.toBeNull();
    });

    it("treats a revoked device of a deactivated account as deactivated, not signed out", async () => {
      const t = await signedIn();
      await t.controller.api().deactivateAccount({ body: {} });
      await t.controller.refresh();
      expect(t.controller.getState()).toMatchObject({ phase: "signed-in", deviceId: null });
      expect(user(t.controller).status).toBe("deactivated");
      expect(t.native.signOut).not.toHaveBeenCalled();
    });

    it("answers account_deactivated by showing the deactivated account", async () => {
      const t = await signedIn();
      await t.controller.api().deactivateAccount({ body: {} });
      await t.controller.handleFailure(
        new AccountApiError(403, "account_deactivated", "This account is deactivated"),
      );
      expect(user(t.controller).status).toBe("deactivated");
    });
  });
});
