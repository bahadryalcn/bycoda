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

const giftViewer = { id: "7", handle: "ayse", name: "Ayse" };
const gift = (id: string, count: number) => ({
  id,
  at: 1,
  kind: "gift" as const,
  viewer: giftViewer,
  giftId: 1,
  giftName: "Rose",
  diamonds: 10,
  count,
});

it("keeps totals and top gifters across a reconnect and does not recount a replayed streak end", async () => {
  vi.useFakeTimers();
  const tiktok = vi.fn<typeof connectTikTok>(() => () => {});
  const test = await fixture(tiktok);
  try {
    await test.service().start("kanal");
    const first = tiktok.mock.calls[0][2];
    first.connected("1");
    first.event(gift("gift:1", 3));
    first.event(gift("gift:1", 3));
    first.disconnected(new Error("socket closed"));
    expect((await test.service().status()).connection.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tiktok).toHaveBeenCalledTimes(2);
    const second = tiktok.mock.calls[1][2];
    second.connected("1");
    second.event(gift("gift:1", 3));
    second.event(gift("gift:2", 2));
    const status = await test.service().status();
    expect(status.connection).toMatchObject({ status: "connected", attempts: 0 });
    expect(status.snapshot.totals).toMatchObject({ diamonds: 50, gifts: 5 });
    expect(status.snapshot.topGifters).toMatchObject([{ id: "7", diamonds: 50 }]);
    await test.service().stop();
    expect(await test.service().report()).toMatchObject({
      totals: { diamonds: 50, gifts: 5 },
      endedAt: expect.any(Number),
    });
  } finally {
    await test.close();
    vi.useRealTimers();
  }
});

it("stops generating demo events once stopped", async () => {
  vi.useFakeTimers();
  const test = await fixture();
  try {
    await test.service().demo();
    await vi.advanceTimersByTimeAsync(2_100);
    const running = (await test.service().status()).snapshot.totals;
    await test.service().stop();
    const stopped = (await test.service().status()).snapshot.totals;
    await vi.advanceTimersByTimeAsync(5_000);
    const later = (await test.service().status()).snapshot.totals;
    expect(stopped).toEqual(later);
    expect(running.comments + running.likes).toBeGreaterThan(24);
    expect((await test.service().status()).connection.status).toBe("idle");
  } finally {
    await test.close();
    vi.useRealTimers();
  }
});
