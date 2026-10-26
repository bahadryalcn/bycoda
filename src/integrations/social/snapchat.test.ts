import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import { createSnapchatAdapter, snapchatContentIssue } from "./snapchat";

const actorId = "11111111-1111-1111-1111-111111111111";
const mediaId = "22222222-2222-2222-2222-222222222222";
const spotlightId = "W7_example-posted-spotlight-id";
const account: SocialAccount = {
  id: "a",
  platform: "snapchat",
  platformId: actorId,
  name: "Bycoda",
  accountType: "public_profile",
  scopes: ["snapchat-profile-api"],
  connected: true,
  accessApproved: true,
  paused: false,
  connection: "oauth",
  executorId: "host",
  grants: {},
  createdAt: 1,
};
const job = (): SocialJob => ({
  id: "j",
  operationId: "op",
  dedupeKey: "d",
  accountId: "a",
  projectIds: ["p"],
  provider: "owner",
  actorId: "owner",
  kind: "publish",
  payload: {
    text: "Hello #Bycoda",
    media: [{ kind: "video", uploadId: "owner-upload" }],
    snapchat: { target: "spotlight", locale: "tr_TR", durationSeconds: 6, width: 540, height: 960 },
  },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
const mp4 = (size = 24) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  return bytes;
};
function fixture() {
  let status = "SUBMITTED",
    returnedActor = actorId,
    returnedSpotlight: string | undefined = spotlightId;
  let at = 1000,
    addPath: string | undefined,
    readActor = actorId,
    subStatus = "SUCCESS";
  const parts: FormData[] = [],
    checkpoints: NonNullable<SocialJob["preparation"]>[] = [];
  const checkpoint = vi.fn(async (state: NonNullable<SocialJob["preparation"]>) => {
    checkpoints.push(structuredClone(state));
  });
  const fetcher = vi.fn(async (raw: unknown, options?: RequestInit) => {
    const url = new URL(String(raw)),
      path = url.pathname;
    expect(url.origin).toBe("https://businessapi.snapchat.com");
    const ok = (value: Record<string, unknown>) =>
      Response.json({ request_status: "SUCCESS", ...value });
    if (path.endsWith("/my_profile")) return ok({ public_profile: { id: returnedActor } });
    if (path === `/v1/public_profiles/${actorId}/media`)
      return ok({
        media_id: mediaId,
        add_path: addPath ?? `/us/v1/public_profiles/${actorId}/media/${mediaId}/multipart-upload`,
        finalize_path: `/us/v1/public_profiles/${actorId}/media/${mediaId}/multipart-upload`,
      });
    if (path.endsWith("/multipart-upload")) {
      parts.push(options!.body as FormData);
      return ok({});
    }
    if (path === `/v1/public_profiles/${actorId}/spotlights`)
      return ok({ spotlight_id: returnedSpotlight });
    if (path === `/v1/public_profiles/${actorId}/spotlights/${spotlightId}`)
      return ok({
        spotlights: [
          {
            sub_request_status: subStatus,
            spotlight: { id: spotlightId, profile_id: readActor, status },
          },
        ],
      });
    throw new Error("Unexpected network path");
  });
  const adapter = createSnapchatAdapter(new SocialHttp(fetcher), () => at);
  return {
    adapter,
    fetcher,
    checkpoint,
    checkpoints,
    parts,
    live: () => {
      status = "LIVE";
    },
    reject: () => {
      status = "REJECTED";
    },
    identity: (value: string) => {
      returnedActor = value;
    },
    noReceipt: () => {
      returnedSpotlight = undefined;
    },
    uploadTo: (value: string) => {
      addPath = value;
    },
    receiptActor: (value: string) => {
      readActor = value;
    },
    partialReceipt: () => {
      subStatus = "PARTIAL";
    },
    clock: (value: number) => {
      at = value;
    },
  };
}
const count = (f: ReturnType<typeof fixture>, suffix: string) =>
  f.fetcher.mock.calls.filter(([raw]) => new URL(String(raw)).pathname.endsWith(suffix)).length;

describe("Snapchat Public Profile API Spotlight", () => {
  it("encrypts owner bytes with AES-256-CBC, uploads/finalizes and confirms the exact LIVE Spotlight under its actor", async () => {
    const f = fixture();
    f.live();
    const current = job(),
      bytes = mp4();
    const beforeSubmit = vi.fn(async () => {
      expect(f.checkpoints[0].snapchatMedia?.mediaId).toBe(mediaId);
    });
    expect(
      await f.adapter.send(
        account,
        current,
        "token",
        async () => bytes,
        f.checkpoint,
        beforeSubmit,
      ),
    ).toEqual({ platformId: spotlightId });
    const create = f.fetcher.mock.calls.find(([raw]) => String(raw).endsWith(`/${actorId}/media`))!;
    const metadata = JSON.parse(create[1]!.body as string);
    expect(metadata.type).toBe("VIDEO");
    const keyBytes = Uint8Array.from(atob(metadata.key), (character) => character.charCodeAt(0));
    const iv = Uint8Array.from(atob(metadata.iv), (character) => character.charCodeAt(0));
    expect(keyBytes.length).toBe(32);
    expect(iv.length).toBe(16);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
    const file = f.parts[0].get("file") as Blob;
    expect(
      new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, await file.arrayBuffer()),
      ),
    ).toEqual(bytes);
    expect(f.parts.map((part) => part.get("action"))).toEqual(["ADD", "FINALIZE"]);
    expect(f.parts[0].get("part_number")).toBe("1");
    expect(f.checkpoints).toHaveLength(2);
    expect(Object.keys(f.checkpoints[0].snapchatMedia!)).toEqual([
      "actorId",
      "signature",
      "mediaId",
      "createdAt",
    ]);
    expect(f.checkpoints[1].snapchatMedia?.spotlightId).toBe(spotlightId);
    expect(JSON.stringify(f.checkpoints)).not.toContain(metadata.key);
    expect(JSON.stringify(f.checkpoints)).not.toContain(metadata.iv);
    const post = f.fetcher.mock.calls.find(([raw]) =>
      String(raw).endsWith(`/${actorId}/spotlights`),
    )!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      media_id: mediaId,
      locale: "tr_TR",
      description: "Hello #Bycoda",
    });
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
  });
  it("splits encrypted upload bytes into 32 MiB parts before FINALIZE", async () => {
    const f = fixture();
    f.live();
    await f.adapter.send(account, job(), "token", async () => mp4(32 * 1024 * 1024), f.checkpoint);
    expect(f.parts.map((part) => part.get("action"))).toEqual(["ADD", "ADD", "FINALIZE"]);
    expect((f.parts[0].get("file") as Blob).size).toBe(32 * 1024 * 1024);
    expect((f.parts[1].get("file") as Blob).size).toBe(16);
    expect(f.parts[1].get("part_number")).toBe("2");
  });
  it("checkpoints SUBMITTED and uses read-only status on retry without repeating upload or publication", async () => {
    const f = fixture(),
      current = job(),
      read = vi.fn(async () => mp4());
    await expect(
      f.adapter.send(account, current, "token", read, f.checkpoint),
    ).rejects.toMatchObject({ code: "processing", retryAt: 61_000 });
    expect(current.preparation?.snapchatMedia?.spotlightId).toBe(spotlightId);
    f.live();
    f.clock(1000 + 25 * 60 * 60_000);
    const beforeSubmit = vi.fn();
    expect(
      await f.adapter.send(account, current, "token", read, f.checkpoint, beforeSubmit),
    ).toEqual({ platformId: spotlightId });
    expect(count(f, "/media")).toBe(1);
    expect(count(f, "/spotlights")).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(beforeSubmit).not.toHaveBeenCalled();
  });
  it("awaits exact posted-ID persistence before the first processing/status read", async () => {
    const f = fixture();
    f.live();
    const current = job();
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkpoint = vi.fn(async (state: NonNullable<SocialJob["preparation"]>) => {
      if (state.snapchatMedia?.spotlightId) await persisted;
    });
    const send = f.adapter.send(account, current, "token", async () => mp4(), checkpoint);
    await vi.waitFor(() =>
      expect(checkpoint.mock.calls.some(([state]) => !!state.snapchatMedia?.spotlightId)).toBe(
        true,
      ),
    );
    expect(count(f, `/${spotlightId}`)).toBe(0);
    release();
    await expect(send).resolves.toEqual({ platformId: spotlightId });
  });
  it("preserves finalized preparation after revoked final authority and reuses it only after fresh authorization", async () => {
    const f = fixture();
    f.live();
    const current = job(),
      read = vi.fn(async () => mp4());
    await expect(
      f.adapter.send(account, current, "token", read, f.checkpoint, async () => {
        throw new Error("Revoked");
      }),
    ).rejects.toThrow("Revoked");
    expect(current.preparation?.snapchatMedia?.mediaId).toBe(mediaId);
    expect(count(f, "/spotlights")).toBe(0);
    await f.adapter.send(account, current, "token", read, f.checkpoint, async () => {});
    expect(read).toHaveBeenCalledTimes(1);
    expect(count(f, "/media")).toBe(1);
    expect(count(f, "/spotlights")).toBe(1);
  });
  it("does not publish if finalized upload checkpoint persistence fails", async () => {
    const f = fixture();
    await expect(
      f.adapter.send(
        account,
        job(),
        "token",
        async () => mp4(),
        async () => {
          throw new Error("Store failed");
        },
      ),
    ).rejects.toThrow("Store failed");
    expect(count(f, "/spotlights")).toBe(0);
  });
  it("requires durable checkpoint support before preparing a new irreversible submission", async () => {
    const f = fixture();
    await expect(f.adapter.send(account, job(), "token", async () => mp4())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects an expired media container instead of silently uploading and publishing a replacement", async () => {
    const f = fixture(),
      current = job();
    await expect(
      f.adapter.send(
        account,
        current,
        "token",
        async () => mp4(),
        f.checkpoint,
        async () => {
          throw new Error("Hold");
        },
      ),
    ).rejects.toThrow("Hold");
    f.clock(1000 + 24 * 60 * 60_000);
    await expect(
      f.adapter.send(account, current, "token", async () => mp4(), f.checkpoint),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(count(f, "/media")).toBe(1);
    expect(count(f, "/spotlights")).toBe(0);
  });
  it("refuses to reuse another content revision's preparation", async () => {
    const f = fixture(),
      current = job();
    await expect(
      f.adapter.send(
        account,
        current,
        "token",
        async () => mp4(),
        f.checkpoint,
        async () => {
          throw new Error("Hold");
        },
      ),
    ).rejects.toThrow("Hold");
    current.payload.text = "Different reviewed text";
    const calls = f.fetcher.mock.calls.length;
    await expect(
      f.adapter.send(account, current, "token", async () => mp4(), f.checkpoint),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
  });
  it("rejects a different authenticated profile before uploading bytes", async () => {
    const f = fixture();
    f.identity(mediaId);
    const read = vi.fn(async () => mp4());
    await expect(f.adapter.send(account, job(), "token", read, f.checkpoint)).rejects.toMatchObject(
      { code: "denied" },
    );
    expect(read).not.toHaveBeenCalled();
    expect(count(f, "/media")).toBe(0);
  });
  it.each([
    "https://attacker.invalid/upload",
    "//attacker.invalid/upload",
    `/us/v1/public_profiles/${mediaId}/media/${mediaId}/multipart-upload`,
    `/us/v1/public_profiles/${actorId}/media/${mediaId}/multipart-upload?token=leak`,
  ])("does not follow an unbound upload path %s", async (path) => {
    const f = fixture();
    f.uploadTo(path);
    await expect(
      f.adapter.send(account, job(), "token", async () => mp4(), f.checkpoint),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.parts).toHaveLength(0);
    expect(count(f, "/spotlights")).toBe(0);
  });
  it("does not treat a successful request acknowledgement without Spotlight ID as publication", async () => {
    const f = fixture();
    f.noReceipt();
    await expect(
      f.adapter.send(account, job(), "token", async () => mp4(), f.checkpoint),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(count(f, `/${spotlightId}`)).toBe(0);
  });
  it.each(["wrong-actor", "partial", "rejected"])(
    "does not report a LIVE result from %s receipt",
    async (variant) => {
      const f = fixture();
      f.live();
      if (variant === "wrong-actor") f.receiptActor(mediaId);
      else if (variant === "partial") f.partialReceipt();
      else f.reject();
      await expect(
        f.adapter.send(account, job(), "token", async () => mp4(), f.checkpoint),
      ).rejects.toMatchObject({ code: variant === "rejected" ? "rejected" : "unknown" });
    },
  );
  it("reconciles only the checkpointed profile/Spotlight and never resends", async () => {
    const f = fixture(),
      current = job();
    await expect(
      f.adapter.send(account, current, "token", async () => mp4(), f.checkpoint),
    ).rejects.toMatchObject({ code: "processing" });
    f.live();
    const calls = f.fetcher.mock.calls.length;
    expect(await f.adapter.reconcile!(account, current, "token")).toEqual({
      platformId: spotlightId,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(calls + 1);
    expect(count(f, "/spotlights")).toBe(1);
    current.payload.text = "Changed";
    expect(await f.adapter.reconcile!(account, current, "token")).toBeUndefined();
    expect(f.fetcher).toHaveBeenCalledTimes(calls + 1);
  });
  it.each(["story", "missing-locale", "short-video", "remote-media", "wrong-profile-id"])(
    "blocks %s before network or upload",
    async (variant) => {
      const f = fixture(),
        current = job(),
        actor = { ...account };
      if (variant === "story") current.payload.snapchat!.target = "story";
      if (variant === "missing-locale") delete current.payload.snapchat!.locale;
      if (variant === "short-video") current.payload.snapchat!.durationSeconds = 5;
      if (variant === "remote-media")
        current.payload.media = [{ kind: "video", url: "https://example.com/video.mp4" }];
      if (variant === "wrong-profile-id")
        actor.platformId = `web:snapchat:public_profile:${actorId}`;
      expect(snapchatContentIssue(actor, current)).toBeTruthy();
      await expect(
        f.adapter.send(actor, current, "token", async () => mp4(), f.checkpoint),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
});
