import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SocialLiveError, type SocialLiveService } from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { LiveGamesObsActionError } from "./obs";
import { LiveGamesSocialBroadcast } from "./social-broadcast";

const paths: string[] = [];
const account = {
  accountId: "social-youtube",
  platform: "youtube",
  label: "Halay Channel",
} as const;
const binding = { accountId: account.accountId, platform: account.platform, platformId: "channel" };
const target = { ...account, binding };
const destination = {
  server: "rtmps://encoder.example/ingest",
  key: "private-fixture-stream-key",
  broadcast: {
    ...account,
    platformId: "channel",
    broadcastId: "broadcast-1",
    streamId: "stream-1",
  },
};
const session: SocialPrincipal = {
  kind: "session",
  actorId: "actor",
  provider: "codex",
  projectId: "project",
  sessionId: "session",
};
const allow = async () => true;

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-social-broadcast-"));
  paths.push(directory);
  const file = join(directory, "social-broadcast.json");
  const calls: string[] = [];
  const social = {
    listAccounts: vi.fn<SocialLiveService["listAccounts"]>(async () => [account]),
    getAccount: vi.fn<SocialLiveService["getAccount"]>(async () => account),
    getAccountBinding: vi.fn<SocialLiveService["getAccountBinding"]>(async () => binding),
    assertAccess: vi.fn<SocialLiveService["assertAccess"]>(async () => {}),
    assertStart: vi.fn<SocialLiveService["assertStart"]>(async () => {}),
    prepare: vi.fn<SocialLiveService["prepare"]>(async (_principal, _id, _name, guard) => {
      await guard?.();
      calls.push("prepare");
      return {
        ...destination,
        broadcast: {
          accountId: account.accountId,
          platform: account.platform,
          platformId: "channel",
          broadcastId: "broadcast-1",
          streamId: "stream-1",
        },
      };
    }),
    start: vi.fn<SocialLiveService["start"]>(async (_principal, _broadcast, guard) => {
      await guard?.();
      calls.push("platform start");
      return "confirmed";
    }),
    end: vi.fn<SocialLiveService["end"]>(async (_principal, _broadcast, guard) => {
      await guard?.();
      calls.push("platform stop");
      return "confirmed";
    }),
  };
  const obs = {
    socialPreflight: vi.fn(async (_scene: string) => {
      calls.push("preflight");
    }),
    startSocial: vi.fn(
      async (
        _server: string,
        _key: string,
        _scene: string,
        beforeSettings: () => Promise<void>,
        beforeStart: () => Promise<void>,
      ) => {
        await beforeSettings();
        await beforeStart();
        calls.push("obs start");
        return true;
      },
    ),
    socialStreamStatus: vi.fn(async () => true),
    stopSocial: vi.fn(async (guard: () => Promise<void>) => {
      await guard();
      calls.push("obs stop");
      return true;
    }),
  };
  const create = () => new LiveGamesSocialBroadcast(directory, obs, () => social);
  return { broadcast: create(), create, file, calls, social, obs };
}

it("sends only the ingest to OBS, recovers the exact provider ID, and guards manual restart", async () => {
  const { broadcast, create, file, calls, social, obs } = await fixture();
  expect(await broadcast.accounts(session)).toEqual({ accounts: [account] });
  const result = await broadcast.start({ accountId: account.accountId }, session, allow, target);
  expect(result).toMatchObject({ state: "streaming", scene: "Bycoda Halay", canStop: true });
  expect(obs.startSocial).toHaveBeenCalledWith(
    destination.server,
    destination.key,
    "Bycoda Halay",
    expect.any(Function),
    expect.any(Function),
  );
  expect(JSON.stringify(result)).not.toContain(destination.key);
  expect(await readFile(file, "utf8")).not.toMatch(/private-fixture-stream-key|encoder\.example/);
  const reopened = create();
  await expect(reopened.assertManual("stop")).rejects.toThrow("Use the Social stream controls");
  await expect(reopened.stop(session, allow)).resolves.toMatchObject({ state: "idle" });
  expect(social.end).toHaveBeenCalledWith(
    session,
    expect.objectContaining({ broadcastId: "broadcast-1" }),
    expect.any(Function),
  );
  expect(calls).toEqual([
    "preflight",
    "prepare",
    "obs start",
    "platform start",
    "obs stop",
    "platform stop",
  ]);
  await expect(reopened.assertManual("start")).rejects.toThrow("set a manual OBS destination");
  await reopened.manualDestinationSaved();
  await expect(reopened.assertManual("start")).resolves.toBeUndefined();
});

it("requires exact approval and current Social permission before provisioning", async () => {
  const { broadcast, social, obs } = await fixture();
  const input = { accountId: account.accountId, scene: "Studio" };
  await expect(broadcast.start(input, session, allow)).resolves.toMatchObject({
    reason: "AUTHORITY_DENIED",
  });
  expect(obs.socialPreflight).not.toHaveBeenCalled();
  social.assertStart.mockRejectedValueOnce(new SocialLiveError("LIVE_SOCIAL_STOPPED"));
  await expect(broadcast.start(input, session, allow, target)).resolves.toMatchObject({
    reason: "AUTHORITY_DENIED",
  });
  expect(social.prepare).not.toHaveBeenCalled();
  obs.socialPreflight.mockRejectedValueOnce(new LiveGamesObsActionError("OBS_NOT_CONFIGURED"));
  await expect(broadcast.start(input, session, allow, target)).resolves.toMatchObject({
    reason: "OBS_NOT_CONFIGURED",
  });
  expect(social.prepare).not.toHaveBeenCalled();
});

it("uses a stable reason for missing credentials and does not leak an OBS error", async () => {
  const { broadcast, social, obs } = await fixture();
  const input = { accountId: account.accountId };
  social.prepare.mockRejectedValueOnce(new SocialLiveError("LIVE_MISSING_CREDENTIALS"));
  await expect(broadcast.start(input, undefined, allow)).resolves.toMatchObject({
    reason: "LIVE_CREDENTIALS_MISSING",
    canStop: false,
  });
  obs.startSocial.mockImplementationOnce(async (_server, key, _scene, apply, start) => {
    await apply();
    await start();
    throw new Error(key);
  });
  const result = await broadcast.start(input, undefined, allow);
  expect(result).toMatchObject({ state: "uncertain", reason: "START_UNCERTAIN", canStop: true });
  expect(JSON.stringify(result)).not.toContain(destination.key);
  await broadcast.start(input, undefined, allow);
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
  const pending = broadcast.start({ accountId: account.accountId }, session, allow, target);
  await preflight;
  await broadcast.cancel(session, allow);
  release();
  await expect(pending).resolves.toMatchObject({ reason: "CANCELED", canStop: false });
  expect(social.prepare).not.toHaveBeenCalled();
  await broadcast.start({ accountId: account.accountId }, session, allow, target);
  social.assertAccess.mockRejectedValue(new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE"));
  await expect(broadcast.status(session)).resolves.toEqual({ state: "idle", canStop: false });
  await expect(broadcast.stop(session, allow)).rejects.toThrow("LIVE_ACCOUNT_UNAVAILABLE");
  await expect(broadcast.stop()).resolves.toMatchObject({ state: "idle" });
});

it("requires owner reconciliation after an ambiguous provider create without a receipt", async () => {
  const { broadcast, social, obs } = await fixture();
  social.prepare.mockImplementationOnce(async (_principal, _id, _scene, guard) => {
    await guard?.();
    throw new SocialLiveError("LIVE_PLATFORM_UNCERTAIN");
  });
  const input = { accountId: account.accountId };
  await expect(broadcast.start(input, undefined, allow)).resolves.toMatchObject({
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
