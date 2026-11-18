import { afterEach, expect, it, vi } from "vitest";
import type { SocialDraft, SocialJob } from "../../../src/features/social/model/social";
import { fixture, owner, runCleanups } from "../social-test-support";
import { instagramAttachmentMime } from "./instagram-media";

const pdf = Buffer.from("%PDF-1.7\ncontents\n%%EOF");

afterEach(async () => {
  vi.unstubAllEnvs();
  await runCleanups();
});

function fileData(kind: "audio" | "document") {
  return kind === "document" ? pdf : Buffer.from("RIFF\x00\x00\x00\x00WAVEdata");
}

it.each([["audio", "audio/wav"], ["document", "application/pdf"]] as const)(
  "binds a reviewed local %s to a short-lived DM delivery URL without persisting the credential",
  async (kind, mime) => {
    vi.stubEnv("BYCODA_SOCIAL_PUBLIC_MEDIA_BASE_URL", "https://media.example");
    const f = await fixture();
    const thread = await f.thread(await f.account("instagram"));
    const source = fileData(kind);
    const lookup = { instagramAttachmentThreadId: thread.id, instagramAttachmentKind: kind };
    const { uploadId } = await f.social.uploadVideo(owner, { ...lookup, mode: "begin", size: source.length });
    const chunk = { ...lookup, mode: "chunk", uploadId, offset: 0, base64: source.toString("base64") };
    await expect(f.social.uploadVideo({ ...owner, actorId: "other-owner" }, chunk)).rejects.toThrow();
    await f.social.uploadVideo(owner, chunk);
    await f.social.uploadVideo(owner, { ...lookup, mode: "finish", uploadId });
    const input = {
      threadId: thread.id,
      text: "",
      media: [{ kind, uploadId }],
    };
    await expect(f.call("replies.draft", input, { ...owner, actorId: "different-owner" }))
      .rejects.toThrow("Attach a file uploaded by this owner.");
    const draft = await f.call<SocialDraft>("replies.draft", input);
    await f.approveDraft(draft.id);
    const job = await f.call<SocialJob>("replies.send", { id: draft.id });
    let grant: URL | undefined;
    f.send.mockImplementationOnce(async (_account, delivery, _token, _read, _checkpoint, beforeSubmit) => {
      await beforeSubmit?.();
      expect(delivery.payload.media[0].uploadId).toBeUndefined();
      grant = new URL(delivery.payload.media[0].url!);
      expect(grant.origin).toBe("https://media.example");
      expect(grant.pathname).toBe(`/social/media/instagram-direct/${uploadId}`);
      await expect(f.social.readInstagramAttachment(uploadId, grant.searchParams)).resolves.toEqual({ bytes: source, mime });
      const tampered = new URLSearchParams(grant.searchParams);
      tampered.set("kind", kind === "audio" ? "video" : "image");
      await expect(f.social.readInstagramAttachment(uploadId, tampered)).rejects.toThrow();
      return { platformId: "accepted" };
    });
    await f.enable();
    await f.social.tick();
    expect(f.send).toHaveBeenCalledOnce();
    const result = await f.call<SocialJob>("jobs.status", { id: job.id });
    expect(result.status).toBe("succeeded");
    expect(result.payload.media).toEqual(input.media);
    expect(JSON.stringify(result)).not.toContain("token=");
    expect(grant).toBeDefined();
    f.clock.value += 15 * 60_000;
    await expect(f.social.readInstagramAttachment(uploadId, grant!.searchParams)).rejects.toThrow();
  },
);

it("keeps a locally uploaded file out of provider dispatch after the recipient opts out", async () => {
  vi.stubEnv("BYCODA_SOCIAL_PUBLIC_MEDIA_BASE_URL", "https://media.example");
  const f = await fixture();
  const account = await f.account("instagram");
  const thread = await f.thread(account);
  const lookup = { instagramAttachmentThreadId: thread.id, instagramAttachmentKind: "document" };
  const { uploadId } = await f.social.uploadVideo(owner, { ...lookup, mode: "begin", size: pdf.length });
  await f.social.uploadVideo(owner, {
    ...lookup, mode: "chunk", uploadId, offset: 0, base64: pdf.toString("base64"),
  });
  await f.social.uploadVideo(owner, { ...lookup, mode: "finish", uploadId });
  const draft = await f.call<SocialDraft>("replies.draft", {
    threadId: thread.id, text: "", media: [{ kind: "document", uploadId }],
  });
  await f.approveDraft(draft.id);
  const job = await f.call<SocialJob>("replies.send", { id: draft.id });
  await f.call("suppressions.add", {
    handle: "instagram:recipient-1",
    channel: "dm",
    reason: "manual",
  });
  await f.enable();
  await f.social.tick();
  expect(f.send).not.toHaveBeenCalled();
  expect((await f.call<SocialJob>("jobs.status", { id: job.id })).status).toBe("cancelled");
});

it("compares the selected type to the stored bytes instead of sending by extension", () => {
  expect(() => instagramAttachmentMime("document", Buffer.from("<html>mislabelled</html>"))).toThrow();
  expect(() => instagramAttachmentMime("audio", pdf)).toThrow();
  expect(() => instagramAttachmentMime("image", new Uint8Array(8_000_001))).toThrow();
});
