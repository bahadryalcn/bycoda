import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import type { SocialPrincipal, SocialService } from "../social";
import { setBotWebhook, telegramToken, telegramWebhookSecret } from "./telegram";
import type { TokenConnectionDeps } from "./types";

const deps = (options: { stored?: string; env?: NodeJS.ProcessEnv } = {}) => {
  const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    Response.json({ ok: true, result: true }),
  );
  const social = {
    credentialFor: vi.fn(async () =>
      options.stored ? { accessToken: options.stored } : undefined,
    ),
    accountForOAuth: vi.fn(async () => ({ id: "bot", platform: "telegram", accountType: "bot" })),
  };
  const value: TokenConnectionDeps = {
    social: social as unknown as SocialService,
    env: options.env ?? {},
    http: new SocialHttp(fetcher),
    now: () => 1,
  };
  return { deps: value, fetcher, social };
};
const principal = {} as SocialPrincipal;

describe("Telegram token resolution (B31)", () => {
  it("uses the vault credential and ignores a different host env token", async () => {
    const f = deps({ stored: "111:vault", env: { BYCODA_SOCIAL_TELEGRAM_TOKEN: "222:env" } });
    await expect(telegramToken(f.deps, "bot")).resolves.toEqual({
      token: "111:vault",
      imported: false,
    });
  });

  it("imports the host env token only when no credential is stored", async () => {
    const f = deps({ env: { BYCODA_SOCIAL_TELEGRAM_TOKEN: "222:env" } });
    await expect(telegramToken(f.deps, "bot")).resolves.toEqual({
      token: "222:env",
      imported: true,
    });
  });

  it("returns nothing without a vault credential or an env token", async () => {
    await expect(telegramToken(deps().deps, "bot")).resolves.toBeUndefined();
  });
});

describe("Telegram webhook secret", () => {
  it("derives a per-account secret that never equals the bot token", () => {
    const token = "123:synthetic-token";
    const secret = telegramWebhookSecret(token, "bot");
    expect(secret).toMatch(/^[A-Za-z0-9_-]{32,256}$/);
    expect(secret).not.toContain(token);
    expect(telegramWebhookSecret(token, "bot")).toBe(secret);
    expect(telegramWebhookSecret(token, "other")).not.toBe(secret);
    expect(telegramWebhookSecret("123:rotated-token", "bot")).not.toBe(secret);
  });
});

describe("setBotWebhook", () => {
  it("registers the derived secret from the stored credential", async () => {
    const f = deps({ stored: "123:vault" });
    await setBotWebhook(f.deps, principal, "bot", "https://bycoda.example.test/hooks/telegram");
    expect(String(f.fetcher.mock.calls[0]![0]).endsWith("/setWebhook")).toBe(true);
    expect(JSON.parse(f.fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      url: "https://bycoda.example.test/hooks/telegram",
      secret_token: telegramWebhookSecret("123:vault", "bot"),
    });
  });

  it("removes the webhook when no URL is given", async () => {
    const f = deps({ stored: "123:vault" });
    await setBotWebhook(f.deps, principal, "bot", undefined);
    expect(String(f.fetcher.mock.calls[0]![0]).endsWith("/deleteWebhook")).toBe(true);
  });

  it("does not register from the env token when nothing is stored", async () => {
    const f = deps({ env: { BYCODA_SOCIAL_TELEGRAM_TOKEN: "123:env" } });
    await expect(
      setBotWebhook(f.deps, principal, "bot", "https://bycoda.example.test/hooks/telegram"),
    ).rejects.toThrow("Connect the bot before changing its webhook.");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
