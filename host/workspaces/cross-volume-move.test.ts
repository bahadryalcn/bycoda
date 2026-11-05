import { beforeEach, expect, it, vi } from "vitest";
import { crossVolumeMove } from "./cross-volume-move";
import { loadBundledGuardedMove } from "../host-notes-admission";

vi.mock("../host-notes-admission", () => ({ loadBundledGuardedMove: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("returns the native worker's recovery outcome", async () => {
  const result = {
    path: "/dst/file",
    recoveryPath: "/src/recovery/source",
    receiptPath: "/src/recovery/receipt.json",
  };
  const worker = vi.fn().mockResolvedValue(result);
  vi.mocked(loadBundledGuardedMove).mockReturnValue(worker);
  await expect(crossVolumeMove("/src/file", "/dst/file")).resolves.toEqual(result);
  expect(worker).toHaveBeenCalledWith("/src/file", "/dst/file");
});

it("fails before a move when the verified addon lacks the capability", async () => {
  vi.mocked(loadBundledGuardedMove).mockImplementation(() => {
    throw new Error("unsupported");
  });
  await expect(crossVolumeMove("/src/file", "/dst/file")).rejects.toThrow("unsupported");
});
