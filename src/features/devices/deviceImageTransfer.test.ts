import { expect, it, vi } from "vitest";
import {
  DeviceImageTransferReceipts,
  type DeviceImageTransferOperation,
} from "./deviceImageTransfer";

const operation: DeviceImageTransferOperation = {
  id: "operation",
  sourceWindow: "tools",
  destinationWindow: "main",
  cwd: "/project",
  sessionId: "session",
  fingerprint: "a".repeat(64),
};

it("binds receipts to source, destination, conversation and payload without retaining image bytes", () => {
  const receipts = new DeviceImageTransferReceipts();
  const receive = vi.fn(() => true);
  expect(receipts.apply(operation, receive)).toBe("accepted");
  expect(receipts.apply(structuredClone(operation), receive)).toBe("accepted");
  for (const changed of [
    { sourceWindow: "other" },
    { destinationWindow: "other" },
    { cwd: "/other" },
    { sessionId: "other" },
    { fingerprint: "b".repeat(64) },
  ])
    expect(receipts.apply({ ...operation, ...changed }, receive)).toBe("conflict");
  expect(receive).toHaveBeenCalledOnce();
});

it("keeps accepted receipts at capacity and refuses new effects without evicting duplicate protection", () => {
  const receipts = new DeviceImageTransferReceipts(1);
  const receive = vi.fn(() => true);
  expect(receipts.apply(operation, receive)).toBe("accepted");
  expect(receipts.apply({ ...operation, id: "new" }, receive)).toBe("rejected");
  expect(receipts.find(operation)).toBe("accepted");
  expect(receipts.apply(operation, receive)).toBe("accepted");
  expect(receive).toHaveBeenCalledOnce();
});

it("distinguishes definite refusal from receiver failure after a possible draft mutation", () => {
  const receipts = new DeviceImageTransferReceipts();
  const receive = vi.fn(() => {
    throw new Error("changed draft before failure");
  });
  expect(receipts.apply(operation, receive)).toBe("unknown");
  expect(receipts.apply(operation, receive)).toBe("unknown");
  expect(receive).toHaveBeenCalledOnce();
  expect(receipts.apply({ ...operation, id: "refused" }, () => false)).toBe("rejected");
});
