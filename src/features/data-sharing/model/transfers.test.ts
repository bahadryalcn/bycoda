import { afterEach, expect, it, vi } from "vitest";
import {
  createTransferQueue,
  jsonSharingFile,
  type SharingDetails,
  type SharingMode,
  type SharingPermission,
} from "./transfers";

const details: SharingDetails = {
  kind: "diagnostics",
  destination: "https://account.test/v1/diagnostics/reports",
  files: [jsonSharingFile("diagnostics.json", { errors: [] })],
  linkedToAccount: true,
};

const fixed = (mode: SharingMode): SharingPermission => ({ load: () => mode, save: () => true });

afterEach(() => vi.useRealTimers());

it("shows the same payload before and after approval and only dismisses the current receipt", async () => {
  const queue = createTransferQueue(() => true);
  const send = vi.fn(async () => undefined);
  const first = queue.run(details, fixed("ask"), send);
  expect(send).not.toHaveBeenCalled();
  expect(queue.pending()).toMatchObject(details);
  queue.pending()?.decide(true);
  expect(await first).toBe(true);
  expect(queue.receipts()[0]).toMatchObject(details);
  queue.dismiss(queue.receipts()[0]!.id);
  expect(queue.receipts()).toHaveLength(0);
  const second = queue.run(details, fixed("ask"), send);
  queue.pending()?.decide(true);
  await second;
  expect(queue.receipts()).toHaveLength(1);
});

it("sends every time without asking again and still leaves a receipt", async () => {
  const queue = createTransferQueue(() => true);
  const send = vi.fn(async () => undefined);
  for (const kind of ["statistics", "tokens", "diagnostics"] as const) {
    const result = queue.run({ ...details, kind }, fixed("auto"), send);
    expect(queue.pending()).toBeNull();
    expect(await result).toBe(true);
  }
  expect(send).toHaveBeenCalledTimes(3);
  expect(queue.receipts()).toHaveLength(3);
});

it("does not send canceled requests or show receipts for hidden or failed uploads", async () => {
  const queue = createTransferQueue(() => false);
  const send = vi.fn(async () => undefined);
  const lifetime = new AbortController();
  const canceled = queue.run(details, fixed("ask"), send, lifetime.signal);
  lifetime.abort();
  expect(await canceled).toBe(false);
  expect(await queue.run(details, fixed("off"), send)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  const approved = queue.run(details, fixed("ask"), send);
  queue.pending()?.decide(true);
  expect(await approved).toBe(true);
  expect(queue.receipts()).toHaveLength(0);
  const visibleQueue = createTransferQueue(() => true);
  const failed = visibleQueue.run(details, fixed("ask"), async () => {
    throw new Error("offline");
  });
  visibleQueue.pending()?.decide(true);
  await expect(failed).rejects.toThrow("offline");
  expect(visibleQueue.receipts()).toHaveLength(0);
});

it("Always send persists the category mode through the review's permission", async () => {
  const queue = createTransferQueue(() => false);
  let mode: SharingMode = "ask";
  const permission: SharingPermission = {
    load: () => mode,
    save: (next) => {
      mode = next;
      return true;
    },
  };
  const result = queue.run({ ...details, kind: "statistics" }, permission, async () => undefined);
  expect(queue.pending()?.save("auto")).toBe(true);
  queue.pending()?.decide(true);
  expect(await result).toBe(true);
  expect(mode).toBe("auto");
});
