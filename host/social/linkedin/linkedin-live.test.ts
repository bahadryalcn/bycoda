import { describe, expect, it, vi } from "vitest";
import {
  LINKEDIN_LIVE_CONFIRM,
  LINKEDIN_LIVE_STUDIO,
} from "../../../src/integrations/social/live-linkedin";
import type { SocialAccount } from "../../../src/features/social/model/social";
import type { SocialActionContext } from "../core/social-actions";
import { linkedinLiveActions } from "./linkedin-live";

const accountId = "live-1";
const eventId = "7422345123456789012";
const streamUrl = "rtmps://live-ingest.linkedin.com:443/live/fixture-url-secret";
const streamKey = "fixture-stream-key";
const input = { accountId, eventId, streamUrl, streamKey, confirm: LINKEDIN_LIVE_CONFIRM };
const fixtureAccount: SocialAccount = {
  id: accountId,
  platform: "linkedin",
  platformId: "urn:li:person:fixture",
  accountType: "member",
  name: "Fixture",
  scopes: [],
  accessApproved: true,
  connected: true,
  connection: "oauth",
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 0,
};

function fixture() {
  const values = new Map<string, string>();
  const owner = vi.fn();
  const access = vi.fn().mockResolvedValue(fixtureAccount);
  const setting = vi.fn().mockResolvedValue("original-connection");
  const get = vi.fn(async (ref: string) => values.get(ref));
  const set = vi.fn(async (ref: string, value: string) => {
    values.set(ref, value);
  });
  const remove = vi.fn(async (ref: string) => {
    values.delete(ref);
  });
  const ctx = {
    service: { access, setting, owner },
    principal: { kind: "owner", actorId: "owner" },
    now: () => 17,
    emailSecrets: { get, set, delete: remove },
  } as unknown as SocialActionContext;
  const run = (
    action: "status" | "credentials.save" | "credentials.clear",
    value: Record<string, unknown> = { accountId },
  ) => linkedinLiveActions[`linkedin.live.${action}`]!.run(ctx, value);
  return { run, values, access, setting, owner, get, set, remove };
}

describe("LinkedIn Live custody", () => {
  it("keeps the URL and key in one vault entry and projects safe status", async () => {
    const { run, values, access } = fixture();
    await expect(run("status")).resolves.toEqual({
      state: "missing",
      studioUrl: LINKEDIN_LIVE_STUDIO,
    });
    const saved = await run("credentials.save", input);
    expect(saved).toEqual({
      state: "stored",
      studioUrl: LINKEDIN_LIVE_STUDIO,
      eventId,
      storedAt: 17,
    });
    expect(values.size).toBe(1);
    expect(JSON.parse([...values.values()][0]!)).toMatchObject({ streamUrl, streamKey });
    await expect(run("status")).resolves.toEqual(saved);
    expect(access).toHaveBeenLastCalledWith(expect.anything(), accountId, "read");
    await expect(run("credentials.clear")).resolves.toEqual({ cleared: true });
    expect(values.size).toBe(0);
  });

  it("requires the exact owner confirmation and excludes credential writes from tools", async () => {
    const { run, owner, set, remove } = fixture();
    await expect(run("credentials.save", { ...input, confirm: "yes" })).rejects.toThrow("Confirm");
    owner.mockImplementation(() => {
      throw new Error("owner required");
    });
    await expect(run("credentials.save", input)).rejects.toThrow("owner required");
    await expect(run("credentials.clear")).rejects.toThrow("owner required");
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(linkedinLiveActions["linkedin.live.credentials.save"]).toMatchObject({
      ownerOnly: true,
    });
    expect(linkedinLiveActions["linkedin.live.credentials.save"]?.tool).toBeUndefined();
    expect(linkedinLiveActions["linkedin.live.status"]).toMatchObject({
      readOnly: true,
      tool: true,
    });
  });

  it.each([
    "rtmps://ip-192-0-2-10.live-input-li.bitcod.in/live",
    "rtmp://fixture.channel.media.azure.net:1935/live/666",
  ])("accepts the documented Live Studio or legacy ingest endpoint %s", async (value) => {
    const { run } = fixture();
    await expect(run("credentials.save", { ...input, streamUrl: value })).resolves.toMatchObject({
      state: "stored",
    });
  });

  it.each([
    "https://live-ingest.linkedin.com/",
    "rtmps://live-ingest.linkedin.com.attacker.invalid/",
    "rtmps://fake.live-input-li.bitcod.in.attacker.invalid/live",
    "rtmps://user:fixture-password@live-ingest.linkedin.com/",
    "rtmp://127.0.0.1:1935/",
    "rtmps://live-ingest.linkedin.com:8080/",
  ])("rejects an invalid ingest target without disclosing its value", async (badUrl) => {
    const { run, set } = fixture();
    await expect(run("credentials.save", { ...input, streamUrl: badUrl })).rejects.toThrow(
      "Enter the RTMP or RTMPS URL from LinkedIn Live Studio.",
    );
    expect(set).not.toHaveBeenCalled();
  });

  it("invalidates a key on rebind or disconnect and denies unrelated project access before vault reads", async () => {
    const { run, access, setting, get } = fixture();
    await run("credentials.save", input);
    setting.mockResolvedValue("reconnected");
    await expect(run("status")).resolves.toMatchObject({ state: "missing" });
    access.mockResolvedValue({ ...fixtureAccount, connected: false });
    await expect(run("status")).resolves.toMatchObject({ state: "reconnect" });
    get.mockClear();
    access.mockRejectedValue(new Error("project denied"));
    await expect(run("status")).rejects.toThrow("project denied");
    expect(get).not.toHaveBeenCalled();
  });

  it("rechecks identity after vault IO and sanitizes vault errors", async () => {
    const { run, access, set, get } = fixture();
    access.mockResolvedValueOnce(fixtureAccount).mockResolvedValueOnce({
      ...fixtureAccount,
      platformId: "urn:li:person:different",
    });
    await expect(run("credentials.save", input)).resolves.toMatchObject({ state: "reconnect" });
    set.mockRejectedValue(new Error(streamKey));
    await expect(run("credentials.save", input)).rejects.toThrow(
      "LinkedIn Live credentials could not be saved.",
    );
    get.mockRejectedValue(new Error(streamUrl));
    await expect(run("status")).rejects.toThrow("LinkedIn Live credentials could not be read.");
  });
});
