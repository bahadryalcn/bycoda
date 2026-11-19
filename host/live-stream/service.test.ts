import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LiveStreamStatusSchema } from "../../src/shared/model/host-contracts/live-stream";
import type { connectTikTok } from "./connectors/tiktok";
import { LiveStreamService } from "./service";

async function fixture(tiktok?: typeof connectTikTok) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-live-stream-"));
  const credentials = new Map<string, string>();
  const options = {
    directory,
    tiktok,
    secrets: {
      get: async (key: string) => credentials.get(key),
      set: async (key: string, value: string) => {
        credentials.set(key, value);
      },
      delete: async (key: string) => {
        credentials.delete(key);
      },
    },
  };
  let service = new LiveStreamService(options);
  return {
    service: () => service,
    restart: async () => {
      await service.close();
      service = new LiveStreamService(options);
    },
    close: async () => {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it("counts demo events and preserves the finished report across restart", async () => {
  const test = await fixture();
  try {
    const status = LiveStreamStatusSchema.parse(await test.service().demo());
    expect(status.snapshot.totals.comments).toBe(24);
    expect(status.events.length).toBeGreaterThan(0);
    await test.service().stop();
    const report = await test.service().report();
    expect(report).toMatchObject({ platform: "demo", totals: { comments: 24 } });
    expect(report?.endedAt).toEqual(expect.any(Number));
    await test.restart();
    expect(await test.service().report()).toEqual(report);
  } finally {
    await test.close();
  }
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
    await expect(test.service().demo(async () => false)).rejects.toThrow(
      "permission is no longer available",
    );
    expect((await test.service().status()).connection.platform).toBe("tiktok");
  } finally {
    await test.close();
  }
});
