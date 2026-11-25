import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SocialLiveError, type SocialLiveService } from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { LiveStreamObsActionError, type SocialCanvases, type SocialPlan } from "./obs";
import type { LiveStreamRelay, LiveStreamRelays } from "./relay";
import { type ApprovedLiveTarget, LiveStreamSocialBroadcast } from "./social-broadcast";

const paths: string[] = [];
const accounts = {
  yt: { accountId: "yt", platform: "youtube", label: "Stream Channel" },
  fb: { accountId: "fb", platform: "facebook", label: "Page" },
  tt: { accountId: "tt", platform: "tiktok", label: "Short Channel" },
  ig: { accountId: "ig", platform: "instagram", label: "Reels" },
} as const;
type Id = keyof typeof accounts;
const bindingOf = (id: Id) => ({
  accountId: id,
  platform: accounts[id].platform,
  platformId: `channel-${id}`,
});
const targetOf = (id: Id) => ({ ...accounts[id], binding: bindingOf(id) });
const keyOf = (id: string) => `private-key-${id}`;
const session: SocialPrincipal = {
  kind: "session",
  actorId: "actor",
  provider: "codex",
  projectId: "project",
  sessionId: "session",
};
const allow = async () => true;
const both: SocialCanvases = { horizontal: true, vertical: true };

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-social-broadcast-"));
  paths.push(directory);
  const file = join(directory, "live-broadcast.json");
  const calls: string[] = [];
  const social = {
    listAccounts: vi.fn<SocialLiveService["listAccounts"]>(async () => Object.values(accounts)),
    getAccount: vi.fn<SocialLiveService["getAccount"]>(
      async (_principal, id) => accounts[id as Id],
    ),
    getAccountBinding: vi.fn<SocialLiveService["getAccountBinding"]>(async (_principal, id) =>
      bindingOf(id as Id),
    ),
    assertAccess: vi.fn<SocialLiveService["assertAccess"]>(async () => {}),
    assertStart: vi.fn<SocialLiveService["assertStart"]>(async () => {}),
    prepare: vi.fn<SocialLiveService["prepare"]>(async (_principal, id, _name, guard) => {
      await guard?.();
      calls.push(`prepare ${id}`);
      return {
        server: `rtmps://${id}.example/live`,
        key: keyOf(id),
        broadcast: { ...bindingOf(id as Id), broadcastId: `b-${id}`, streamId: `s-${id}` },
      };
    }),
    start: vi.fn<SocialLiveService["start"]>(async (_principal, broadcast, guard) => {
      await guard?.();
      calls.push(`platform start ${broadcast.accountId}`);
      return "confirmed";
    }),
    end: vi.fn<SocialLiveService["end"]>(async (_principal, broadcast, guard) => {
      await guard?.();
      calls.push(`platform stop ${broadcast.accountId}`);
      return "confirmed";
    }),
  };
  const obs = {
    socialPreflight: vi.fn(async (_scene: string, _canvases: SocialCanvases) => {
      calls.push("preflight");
    }),
    startSocial: vi.fn(
      async (
        plan: SocialPlan,
        beforeSettings: () => Promise<void>,
        beforeStart: () => Promise<void>,
      ) => {
        await beforeSettings();
        await beforeStart();
        calls.push("obs start");
        return { horizontal: Boolean(plan.horizontal), vertical: Boolean(plan.vertical) };
      },
    ),
    socialStreamStatus: vi.fn(async (canvases: SocialCanvases) => ({
      ...(canvases.horizontal ? { horizontal: true } : {}),
      ...(canvases.vertical ? { vertical: true } : {}),
    })),
    restoreDestination: vi.fn(async () => true),
    clearVertical: vi.fn(async () => true),
    stopSocial: vi.fn(async (_canvases: SocialCanvases, guard: () => Promise<void>) => {
      await guard();
      calls.push("obs stop");
      return true;
    }),
  };
  const started: {
    relay: FakeRelay;
    destinations: readonly { accountId: string; key: string }[];
  }[] = [];
  class FakeRelay {
    server = "rtmp://127.0.0.1:19350/live";
    key = "relay-token";
    lost: { accountId: string; detail: string }[] = [];
    stop = vi.fn(async () => {
      calls.push("relay stop");
    });
    failures = () => this.lost;
  }
  const relays: LiveStreamRelays & { startable: boolean } = {
    startable: true,
    available: async () => relays.startable,
    start: vi.fn(async (destinations: readonly { accountId: string; key: string }[]) => {
      calls.push(`relay start ${destinations.map((entry) => entry.accountId).join("+")}`);
      const relay = new FakeRelay();
      started.push({ relay, destinations });
      return relay as unknown as LiveStreamRelay;
    }),
  };
  const create = () => new LiveStreamSocialBroadcast(directory, obs, () => social, relays);
  return { broadcast: create(), create, file, calls, social, obs, relays, started };
}

const start = (
  broadcast: LiveStreamSocialBroadcast,
  accountIds: Id[],
  principal: SocialPrincipal | undefined = session,
  approved: readonly ApprovedLiveTarget[] | null = accountIds.map(targetOf),
) => broadcast.start({ accountIds, scene: "Studio" }, principal, allow, approved ?? undefined);

it("sends a lone account straight to OBS, recovers the exact provider ID, and guards manual restart", async () => {
  const { broadcast, create, file, calls, social, obs, relays } = await fixture();
  expect(await broadcast.accounts(session)).toEqual({ accounts: Object.values(accounts) });
  const result = await start(broadcast, ["yt"]);
  expect(result).toMatchObject({
    state: "streaming",
    scene: "Studio",
    canStop: true,
    destinations: [{ accountId: "yt", orientation: "horizontal", state: "streaming" }],
  });
  expect(obs.startSocial).toHaveBeenCalledWith(
    { scene: "Studio", horizontal: { server: "rtmps://yt.example/live", key: keyOf("yt") } },
    expect.any(Function),
    expect.any(Function),
  );
  expect(relays.start).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(keyOf("yt"));
  expect(await readFile(file, "utf8")).not.toMatch(/private-key|\.example/);
  const reopened = create();
  await expect(reopened.assertManual("stop")).rejects.toThrow("Use the Social stream controls");
  await expect(reopened.stop(session, allow)).resolves.toMatchObject({
    state: "idle",
    destinations: [],
  });
  expect(social.end).toHaveBeenCalledWith(
    session,
    expect.objectContaining({ broadcastId: "b-yt" }),
    expect.any(Function),
  );
  expect(calls).toEqual([
    "preflight",
    "prepare yt",
    "obs start",
    "platform start yt",
    "obs stop",
    "platform stop yt",
  ]);
  expect(obs.restoreDestination).toHaveBeenCalledTimes(1);
  expect(obs.clearVertical).not.toHaveBeenCalled();
  await expect(reopened.assertManual("start")).resolves.toBeUndefined();
});

it("groups accounts by orientation: one relay for two horizontal accounts, vertical direct", async () => {
  const { broadcast, calls, obs, relays, started } = await fixture();
  const result = await start(broadcast, ["yt", "tt", "fb"]);
  expect(obs.socialPreflight).toHaveBeenCalledWith("Studio", both);
  expect(relays.start).toHaveBeenCalledTimes(1);
  expect(started[0]?.destinations.map((entry) => entry.accountId)).toEqual(["yt", "fb"]);
  expect(obs.startSocial).toHaveBeenCalledWith(
    {
      scene: "Studio",
      horizontal: { server: "rtmp://127.0.0.1:19350/live", key: "relay-token" },
      vertical: { server: "rtmps://tt.example/live", key: keyOf("tt") },
    },
    expect.any(Function),
    expect.any(Function),
  );
  // Every ingest exists before the relay or OBS start, and platforms go live last.
  expect(calls).toEqual([
    "preflight",
    "prepare yt",
    "prepare tt",
    "prepare fb",
    "relay start yt+fb",
    "obs start",
    "platform start yt",
    "platform start tt",
    "platform start fb",
  ]);
  expect(result.destinations.map((entry) => [entry.accountId, entry.orientation])).toEqual([
    ["yt", "horizontal"],
    ["tt", "vertical"],
    ["fb", "horizontal"],
  ]);
  expect(JSON.stringify(result)).not.toMatch(/private-key|relay-token|\.example/);
});

it("uses one relay per canvas when both canvases have several accounts", async () => {
  const { broadcast, relays, obs } = await fixture();
  await start(broadcast, ["yt", "fb", "tt", "ig"]);
  expect(relays.start).toHaveBeenCalledTimes(2);
  expect(obs.startSocial.mock.calls[0]?.[0]).toMatchObject({
    horizontal: { key: "relay-token" },
    vertical: { key: "relay-token" },
  });
});

it("ends every ingest already created when a later one cannot be acquired", async () => {
  const { broadcast, calls, social, obs, relays, file } = await fixture();
  social.prepare.mockImplementationOnce(async (_p, id, _n, guard) => {
    await guard?.();
    calls.push(`prepare ${id}`);
    return {
      server: `rtmps://${id}.example/live`,
      key: keyOf(id),
      broadcast: { ...bindingOf(id as Id), broadcastId: `b-${id}` },
    };
  });
  social.prepare.mockImplementationOnce(async (_p, id, _n, guard) => {
    await guard?.();
    calls.push(`prepare ${id}`);
    return {
      server: `rtmps://${id}.example/live`,
      key: keyOf(id),
      broadcast: { ...bindingOf(id as Id), broadcastId: `b-${id}` },
    };
  });
  social.prepare.mockRejectedValueOnce(new SocialLiveError("LIVE_MISSING_CREDENTIALS"));
  const result = await start(broadcast, ["yt", "fb", "tt"]);
  expect(result).toMatchObject({
    state: "failed",
    canStop: false,
    reason: "LIVE_CREDENTIALS_MISSING",
  });
  expect(result.destinations).toEqual([
    expect.objectContaining({ accountId: "yt", state: "ended" }),
    expect.objectContaining({ accountId: "fb", state: "ended" }),
    expect.objectContaining({
      accountId: "tt",
      state: "failed",
      reason: "LIVE_CREDENTIALS_MISSING",
    }),
  ]);
  expect(calls).toEqual([
    "preflight",
    "prepare yt",
    "prepare fb",
    "platform stop yt",
    "platform stop fb",
  ]);
  expect(obs.startSocial).not.toHaveBeenCalled();
  expect(relays.start).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ broadcasts: {}, pending: [] });
});

it("keeps a broadcast Stop can still end when rolling it back fails", async () => {
  const { broadcast, social } = await fixture();
  social.prepare.mockImplementationOnce(async (_p, id) => ({
    server: `rtmps://${id}.example/live`,
    key: keyOf(id),
    broadcast: { ...bindingOf(id as Id), broadcastId: `b-${id}` },
  }));
  social.prepare.mockRejectedValueOnce(new SocialLiveError("LIVE_PLATFORM_REJECTED"));
  social.end.mockRejectedValueOnce(new SocialLiveError("LIVE_PLATFORM_UNCERTAIN"));
  const result = await start(broadcast, ["yt", "fb"]);
  // yt was created, could not be ended, and stays recorded.
  expect(result).toMatchObject({ canStop: true });
  expect(result.destinations[0]).toMatchObject({ accountId: "yt", state: "failed" });
  await expect(broadcast.stop(session, allow)).resolves.toMatchObject({ state: "idle" });
  expect(social.end).toHaveBeenCalledTimes(2);
});

it("stops OBS, the relays and every platform broadcast, and restores OBS", async () => {
  const { broadcast, calls, obs, started } = await fixture();
  await start(broadcast, ["yt", "fb", "tt"]);
  calls.length = 0;
  const result = await broadcast.stop(session, allow);
  expect(result).toMatchObject({ state: "idle", obsStreaming: false });
  expect(obs.stopSocial).toHaveBeenCalledWith(both, expect.any(Function));
  expect(started[0]?.relay.stop).toHaveBeenCalledOnce();
  expect(obs.restoreDestination).toHaveBeenCalledOnce();
  expect(obs.clearVertical).toHaveBeenCalledOnce();
  expect(calls).toEqual([
    "obs stop",
    "relay stop",
    "platform stop yt",
    "platform stop fb",
    "platform stop tt",
  ]);
});

it("fails before anything goes live when the vertical canvas or ffmpeg is unavailable", async () => {
  const { broadcast, obs, social, relays } = await fixture();
  obs.socialPreflight.mockRejectedValueOnce(
    new LiveStreamObsActionError("VERTICAL_CANVAS_UNAVAILABLE"),
  );
  await expect(start(broadcast, ["yt", "tt"])).resolves.toMatchObject({
    state: "failed",
    canStop: false,
    reason: "VERTICAL_CANVAS_UNAVAILABLE",
  });
  expect(social.prepare).not.toHaveBeenCalled();
  relays.startable = false;
  await expect(start(broadcast, ["yt", "fb"])).resolves.toMatchObject({
    state: "failed",
    reason: "RELAY_UNAVAILABLE",
  });
  expect(social.prepare).not.toHaveBeenCalled();
  expect(obs.startSocial).not.toHaveBeenCalled();
});

it("reports the vertical canvas reason and undoes provider broadcasts when OBS refuses it", async () => {
  const { broadcast, obs, social, started } = await fixture();
  obs.startSocial.mockImplementationOnce(async (_plan, apply) => {
    await apply();
    throw new LiveStreamObsActionError("VERTICAL_CANVAS_UNAVAILABLE");
  });
  const result = await start(broadcast, ["yt", "fb", "tt"]);
  expect(result).toMatchObject({ reason: "VERTICAL_CANVAS_UNAVAILABLE", canStop: false });
  expect(social.end).toHaveBeenCalledTimes(3);
  expect(started[0]?.relay.stop).toHaveBeenCalled();
  expect(obs.restoreDestination).toHaveBeenCalled();
});

it("keeps the other platforms live when one fails to go live and shows its reason", async () => {
  const { broadcast, social } = await fixture();
  social.start.mockImplementationOnce(async () => "confirmed");
  social.start.mockRejectedValueOnce(new SocialLiveError("LIVE_PLATFORM_REJECTED"));
  social.start.mockImplementationOnce(async () => "owner_required");
  const result = await start(broadcast, ["yt", "fb", "tt"]);
  expect(result).toMatchObject({ state: "owner_step", canStop: true });
  expect(result.destinations.map((entry) => [entry.accountId, entry.state, entry.reason])).toEqual([
    ["yt", "streaming", undefined],
    ["fb", "failed", "PLATFORM_FAILED"],
    ["tt", "streaming", "OWNER_STEP_REQUIRED"],
  ]);
  social.end.mockImplementationOnce(async () => "owner_required");
  await expect(broadcast.stop(session, allow)).resolves.toMatchObject({
    state: "owner_step",
    canStop: false,
  });
  expect(social.end).toHaveBeenCalledTimes(3);
});

it("is uncertain, never idle, when no destination confirms going live", async () => {
  const { broadcast, social } = await fixture();
  social.start.mockRejectedValue(new SocialLiveError("LIVE_PLATFORM_UNCERTAIN"));
  const result = await start(broadcast, ["yt", "fb"]);
  expect(result).toMatchObject({ state: "uncertain", canStop: true });
});

it("surfaces a relay that lost a destination while the others keep streaming", async () => {
  const { broadcast, started } = await fixture();
  await start(broadcast, ["yt", "fb"]);
  started[0]!.relay.lost = [{ accountId: "fb", detail: "Error number -138 occurred" }];
  const status = await broadcast.status(session);
  expect(status.state).toBe("streaming");
  expect(status.destinations).toEqual([
    expect.objectContaining({ accountId: "yt", state: "streaming" }),
    expect.objectContaining({
      accountId: "fb",
      state: "failed",
      reason: "RELAY_FAILED",
      detail: "Error number -138 occurred",
    }),
  ]);
  started[0]!.relay.lost = [
    { accountId: "yt", detail: "gone" },
    { accountId: "fb", detail: "gone" },
  ];
  await expect(broadcast.status(session)).resolves.toMatchObject({
    state: "uncertain",
    reason: "RELAY_FAILED",
    canStop: true,
  });
});

it("reads status only for accounts the principal can still read", async () => {
  const { broadcast, social } = await fixture();
  await start(broadcast, ["yt", "tt"]);
  social.assertAccess.mockImplementation(async (_principal, id) => {
    if (id === "tt") throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
  });
  await expect(broadcast.status(session)).resolves.toEqual({
    state: "idle",
    canStop: false,
    destinations: [],
  });
  await expect(broadcast.stop(session, allow)).rejects.toThrow("LIVE_ACCOUNT_UNAVAILABLE");
});

it("keeps the manual-destination guard when the previous OBS destination cannot be restored", async () => {
  const { broadcast, obs } = await fixture();
  obs.restoreDestination.mockResolvedValueOnce(false);
  await start(broadcast, ["yt"]);
  await broadcast.stop(session, allow);
  await expect(broadcast.assertManual("start")).rejects.toThrow("set a manual OBS destination");
  await broadcast.manualDestinationSaved();
  await expect(broadcast.assertManual("start")).resolves.toBeUndefined();
});

it("restores the previous OBS destination when OBS start never dispatched", async () => {
  const { broadcast, obs, file } = await fixture();
  obs.startSocial.mockImplementationOnce(async (_plan, beforeSettings) => {
    await beforeSettings();
    throw new Error("OBS refused");
  });
  const result = await start(broadcast, ["yt"]);
  expect(result.state).not.toBe("streaming");
  expect(obs.restoreDestination).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ managedDestination: false });
});

it("requires exact approval of every account and current Social permission before provisioning", async () => {
  const { broadcast, social, obs } = await fixture();
  await expect(start(broadcast, ["yt"], session, null)).resolves.toMatchObject({
    reason: "AUTHORITY_DENIED",
  });
  // An approval that omits one requested account, or lists another label, is not enough.
  await expect(start(broadcast, ["yt", "tt"], session, [targetOf("yt")])).resolves.toMatchObject({
    reason: "AUTHORITY_DENIED",
  });
  await expect(
    start(broadcast, ["yt"], session, [{ ...targetOf("yt"), label: "Other" }]),
  ).resolves.toMatchObject({ reason: "AUTHORITY_DENIED" });
  expect(obs.socialPreflight).not.toHaveBeenCalled();
  social.assertStart.mockRejectedValueOnce(new SocialLiveError("LIVE_SOCIAL_STOPPED"));
  await expect(start(broadcast, ["yt"])).resolves.toMatchObject({ reason: "AUTHORITY_DENIED" });
  expect(social.prepare).not.toHaveBeenCalled();
  obs.socialPreflight.mockRejectedValueOnce(new LiveStreamObsActionError("OBS_NOT_CONFIGURED"));
  await expect(start(broadcast, ["yt"])).resolves.toMatchObject({ reason: "OBS_NOT_CONFIGURED" });
  expect(social.prepare).not.toHaveBeenCalled();
});

it("uses a stable reason for missing credentials and does not leak an OBS error", async () => {
  const { broadcast, social, obs } = await fixture();
  social.prepare.mockRejectedValueOnce(new SocialLiveError("LIVE_MISSING_CREDENTIALS"));
  await expect(start(broadcast, ["yt"], undefined)).resolves.toMatchObject({
    reason: "LIVE_CREDENTIALS_MISSING",
    canStop: false,
  });
  obs.startSocial.mockImplementationOnce(async (plan, apply, begin) => {
    await apply();
    await begin();
    throw new Error(plan.horizontal?.key);
  });
  const result = await start(broadcast, ["yt"], undefined);
  expect(result).toMatchObject({ state: "uncertain", reason: "START_UNCERTAIN", canStop: true });
  expect(JSON.stringify(result)).not.toContain(keyOf("yt"));
  await start(broadcast, ["yt"], undefined);
  expect(obs.startSocial).toHaveBeenCalledTimes(1);
  expect(social.start).not.toHaveBeenCalled();
});

it("cancels before OBS dispatch and hides an active destination after grant revocation", async () => {
  const { broadcast, obs, social } = await fixture();
  let entered!: () => void;
  const preflight = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  obs.socialPreflight.mockImplementationOnce(async () => {
    entered();
    await proceed;
  });
  const pending = start(broadcast, ["yt", "fb"]);
  await preflight;
  await broadcast.cancel(session, allow);
  release();
  await expect(pending).resolves.toMatchObject({ reason: "CANCELED", canStop: false });
  expect(social.prepare).not.toHaveBeenCalled();
  await start(broadcast, ["yt"]);
  social.assertAccess.mockRejectedValue(new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE"));
  await expect(broadcast.status(session)).resolves.toEqual({
    state: "idle",
    canStop: false,
    destinations: [],
  });
  await expect(broadcast.stop(session, allow)).rejects.toThrow("LIVE_ACCOUNT_UNAVAILABLE");
  await expect(broadcast.stop()).resolves.toMatchObject({ state: "idle" });
});

it("requires owner reconciliation after an ambiguous provider create without a receipt", async () => {
  const { broadcast, social, obs } = await fixture();
  social.prepare.mockImplementationOnce(async (_principal, _id, _scene, guard) => {
    await guard?.();
    throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN");
  });
  await expect(start(broadcast, ["yt"], undefined)).resolves.toMatchObject({
    state: "uncertain",
    canStop: true,
  });
  await expect(broadcast.stop()).resolves.toMatchObject({
    reason: "STOP_UNCERTAIN",
    needsPlatformConfirmation: true,
  });
  expect(obs.stopSocial).not.toHaveBeenCalled();
  expect(social.end).not.toHaveBeenCalled();
  await expect(broadcast.stop(session, allow, true)).rejects.toThrow();
  await expect(broadcast.stop(undefined, allow, true)).resolves.toMatchObject({ state: "idle" });
});
