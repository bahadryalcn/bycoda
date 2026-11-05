import { expect, it, vi } from "vitest";
import { VoiceCloudCredentials } from "./voice-cloud-credentials";
import type { SocialCredential, SocialCredentialStore } from "../social/social-credentials";

function memory(): SocialCredentialStore & { values: Map<string, SocialCredential> } {
  const values = new Map<string, SocialCredential>();
  return {
    values,
    get: async (id) => values.get(id),
    set: async (id, credential) => void values.set(id, credential),
    delete: async (id) => void values.delete(id),
  };
}
const KEY = "sk_" + "a".repeat(40);
const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

it("verifies a key with ElevenLabs before storing it and reports only a status", async () => {
  const store = memory();
  const request = vi.fn(async () => reply(200, { voices: [] }));
  const credentials = new VoiceCloudCredentials(store, request as typeof fetch, {});
  expect(await credentials.status()).toEqual({ elevenlabs: false });
  expect(await credentials.setKey("elevenlabs", ` ${KEY} `)).toEqual({ elevenlabs: true });
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.elevenlabs.io/v1/voices?page_size=1");
  expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  expect(await credentials.get("elevenlabs")).toBe(KEY);
  expect(JSON.stringify(await credentials.status())).not.toContain(KEY);
  expect(await credentials.setKey("elevenlabs", null)).toEqual({ elevenlabs: false });
  expect(store.values.size).toBe(0);
});

it("rejects invalid or refused keys without storing them, but accepts restricted keys", async () => {
  const store = memory();
  const request = vi.fn(async () => reply(401, { detail: { status: "invalid_api_key" } }));
  const credentials = new VoiceCloudCredentials(store, request as typeof fetch, {});
  await expect(credentials.setKey("elevenlabs", "short")).rejects.toThrow("Invalid ElevenLabs");
  await expect(credentials.setKey("other", KEY)).rejects.toThrow("Unsupported");
  await expect(credentials.setKey("elevenlabs", KEY)).rejects.toThrow("rejected this API key");
  expect(store.values.size).toBe(0);
  request.mockResolvedValueOnce(reply(401, { detail: { status: "missing_permissions" } }));
  expect(await credentials.setKey("elevenlabs", KEY)).toEqual({ elevenlabs: true });
  request.mockRejectedValueOnce(new Error(`network ${KEY}`));
  const failure = await credentials.setKey("elevenlabs", KEY).catch((error: Error) => error);
  expect(String(failure)).toContain("could not be reached");
  expect(String(failure)).not.toContain(KEY);
});

it("prefers ELEVENLABS_API_KEY from the environment", async () => {
  const credentials = new VoiceCloudCredentials(memory(), fetch, {
    ELEVENLABS_API_KEY: " env-key ",
  });
  expect(await credentials.get("elevenlabs")).toBe("env-key");
  expect(await credentials.status()).toEqual({ elevenlabs: true });
});
