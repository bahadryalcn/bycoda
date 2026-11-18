import { expect, it, vi } from "vitest";
import type { SocialCredential } from "../social-credentials";
import { loadYouTubeLiveIngest, youTubeLiveSecretWriter } from "./live-secret";

it("stores ingest credentials under an opaque account and stream bound reference", async () => {
  const entries = new Map<string, SocialCredential>();
  const credentials = {
    set: async (id: string, entry: SocialCredential) => { entries.set(id, entry); },
    get: vi.fn(async (id: string) => entries.get(id)),
    delete: async (id: string) => { entries.delete(id); },
  };
  const secret = {
    streamId: "stream-a",
    rtmpUrl: "rtmps://a.rtmps.youtube.com/live2",
    streamKey: "mock-stream-key",
  };
  const credentialRef = await youTubeLiveSecretWriter(credentials, "account-a")(secret);
  expect(credentialRef).toMatch(/^youtube-live:[a-f0-9]{64}$/);
  await expect(loadYouTubeLiveIngest(
    credentials, "account-b", secret.streamId, credentialRef,
  )).resolves.toBeUndefined();
  await expect(loadYouTubeLiveIngest(
    credentials, "account-a", "stream-b", credentialRef,
  )).resolves.toBeUndefined();
  expect(credentials.get).not.toHaveBeenCalled();
  await expect(loadYouTubeLiveIngest(
    credentials, "account-a", secret.streamId, credentialRef,
  )).resolves.toEqual(secret);
});
