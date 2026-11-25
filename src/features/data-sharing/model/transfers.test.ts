import { afterEach, expect, it, vi } from "vitest";
import {
  createTransferQueue,
  jsonSharingFile,
  type SharingDetails,
  type SharingMode,
} from "./transfers";

const details: SharingDetails = {
  kind: "diagnostics",
  destination: "https://account.test/v1/diagnostics/reports",
  files: [jsonSharingFile("diagnostics.json", { errors: [] })],
  linkedToAccount: true,
};

afterEach(() => vi.useRealTimers());

it("shows the same payload before and after approval and only dismisses the current receipt", async () => {
  const queue = createTransferQueue(() => true);
  const send = vi.fn(async () => undefined);
  const first = queue.run(details, () => "ask", send);
  expect(send).not.toHaveBeenCalled();
  expect(queue.pending()).toMatchObject(details);
  queue.pending()?.decide(true);
  expect(await first).toBe(true);
  expect(queue.receipts()[0]).toMatchObject(details);
  queue.dismiss(queue.receipts()[0]!.id);
  expect(queue.receipts()).toHaveLength(0);
  const second = queue.run(details, () => "ask", send);
  queue.pending()?.decide(true);
  await second;
  expect(queue.receipts()).toHaveLength(1);
});

it("pauses automatic sharing while details are open and rechecks permission", async () => {
  vi.useFakeTimers();
  const queue = createTransferQueue(() => true);
  const send = vi.fn(async () => undefined);
  let mode: SharingMode = "auto";
  const result = queue.run(details, () => mode, send);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(send).not.toHaveBeenCalled();
  const unpresent = queue.present();
  queue.pending()?.inspect(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(send).not.toHaveBeenCalled();
  queue.pending()?.inspect(false);
  mode = "off";
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toBe(false);
  expect(send).not.toHaveBeenCalled();
  unpresent();
});

it("does not send canceled requests or show receipts for hidden or failed uploads", async () => {
  const queue = createTransferQueue(() => false);
  const send = vi.fn(async () => undefined);
  const lifetime = new AbortController();
  const canceled = queue.run(details, () => "ask", send, lifetime.signal);
  lifetime.abort();
  expect(await canceled).toBe(false);
  expect(await queue.run(details, () => "off", send)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  const approved = queue.run(details, () => "ask", send);
  queue.pending()?.decide(true);
  expect(await approved).toBe(true);
  expect(queue.receipts()).toHaveLength(0);
  const visibleQueue = createTransferQueue(() => true);
  const failed = visibleQueue.run(
    details,
    () => "ask",
    async () => {
      throw new Error("offline");
    },
  );
  visibleQueue.pending()?.decide(true);
  await expect(failed).rejects.toThrow("offline");
  expect(visibleQueue.receipts()).toHaveLength(0);
});
