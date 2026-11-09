import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchClaudeLimits } from "./limits-fetch";
import { claudeKeychainService, readClaudeKeychain } from "./limits-keychain";
import {
  fetchOpencodeLimits,
  parseJsonc,
  parseOpencodeGoUsage,
  readOpencodeGoKey,
} from "./limits-opencode";
import { clearLimitsCache, readUsageLimits } from "./limits-report";

const blob = JSON.stringify({
  claudeAiOauth: {
    accessToken: "tok-secret",
    expiresAt: Date.now() + 3_600_000,
  },
});
beforeEach(clearLimitsCache);
afterEach(() => vi.unstubAllEnvs());

it("reads the Keychain only on darwin and walks the account fallbacks", async () => {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return args.includes("claude-code-user") ? blob : null;
  };
  expect(await readClaudeKeychain(null, { platform: "win32", run })).toBeNull();
  expect(calls).toEqual([]);
  expect(await readClaudeKeychain(null, { platform: "darwin", run })).toBe(blob);
  expect(calls[0]).toEqual(["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  expect(calls).toHaveLength(3);
  expect(claudeKeychainService("/tmp/profile")).toBe("Claude Code-credentials-902e721c");
});

it("uses a Keychain token for Claude limits and stays quiet when the Keychain is empty", async () => {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
    fetched.push(init.headers.Authorization);
    return new Response(
      JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2030-01-01T00:00:00Z" },
      }),
    );
  });
  const dir = await mkdtemp(join(tmpdir(), "claude-"));
  try {
    const ok = await fetchClaudeLimits(dir, Date.now(), {
      platform: "darwin",
      run: async () => blob,
    });
    expect(ok.status).toBe("ok");
    expect(fetched).toEqual(["Bearer tok-secret"]);
    const none = await fetchClaudeLimits(dir, Date.now(), {
      platform: "darwin",
      run: async () => null,
    });
    expect(none).toMatchObject({ status: "unavailable" });
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});

it("parses OpenCode Go usage and drops unknown windows", () => {
  const parsed = parseOpencodeGoUsage({
    usage: {
      rolling: { status: "ok", percent: 25, resetsAt: 1_794_000_000 },
      weekly: { status: "weird", percent: 5 },
      monthly: { status: "rate-limited", percent: 120 },
    },
  });
  expect(parsed.windows.map((w) => [w.key, w.window.usedPercent])).toEqual([
    ["session", 25],
    ["monthly", 100],
  ]);
  expect(parsed.windows[0].window.resetsAt).toBe(1_794_000_000_000);
  expect(parseOpencodeGoUsage({}).windows).toEqual([]);
});

it("reads the OpenCode key from env auth, jsonc config and auth.json in OpenCode's order", async () => {
  expect(parseJsonc('{"a": "http://x", // c\n "b": [1,],}')).toEqual({
    a: "http://x",
    b: [1],
  });
  const dir = await mkdtemp(join(tmpdir(), "opencode-"));
  try {
    vi.stubEnv("OPENCODE_AUTH_CONTENT", "");
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", "");
    vi.stubEnv("OPENCODE_CONFIG", join(dir, "none.json"));
    vi.stubEnv("XDG_CONFIG_HOME", join(dir, "cfg"));
    vi.stubEnv("OPENCODE_DATA_DIR", dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    await writeFile(
      join(dir, "auth.json"),
      JSON.stringify({ "opencode-go": { key: " disk-key " } }),
    );
    expect(await readOpencodeGoKey()).toBe("disk-key");
    vi.stubEnv(
      "OPENCODE_CONFIG_CONTENT",
      '{"provider":{"opencode-go":{"options":{"apiKey":"{env:GO_K}"}}}}',
    );
    vi.stubEnv("GO_K", "config-key");
    expect(await readOpencodeGoKey()).toBe("config-key");
    vi.stubEnv("OPENCODE_AUTH_CONTENT", '{"openai":{}}');
    expect(await readOpencodeGoKey()).toBeNull();
    vi.stubEnv("OPENCODE_AUTH_CONTENT", '{"opencode-go":{"key":"env-key"}}');
    expect(await readOpencodeGoKey()).toBe("env-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("maps OpenCode fetch outcomes and omits the provider when it is not connected", async () => {
  const respond =
    (status: number, body = "{}") =>
    async () =>
      new Response(body, { status });
  expect(await fetchOpencodeLimits(async () => null)).toMatchObject({
    status: "unavailable",
  });
  expect(await fetchOpencodeLimits(async () => "k", respond(403) as typeof fetch)).toMatchObject({
    status: "unavailable",
  });
  expect(await fetchOpencodeLimits(async () => "k", respond(500) as typeof fetch)).toMatchObject({
    status: "error",
  });
  const good = await fetchOpencodeLimits(
    async () => "k",
    respond(
      200,
      JSON.stringify({ usage: { weekly: { status: "ok", percent: 30 } } }),
    ) as typeof fetch,
  );
  expect(good.status).toBe("ok");

  const account = [{ id: "default", label: "OpenCode Go", color: "#111" }];
  const report = (fetchAccount: Parameters<typeof readUsageLimits>[0]["fetchAccount"]) =>
    readUsageLimits({
      environmentId: "e",
      accounts: async () => ({ claude: [], codex: [], opencode: account }),
      fetchAccount,
    });
  expect(
    (await report(async () => ({ status: "unavailable", error: "x" }))).providers.map(
      (p) => p.provider,
    ),
  ).toEqual(["claude", "codex"]);
  clearLimitsCache();
  const connected = await report(async () => good);
  expect(connected.providers.map((p) => p.provider)).toEqual(["claude", "codex", "opencode"]);
  expect(connected.providers[2].cards[0].key).toBe("weekly");
});
