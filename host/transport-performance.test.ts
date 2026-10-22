import { expect, it } from "vitest";
import type { HostSession, SessionSync } from "../src/features/connections/model/protocol";
import { partialSessionSync, transcriptPage } from "./transcriptPage";
import { SyncTransfers } from "./sync-transfer";

it("opening and reconnecting to a large Unicode transcript does not replay full history", () => {
  const current = {
    session: {
      id: "s",
      blocks: Array.from({ length: 160 }, (_, index) => ({
        id: `b-${index}`,
        role: "assistant",
        text: "🧩長文".repeat(12_000),
      })),
    },
    revision: 2,
  } as HostSession;
  const page = transcriptPage(current);
  expect(Buffer.byteLength(JSON.stringify(page.value))).toBeLessThanOrEqual(1024 * 1024);
  expect(page.value.session.blocks.length).toBeLessThan(current.session.blocks.length);
  expect(page.value.history?.totalBlocks).toBe(160);
  const last = current.session.blocks[current.session.blocks.length - 1];
  const { blocks: _blocks, ...session } = current.session;
  const delta = {
    kind: "delta",
    base: 1,
    value: { ...current, session },
    blockIds: current.session.blocks.map((block) => block.id),
    blocks: [last],
  } as SessionSync;
  const partial = partialSessionSync(
    delta,
    current,
    page.value.session.blocks.map((block) => block.id),
  );
  expect(partial?.kind).toBe("delta");
  expect(Buffer.byteLength(JSON.stringify(partial))).toBeLessThan(128 * 1024);
  const unchanged = { kind: "unchanged", revision: 2 } as const;
  expect(partialSessionSync(unchanged, current, [])).toBe(unchanged);
  expect(Buffer.byteLength(JSON.stringify(unchanged))).toBeLessThan(80);
});

it("escaped multibyte transfer chunks and oversized transfer cache obey byte budgets", () => {
  const transfers = new SyncTransfers({
    inline: 1024,
    chunk: 2048,
    maxUnits: 200_000,
    cacheBytes: 400_000,
  });
  const sync = {
    kind: "snapshot",
    value: {
      revision: 1,
      session: {
        id: "s",
        blocks: [{ id: "b", role: "assistant", text: '\\"🧩長文'.repeat(4000) }],
      },
    },
  } as SessionSync;
  const response = transfers.respond("s", sync);
  expect(response.kind).toBe("chunked");
  if (response.kind !== "chunked") throw new Error("Expected chunked fixture");
  let reconstructed = "";
  while (reconstructed.length < response.length) {
    const chunk = transfers.chunk("s", response.transfer, reconstructed.length);
    expect(Buffer.byteLength(JSON.stringify(chunk.data))).toBeLessThanOrEqual(2048);
    reconstructed += chunk.data;
  }
  expect(JSON.parse(reconstructed)).toEqual(sync);
  expect(() =>
    new SyncTransfers({ inline: 10, chunk: 32, cacheBytes: 100 }).respond("s", sync),
  ).toThrow("budget");
});
