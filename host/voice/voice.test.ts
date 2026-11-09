import { expect, it, vi } from "vitest";
import { createRealtimeSecret, createVoiceClientSecret } from "./voice";
it("only returns temporary credential fields, never the provider response or main key", async () => {
  const request = vi.fn(async () =>
    Response.json({ value: "temporary", expires_at: 123, extra: "private" }),
  );
  expect(await createVoiceClientSecret("main-secret", request as typeof fetch)).toEqual({
    value: "temporary",
    expires_at: 123,
  });
  expect(request.mock.calls[0][0]).toBe("https://api.x.ai/v1/realtime/client_secrets");
});
it("does not echo upstream auth errors containing credentials", async () => {
  const request = vi.fn(
    async () => new Response("main-secret leaked by upstream", { status: 401 }),
  );
  await expect(createVoiceClientSecret("main-secret", request as typeof fetch)).rejects.toThrow(
    "Grok Voice authentication failed (401).",
  );
});
it("does not contact xAI without a configured key", async () => {
  const request = vi.fn();
  await expect(createVoiceClientSecret("", request)).rejects.toThrow("XAI_API_KEY");
  expect(request).not.toHaveBeenCalled();
});

const ok = () =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ value: "ephemeral", expires_at: 99, extra: "private" }),
  );
const files = (map: Record<string, unknown>) =>
  vi.fn(async (path: string) => {
    const key = Object.keys(map).find((name) => path.replaceAll("\\", "/").endsWith(name));
    if (!key) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return JSON.stringify(map[key]);
  });
const grokAuth = (expires: string) => ({
  "https://auth.x.ai::id": { key: "grok-login-token", expires_at: expires },
});

it("mints a Grok Voice credential from the Grok Build login and returns only ephemeral fields", async () => {
  const request = ok();
  const secret = await createRealtimeSecret("xai", {
    env: {},
    home: "home",
    read: files({ ".grok/auth.json": grokAuth("2999-01-01T00:00:00Z") }),
    request: request as typeof fetch,
    now: () => Date.parse("2026-10-31T00:00:00Z"),
  });
  expect(secret).toEqual({
    value: "ephemeral",
    expires_at: 99,
    model: "grok-voice-latest",
    url: "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
  });
  expect(request.mock.calls[0][0]).toBe("https://api.x.ai/v1/realtime/client_secrets");
  expect(request.mock.calls[0][1]?.headers).toMatchObject({
    Authorization: "Bearer grok-login-token",
  });
});

it("prefers the environment key and rejects an expired Grok login without contacting xAI", async () => {
  const request = ok();
  await createRealtimeSecret("xai", {
    env: { XAI_API_KEY: "env-key" },
    home: "home",
    read: files({ ".grok/auth.json": grokAuth("2000-01-01T00:00:00Z") }),
    request: request as typeof fetch,
  });
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer env-key" });
  const unused = vi.fn();
  await expect(
    createRealtimeSecret("xai", {
      env: {},
      home: "home",
      read: files({ ".grok/auth.json": grokAuth("2000-01-01T00:00:00Z") }),
      request: unused,
    }),
  ).rejects.toThrow("Open Grok Build once to refresh its sign-in");
  expect(unused).not.toHaveBeenCalled();
});

it("uses a Codex API key before its ChatGPT token, binds the model, and honors CODEX_HOME", async () => {
  const request = ok();
  const secret = await createRealtimeSecret("openai", {
    env: { CODEX_HOME: "custom" },
    home: "home",
    read: files({
      "custom/auth.json": { OPENAI_API_KEY: null, tokens: { access_token: "chatgpt-token" } },
    }),
    request: request as typeof fetch,
  });
  expect(secret.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1");
  expect(request.mock.calls[0][1]?.headers).toMatchObject({
    Authorization: "Bearer chatgpt-token",
  });
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
    expires_after: { anchor: "created_at", seconds: 60 },
    session: { type: "realtime", model: "gpt-realtime-2.1" },
  });
  const keyed = ok();
  await createRealtimeSecret("openai", {
    env: {},
    home: "home",
    read: files({
      ".codex/auth.json": { OPENAI_API_KEY: "sk-codex", tokens: { access_token: "t" } },
    }),
    request: keyed as typeof fetch,
  });
  expect(keyed.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer sk-codex" });
});

it("never echoes the login or upstream body and explains a missing sign-in", async () => {
  const leaking = vi.fn(async () => new Response("chatgpt-token is invalid", { status: 401 }));
  const failure = createRealtimeSecret("openai", {
    env: { OPENAI_API_KEY: "chatgpt-token" },
    home: "home",
    read: files({}),
    request: leaking as typeof fetch,
  });
  await expect(failure).rejects.toThrow("OpenAI Realtime sign-in was rejected (401).");
  await expect(failure).rejects.not.toThrow("chatgpt-token");
  await expect(
    createRealtimeSecret("openai", { env: {}, home: "home", read: files({}), request: vi.fn() }),
  ).rejects.toThrow("Sign in to Codex");
  await expect(createRealtimeSecret("other")).rejects.toThrow("Invalid voice provider.");
});
