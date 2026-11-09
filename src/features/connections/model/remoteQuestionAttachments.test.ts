import { beforeEach, expect, it, vi } from "vitest";
const upload = vi.hoisted(() => vi.fn());
vi.mock("./remoteAttachments", () => ({ uploadRemoteAttachments: upload }));
import { uploadQuestionAttachments } from "./remoteQuestionAttachments";
beforeEach(() => {
  upload.mockReset();
});
it("uploads once with exact machine identity and replaces local paths per question", async () => {
  const file = {
    id: "first",
    name: "a.txt",
    mimeType: "text/plain",
    kind: "file" as const,
    size: 1,
  };
  const image = {
    ...file,
    id: "second",
    name: "b.png",
    mimeType: "image/png",
    kind: "image" as const,
  };
  const local = [
    { ...file, path: "C:\\a.txt" },
    { ...image, path: "C:\\b.png" },
  ];
  const options = { environmentId: "execution-host", ownershipSource: "question:stable-command" };
  upload.mockResolvedValue([file, image]);
  expect(
    await uploadQuestionAttachments(
      "machine-1",
      { kind: "answered", answers: {}, attachments: { a: [local[0]], b: [local[1]] } },
      options,
    ),
  ).toEqual({ kind: "answered", answers: {}, attachments: { a: [file], b: [image] } });
  expect(upload).toHaveBeenCalledExactlyOnceWith("machine-1", local, options);
});
it("keeps skipped and text-only replies off the upload transport", async () => {
  expect(await uploadQuestionAttachments("host", { kind: "skipped" }, {})).toEqual({
    kind: "skipped",
  });
  expect(await uploadQuestionAttachments("host", { kind: "answered", answers: {} }, {})).toEqual({
    kind: "answered",
    answers: {},
  });
  expect(upload).not.toHaveBeenCalled();
});
it("fails preparation before answer dispatch when upload fails", async () => {
  upload.mockRejectedValue(new Error("offline"));
  await expect(
    uploadQuestionAttachments(
      "host",
      { kind: "answered", answers: {}, attachments: { q: [] } },
      {},
    ),
  ).rejects.toThrow("offline");
});
