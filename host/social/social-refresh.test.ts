import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { SocialRefreshError } from "./oauth/refresh-error";
import { fixture, runCleanups } from "./social-test-support";

afterEach(runCleanups);

type Fixture = Awaited<ReturnType<typeof fixture>>;

// Every credential below is a fake string; no real provider or secret is involved.
const OLD = { accessToken: "fake-old-access", refreshToken: "fake-old-refresh" };
const NEW = { accessToken: "fake-new-access", refreshToken: "fake-new-refresh" };

/** An account whose stored credential and account record both expire within the refresh window. */
async function expiring(s: Fixture, name = "Account") {
  const account = await s.account("x", [s.a.id], name);
  s.tokens.set(account.id, { ...OLD, expiresAt: s.clock.value + 500 });
  await s.store.db
    .prepare(
      "UPDATE social_records SET value=json_set(value,'$.expiresAt',?) WHERE kind='account' AND id=?",
    )
    .run(s.clock.value + 500, account.id);
  return account;
}
const renewed = (s: Fixture) => ({ ...NEW, expiresAt: s.clock.value + 3_600_000 });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const refreshState = async (s: Fixture, id: string) => await s.social.setting(`refreshState:${id}`);

describe("rotated refresh credential custody (#1375)", () => {
  it("saves the rotated credential when an unrelated account edit lands during the refresh", async () => {
    const s = await fixture();
    const account = await expiring(s);
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      await held.promise;
      return renewed(s);
    });
    const pending = s.social.credentialFor(account.id);
    await vi.waitFor(() => expect(s.social.refreshCredential).toHaveBeenCalledOnce());
    await s.call("accounts.pause", { accountId: account.id, paused: true });
    held.release();
    await expect(pending).resolves.toMatchObject({ accessToken: NEW.accessToken });
    expect(s.tokens.get(account.id)).toEqual(renewed(s));
    const saved = await s.social.account(account.id);
    expect(saved.paused).toBe(true);
    expect(saved.expiresAt).toBe(renewed(s).expiresAt);
  });

  it("saves the rotated credential even when authority is revoked before the save", async () => {
    const s = await fixture();
    const account = await expiring(s);
    let authorized = true;
    s.social.refreshCredential = vi.fn(async () => {
      authorized = false;
      return renewed(s);
    });
    await expect(
      s.store.db.withAuthorization(
        () => authorized,
        () => s.social.credentialFor(account.id),
      ),
    ).rejects.toThrow("authorization was revoked");
    expect(s.tokens.get(account.id)).toEqual(renewed(s));
  });

  it("does not start a refresh for a request that already lost authority", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => renewed(s));
    await expect(
      s.store.db.withAuthorization(
        () => false,
        () => s.social.credentialFor(account.id),
      ),
    ).rejects.toThrow();
    expect(s.social.refreshCredential).not.toHaveBeenCalled();
    expect(s.tokens.get(account.id)?.accessToken).toBe(OLD.accessToken);
  });

  it("drops the result when the credential generation changed during the refresh", async () => {
    const s = await fixture();
    const account = await expiring(s);
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      await held.promise;
      return renewed(s);
    });
    const pending = s.social.credentialFor(account.id);
    const rejected = expect(pending).rejects.toMatchObject({ code: "expired" });
    await vi.waitFor(() => expect(s.social.refreshCredential).toHaveBeenCalledOnce());
    const reconnected = {
      accessToken: "fake-reconnected-access",
      refreshToken: "fake-reconnected-refresh",
      expiresAt: s.clock.value + 7_200_000,
    };
    s.tokens.set(account.id, reconnected);
    held.release();
    await rejected;
    expect(s.tokens.get(account.id)).toEqual(reconnected);
  });

  it("drops the result when the owner disconnected the account during the refresh", async () => {
    const s = await fixture();
    const account = await expiring(s);
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      await held.promise;
      return renewed(s);
    });
    vi.mocked(s.credentials.set).mockClear();
    const pending = s.social.credentialFor(account.id);
    const rejected = expect(pending).rejects.toBeInstanceOf(SocialPlatformError);
    await vi.waitFor(() => expect(s.social.refreshCredential).toHaveBeenCalledOnce());
    const disconnecting = s.call("accounts.disconnect", { accountId: account.id });
    // Disconnect records its epoch before it queues for the credential lock.
    await vi.waitFor(async () =>
      expect(await s.social.setting(`connectionEpoch:${account.id}`)).toBeDefined(),
    );
    held.release();
    await rejected;
    await disconnecting;
    expect(s.credentials.set).not.toHaveBeenCalled();
    expect(s.tokens.has(account.id)).toBe(false);
  });

  it("drops the result when the platform identity changed during the refresh", async () => {
    const s = await fixture();
    const account = await expiring(s);
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      await held.promise;
      return renewed(s);
    });
    vi.mocked(s.credentials.set).mockClear();
    const pending = s.social.credentialFor(account.id);
    const rejected = expect(pending).rejects.toMatchObject({ code: "expired" });
    await vi.waitFor(() => expect(s.social.refreshCredential).toHaveBeenCalledOnce());
    await s.store.db
      .prepare(
        "UPDATE social_records SET value=json_set(value,'$.platformId','fake-other-identity') WHERE kind='account' AND id=?",
      )
      .run(account.id);
    held.release();
    await rejected;
    expect(s.credentials.set).not.toHaveBeenCalled();
  });
});

describe("failed refresh backoff and repair (#1374)", () => {
  it("backs off exponentially and never repeats the provider call every tick", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => {
      throw new Error("fake-provider-body fake-old-refresh");
    });
    const calls = () => vi.mocked(s.social.refreshCredential!).mock.calls.length;
    await s.social.tick();
    expect(calls()).toBe(1);
    // Five more ticks inside the first 30 s delay stay silent.
    for (let index = 0; index < 5; index++) {
      s.clock.value += 5_000;
      await s.social.tick();
    }
    expect(calls()).toBe(1);
    s.clock.value += 6_000;
    await s.social.tick();
    expect(calls()).toBe(2);
    // The second failure doubles the delay to 60 s.
    s.clock.value += 40_000;
    await s.social.tick();
    expect(calls()).toBe(2);
    s.clock.value += 25_000;
    await s.social.tick();
    expect(calls()).toBe(3);
    const state = JSON.parse((await refreshState(s, account.id))!);
    expect(state).toMatchObject({ failures: 3 });
    expect(state.permanent).toBeUndefined();
    // Neither the provider's message nor any token reaches the stored state.
    expect(JSON.stringify(state)).not.toMatch(/fake-/);
  });

  it("caps the delay and recovers by itself when the provider returns", async () => {
    const s = await fixture();
    const account = await expiring(s);
    let healthy = false;
    s.social.refreshCredential = vi.fn(async () => {
      if (!healthy) throw new Error("fake-outage");
      return renewed(s);
    });
    for (let index = 0; index < 14; index++) {
      await s.social.tick();
      s.clock.value += 16 * 60_000;
    }
    const state = JSON.parse((await refreshState(s, account.id))!);
    expect(state.nextRefreshAt - (s.clock.value - 16 * 60_000)).toBeLessThanOrEqual(15 * 60_000);
    healthy = true;
    await s.social.tick();
    expect(s.tokens.get(account.id)).toEqual(renewed(s));
    expect(await refreshState(s, account.id)).toBeUndefined();
  });

  it("keeps serving an unexpired credential while a refresh is backed off and refuses an expired one", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => {
      throw new Error("fake-outage");
    });
    await expect(s.social.credentialFor(account.id)).rejects.toMatchObject({ code: "expired" });
    expect((await s.social.credentialFor(account.id))?.accessToken).toBe(OLD.accessToken);
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
    s.clock.value += 1_000;
    await expect(s.social.credentialFor(account.id)).rejects.toMatchObject({ code: "expired" });
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
  });

  it("marks a rejected grant as needing reconnection and stops contacting the provider", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => {
      throw new SocialRefreshError("permanent", "Account refresh failed. Reconnect the account.");
    });
    await s.social.tick();
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
    const state = JSON.parse((await refreshState(s, account.id))!);
    expect(state.permanent).toBe(true);
    const marked = await s.social.account(account.id);
    expect(marked.connected).toBe(true);
    expect(marked.expiresAt).toBeLessThanOrEqual(s.clock.value);
    for (let index = 0; index < 5; index++) {
      s.clock.value += 24 * 60 * 60_000;
      await s.social.tick();
    }
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
  });

  it("repairs through an explicit reconnect, which clears the state and resumes refreshing", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => {
      throw new SocialRefreshError("permanent", "Account refresh failed. Reconnect the account.");
    });
    await s.social.tick();
    expect(await refreshState(s, account.id)).toBeDefined();
    const stored = await s.social.account(account.id);
    await s.social.connectAccount(
      account.id,
      {
        platformId: stored.platformId,
        name: stored.name,
        scopes: stored.scopes,
        accessApproved: stored.accessApproved,
      },
      { ...OLD, expiresAt: s.clock.value + 500 },
    );
    expect(await refreshState(s, account.id)).toBeUndefined();
    s.social.refreshCredential = vi.fn(async () => renewed(s));
    await s.social.tick();
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
    expect(s.tokens.get(account.id)).toEqual(renewed(s));
  });

  it("forgets the failure state when the account is disconnected", async () => {
    const s = await fixture();
    const account = await expiring(s);
    s.social.refreshCredential = vi.fn(async () => {
      throw new Error("fake-outage");
    });
    await s.social.tick();
    expect(await refreshState(s, account.id)).toBeDefined();
    await s.call("accounts.disconnect", { accountId: account.id });
    expect(await refreshState(s, account.id)).toBeUndefined();
  });

  it("does not hold dispatch behind an account whose refresh is already failing", async () => {
    const s = await fixture();
    const failing = await expiring(s, "Failing");
    const active = await s.account("x", [s.a.id], "Active");
    let hang = false;
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      if (hang) await held.promise;
      throw new Error("fake-outage");
    });
    await s.social.tick();
    expect(s.social.refreshCredential).toHaveBeenCalledOnce();
    s.clock.value += 31_000;
    // Keep the active account's token fresh after the clock jump.
    s.tokens.set(active.id, {
      accessToken: "fake-active-access",
      expiresAt: s.clock.value + 3_600_000,
    });
    s.tokens.set(failing.id, { ...OLD, expiresAt: s.clock.value + 500 });
    hang = true;
    await s.enable();
    const campaign = await s.campaign([active]);
    await s.call("campaigns.schedule", { id: campaign.id });
    let finished = false;
    const ticking = s.social.tick().then(() => {
      finished = true;
    });
    try {
      await vi.waitFor(() => expect(s.send).toHaveBeenCalled());
      await vi.waitFor(() => expect(s.social.refreshCredential).toHaveBeenCalledTimes(2));
      // The retry is still held in flight while dispatch already ran.
      expect(finished).toBe(false);
    } finally {
      held.release();
      await ticking;
    }
    expect(s.send.mock.calls[0][0].id).toBe(active.id);
  });

  it("still sends the first failing refresh through the dispatch barrier", async () => {
    const s = await fixture();
    const first = await expiring(s);
    const held = gate();
    s.social.refreshCredential = vi.fn(async () => {
      await held.promise;
      return renewed(s);
    });
    await s.enable();
    const campaign = await s.campaign([first]);
    await s.call("campaigns.schedule", { id: campaign.id });
    const ticking = s.social.tick();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(s.send).not.toHaveBeenCalled();
    } finally {
      held.release();
      await ticking;
    }
    expect(s.send.mock.calls[0]?.[2]).toBe(NEW.accessToken);
  });
});
