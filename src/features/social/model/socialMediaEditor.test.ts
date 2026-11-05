import { expect, it, vi } from "vitest";
import { SocialMediaEditor } from "./socialMediaEditor";
import type { SocialClient } from "./socialClient";

it("transfers the original upload before disclosing an editor attachment", async () => {
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>(async (_action, input) => ({
    mediaId: input.mediaId,
    editorId: input.editorId,
    revision: input.expectedRevision + 1,
  }));
  const editor = new SocialMediaEditor({ mediaClaim, mediaInspect: vi.fn() });
  const upload = {
    uploadId: "media",
    managed: { mediaId: "media", uploadClaimId: "media", revision: 1 },
  };
  expect(await editor.adoptUpload(upload)).toEqual(upload);
  expect(mediaClaim).toHaveBeenCalledWith(
    "transfer",
    expect.objectContaining({ mediaId: "media", editorId: editor.editorId, expectedRevision: 1 }),
  );
  await editor.release("media");
  expect(mediaClaim).toHaveBeenLastCalledWith(
    "releaseLogical",
    expect.objectContaining({ mediaId: "media", editorId: editor.editorId, expectedRevision: 2 }),
  );
});

it("does not acquire an upload after its editor closes", async () => {
  const mediaClaim = vi.fn();
  const editor = new SocialMediaEditor({ mediaClaim, mediaInspect: vi.fn() });
  editor.close();
  await editor.adoptUpload({
    uploadId: "m",
    managed: { mediaId: "m", uploadClaimId: "m", revision: 1 },
  });
  expect(mediaClaim).not.toHaveBeenCalled();
});

it("does not release a different editor's claim", async () => {
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>(async (_action, input) => ({
    mediaId: input.mediaId,
    editorId: input.editorId,
    revision: input.expectedRevision + 1,
  }));
  const first = new SocialMediaEditor({ mediaClaim, mediaInspect: vi.fn() }),
    copy = new SocialMediaEditor({ mediaClaim, mediaInspect: vi.fn() });
  await first.claim("m", 1);
  await copy.claim("m", 2);
  await first.release("m");
  expect(mediaClaim).toHaveBeenLastCalledWith(
    "releaseLogical",
    expect.objectContaining({ editorId: first.editorId }),
  );
  expect(first.editorId).not.toBe(copy.editorId);
});

it("does not publish a late upload after the editor source changes", async () => {
  let resolveUpload!: (value: { uploadId: string }) => void;
  const upload = vi.fn(
    () =>
      new Promise<{ uploadId: string }>((resolve) => {
        resolveUpload = resolve;
      }),
  );
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>();
  const mediaInspect = vi.fn<SocialClient["mediaInspect"]>();
  const editor = new SocialMediaEditor({ mediaClaim, mediaInspect });
  const { uploadForSocialEditor } = await import("./socialMediaEditor");
  const client = { upload, uploadVideo: vi.fn() } as unknown as SocialClient;
  const pending = uploadForSocialEditor(editor, client, { type: "image/png" } as File);
  editor.invalidate();
  resolveUpload({ uploadId: "late" });
  await expect(pending).rejects.toThrow("changed");
  expect(mediaClaim).not.toHaveBeenCalled();
});

it("closes only its own pending claim and retains it when release cannot be confirmed", async () => {
  let settle!: (value: { mediaId: string; editorId: string; revision: number }) => void;
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const mediaInspect = vi
    .fn<SocialClient["mediaInspect"]>()
    .mockRejectedValue(new Error("offline"));
  const editor = new SocialMediaEditor({ mediaClaim, mediaInspect });
  const pending = editor.adoptUpload({
    uploadId: "m",
    managed: { mediaId: "m", uploadClaimId: "m", revision: 1 },
  });
  await Promise.resolve();
  editor.close();
  settle({ mediaId: "m", editorId: editor.editorId, revision: 2 });
  await pending;
  expect(mediaClaim).toHaveBeenCalledTimes(1);
});

it("awaits a separate copy claim and coalesces concurrent acquisition", async () => {
  const mediaInspect = vi
    .fn<SocialClient["mediaInspect"]>()
    .mockResolvedValue({ mediaId: "m", managed: true, revision: 4 });
  let finish!: (value: { mediaId: string; editorId: string; revision: number }) => void;
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>(
    (_action, input) =>
      new Promise((resolve) => {
        finish = () => resolve({ mediaId: input.mediaId, editorId: input.editorId, revision: 5 });
      }),
  );
  const copy = new SocialMediaEditor({ mediaClaim, mediaInspect });
  let published = false;
  const first = copy.claimExisting("m").then(() => {
    published = true;
  });
  const second = copy.claimExisting("m");
  await Promise.resolve();
  await Promise.resolve();
  expect(published).toBe(false);
  expect(mediaClaim).toHaveBeenCalledTimes(1);
  finish({ mediaId: "m", editorId: copy.editorId, revision: 5 });
  await Promise.all([first, second]);
  expect(published).toBe(true);
});

it("does not publish a copy when claim admission fails", async () => {
  const mediaInspect = vi
    .fn<SocialClient["mediaInspect"]>()
    .mockResolvedValue({ mediaId: "m", managed: true, revision: 2 });
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>().mockRejectedValue(new Error("denied"));
  const editor = new SocialMediaEditor({ mediaInspect, mediaClaim });
  await expect(editor.claimExisting("m")).rejects.toThrow("denied");
});

it("waits for an exact removal before reacquiring the same media", async () => {
  let resolveInspect!: (value: { mediaId: string; managed: boolean; revision: number }) => void;
  const mediaInspect = vi
    .fn<SocialClient["mediaInspect"]>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInspect = resolve;
        }),
    )
    .mockResolvedValue({ mediaId: "m", managed: true, revision: 3 });
  const mediaClaim = vi.fn<SocialClient["mediaClaim"]>(async (_action, input) => ({
    mediaId: input.mediaId,
    editorId: input.editorId,
    revision: input.expectedRevision + 1,
  }));
  const editor = new SocialMediaEditor({ mediaInspect, mediaClaim });
  await editor.claim("m", 1);
  const removed = editor.releaseCurrent("m");
  const restored = editor.claimExisting("m");
  expect(mediaClaim).toHaveBeenCalledTimes(1);
  resolveInspect({ mediaId: "m", managed: true, revision: 2 });
  await Promise.all([removed, restored]);
  expect(mediaClaim.mock.calls.map(([action]) => action)).toEqual([
    "claim",
    "releaseLogical",
    "claim",
  ]);
});
