import { beforeEach, expect, it, vi } from "vitest";
import type { Attachment, QueuedMessage } from "../../sessions/model/session";
import { hasInlineQueueAttachments, storeInlineQueueAttachments } from "./queuedAttachmentStorage";

const write = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: write }));
const image = (): Attachment => ({
  id: "image",
  name: "image.png",
  kind: "image",
  mimeType: "image/png",
  size: 3,
  data: "YWJj",
});
const rows = (file: Attachment): QueuedMessage[] => [
  { id: "row", text: "keep", attachments: [file], deliveryUnknown: true, authorityGeneration: 2 },
];
beforeEach(() => write.mockReset());

it("retains bytes after a failed or blank native write and retries without changing queue authority", async () => {
  const original = rows(image());
  write
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockResolvedValueOnce(" ")
    .mockResolvedValueOnce("/saved/image.png");
  await expect(storeInlineQueueAttachments(original)).rejects.toThrow("Disk full");
  await expect(storeInlineQueueAttachments(original)).rejects.toThrow("Could not save attachment");
  expect(original[0].attachments[0].path).toBeUndefined();
  expect(original[0].attachments[0].data).toBe("YWJj");
  const prepared = await storeInlineQueueAttachments(original);
  expect(prepared[0]).toMatchObject({
    deliveryUnknown: true,
    authorityGeneration: 2,
    attachments: [{ path: "/saved/image.png", data: "YWJj" }],
  });
});

it("reuses a successful write across retries and preserves files owned by another Host", async () => {
  const file = image();
  const original = rows(file);
  write.mockResolvedValue("/saved/image.png");
  await storeInlineQueueAttachments(original);
  await storeInlineQueueAttachments(original);
  expect(write).toHaveBeenCalledOnce();
  const foreign = { ...image(), hostEnvironmentId: "other-host" };
  expect(hasInlineQueueAttachments(rows(foreign))).toBe(false);
  expect((await storeInlineQueueAttachments(rows(foreign)))[0].attachments[0]).toBe(foreign);
  expect(write).toHaveBeenCalledOnce();
});
