import { expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { facebookLiveApi } from "../../../src/integrations/social/adapters/facebook-live";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialCredential } from "../social-credentials";
import { createFacebookLiveActions } from "./actions";
import { readLiveEncoder } from "./receipts";

const account: SocialAccount = {
  id: "account",
  platform: "facebook",
  accountType: "page",
  connection: "oauth",
  platformId: "123",
  name: "Page",
  connected: true,
  paused: false,
  accessApproved: true,
  executorId: "host",
  scopes: ["pages_manage_posts", "publish_video"],
  grants: {},
  createdAt: 1,
};
const key = "synthetic-stream-key";

function fixtures(fetcher: typeof fetch) {
  const settings = new Map<string, string>();
  const credentials = new Map<string, SocialCredential>();
  const service = {
    access: vi.fn(async () => account),
    owner: vi.fn(),
    credentialFor: vi.fn(async () => ({ accessToken: "page-test-token" })),
    setting: async (name: string) => settings.get(name),
    setSetting: async (name: string, value: string) => {
      settings.set(name, value);
    },
    assertSendable: vi.fn(async () => undefined),
  };
  const vault = {
    get: async (name: string) => credentials.get(name),
    set: async (name: string, value: SocialCredential) => {
      credentials.set(name, value);
    },
    delete: async (name: string) => {
      credentials.delete(name);
    },
  };
  const ctx: SocialActionContext = {
    service: service as unknown as SocialActionContext["service"],
    store: {} as SocialActionContext["store"],
    now: () => 1000,
    principal: { kind: "owner", actorId: "owner", provider: "owner" },
    operationId: "test",
    facebookLive: { environmentId: "host", credentials: vault },
  };
  const actions = createFacebookLiveActions(() =>
    facebookLiveApi(new SocialHttp(fetcher), "v25.0"),
  );
  return {
    settings,
    service,
    vault,
    run: (action: string, input: Record<string, unknown>) =>
      actions[action].run(ctx, { accountId: "account", ...input }),
  };
}

const create = { title: "Demo Live", confirm: "CREATE_FACEBOOK_LIVE" };
const end = { liveId: "456", confirm: "END_FACEBOOK_LIVE" };

it("stores the encoder separately, keeps tool receipts safe and clears it after ending", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () =>
      Response.json({
        id: "456",
        secure_stream_url: `rtmps://live-api-s.facebook.com/rtmp/${key}`,
      }),
    )
    .mockImplementationOnce(async () =>
      Response.json({ id: "456", status: "LIVE", from: { id: "123" } }),
    )
    .mockImplementationOnce(async () => Response.json({ success: true }));
  const f = fixtures(fetcher);
  await expect(f.run("facebook.live.create", create)).resolves.toMatchObject({
    id: "456",
    encoderReady: true,
  });
  const listed = await f.run("facebook.live.list", {});
  expect(JSON.stringify(listed)).not.toContain(key);
  expect(JSON.stringify([...f.settings.values()])).not.toContain(key);
  await expect(readLiveEncoder(f.service, f.vault, "account", "123", "456")).resolves.toEqual({
    server: "rtmps://live-api-s.facebook.com/rtmp/",
    streamKey: key,
  });
  await expect(f.run("facebook.live.end", end)).resolves.toMatchObject({
    phase: "ended",
    encoderReady: false,
  });
  await expect(f.run("facebook.live.end", end)).resolves.toMatchObject({ phase: "ended" });
  await expect(readLiveEncoder(f.service, f.vault, "account", "123", "456")).rejects.toMatchObject({
    code: "denied",
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("holds an uncertain broadcast creation without issuing a second request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("timeout"));
  const f = fixtures(fetcher);
  await expect(f.run("facebook.live.create", create)).rejects.toMatchObject({ code: "unknown" });
  await expect(f.run("facebook.live.create", create)).resolves.toMatchObject({ phase: "creating" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
