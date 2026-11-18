import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LiveGamesStatusSchema } from "../../src/shared/model/host-contracts/live-games";
import type { connectTikTok } from "./connectors/tiktok";
import { handleLiveGamesHttp } from "./http";
import { LiveGamesService } from "./service";

async function fixture(tiktok?: typeof connectTikTok) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-live-games-"));
  const credentials = new Map<string, string>();
  let port = 0;
  const options = {
    directory, port: () => port, tiktok,
    secrets: {
      get: async (key: string) => credentials.get(key),
      set: async (key: string, value: string) => { credentials.set(key, value); },
      delete: async (key: string) => { credentials.delete(key); },
    },
  };
  let service = new LiveGamesService(options);
  const server = createServer((req, res) => {
    void handleLiveGamesHttp(service, req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    }).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address missing.");
  port = address.port;
  return {
    service: () => service,
    restart: async () => { await service.close(); service = new LiveGamesService(options); },
    close: async () => {
      await service.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it("streams token-scoped demo snapshots and preserves the finished report across restart", async () => {
  const test = await fixture();
  try {
    const status = LiveGamesStatusSchema.parse(await test.service().demo());
    expect(status.snapshot.dancers).toHaveLength(24);
    const page = await fetch(status.overlayUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain("overlay.js");
    const fake = new URL(status.overlayUrl);
    fake.pathname = "/live-games/" + "a".repeat(43) + "/";
    expect((await fetch(fake)).status).toBe(404);
    expect((await fetch(status.overlayUrl, { headers: { "X-Forwarded-For": "192.0.2.1" } })).status)
      .toBe(404);
    const events = await fetch(new URL("events", status.overlayUrl));
    const reader = events.body!.getReader();
    try {
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toContain("event: active\ndata: true");
      expect(first).toContain("event: snapshot");
    } finally { await reader.cancel(); }
    await test.service().stop();
    const report = await test.service().report();
    expect(report).toMatchObject({ platform: "demo", totals: { joins: 24 } });
    expect(report?.endedAt).toEqual(expect.any(Number));
    await test.restart();
    expect(await test.service().report()).toEqual(report);
    expect((await test.service().status()).overlayUrl).toBe(status.overlayUrl);
  } finally { await test.close(); }
});

it("fences a cancelled TikTok attachment and rejects a revoked mutation", async () => {
  const close = vi.fn();
  const tiktok = vi.fn<typeof connectTikTok>(() => close);
  const test = await fixture(tiktok);
  try {
    expect((await test.service().start("@kanal")).connection.status).toBe("connecting");
    const callbacks = tiktok.mock.calls[0][2];
    callbacks.connected("1");
    callbacks.disconnected(new Error("The live has ended."));
    expect((await test.service().status()).connection.status).toBe("offline");
    await test.service().stop();
    callbacks.connected("stale");
    expect(close).toHaveBeenCalled();
    expect((await test.service().status()).connection.status).toBe("idle");
    await expect(test.service().setConfig({ capacity: 5 }, async () => false))
      .rejects.toThrow("permission is no longer available");
    expect((await test.service().status()).config.capacity).toBe(120);
  } finally { await test.close(); }
});
