import { expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import { uploadXMedia, xMediaFormat, xMediaIssue } from "./xMedia";
import type { SocialJob } from "../../features/social/model/social";
const video = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
const job = (): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "device",
  kind: "publish",
  payload: { text: "Video", media: [{ kind: "video", uploadId: "local" }] },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
it("uploads video in chunks, persists processing, and resumes without another upload", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024 + 12);
  bytes.set(video);
  const fetcher = vi.fn(async (raw: string | URL | Request) => {
    const url = String(raw);
    if (url.endsWith("initialize"))
      return Response.json({ data: { id: "500", expires_after_secs: 3600 } });
    if (url.endsWith("append")) return new Response(null, { status: 204 });
    if (url.endsWith("finalize"))
      return Response.json({
        data: { processing_info: { state: "pending", check_after_secs: 2 } },
      });
    return Response.json({ data: { processing_info: { state: "succeeded" } } });
  });
  const http = new SocialHttp(fetcher),
    pending = job(),
    save = vi.fn();
  await expect(
    uploadXMedia(
      http,
      pending,
      "synthetic",
      async () => bytes,
      false,
      save,
      () => 1000,
    ),
  ).rejects.toMatchObject({ code: "processing", retryAt: 3000 });
  expect(pending.preparation?.xVideo).toEqual({ id: "500", expiresAt: 3601000 });
  expect(pending.preparation?.mediaIds).toBeUndefined();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("append"))).toHaveLength(2);
  await expect(
    uploadXMedia(
      http,
      pending,
      "synthetic",
      async () => bytes,
      false,
      save,
      () => 3000,
    ),
  ).resolves.toEqual(["500"]);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("initialize"))).toHaveLength(1);
  expect(pending.preparation?.mediaIds).toEqual(["500"]);
});
it.each(["failed", "unknown", undefined])(
  "does not accept processing state %s as success",
  async (state) => {
    const pending = job();
    pending.preparation = { xVideo: { id: "500", expiresAt: 9999 } };
    const fetcher = vi.fn(async () =>
      Response.json({ data: state ? { processing_info: { state } } : {} }),
    );
    await expect(
      uploadXMedia(
        new SocialHttp(fetcher),
        pending,
        "synthetic",
        async () => video,
        false,
        undefined,
        () => 1000,
      ),
    ).rejects.toMatchObject({ code: state ? "rejected" : "unknown" });
    expect(pending.preparation.mediaIds).toBeUndefined();
  },
);
it("rejects expired uploads, mixed attachments, false media kinds and document bytes", async () => {
  const pending = job();
  pending.preparation = { xVideo: { id: "500", expiresAt: 1000 } };
  const fetcher = vi.fn();
  await expect(
    uploadXMedia(
      new SocialHttp(fetcher),
      pending,
      "synthetic",
      async () => video,
      false,
      undefined,
      () => 1001,
    ),
  ).rejects.toMatchObject({ code: "rejected" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(xMediaIssue([...pending.payload.media, { kind: "image", uploadId: "b" }])).toBeTruthy();
  expect(
    xMediaIssue(
      [
        { kind: "image", uploadId: "a" },
        { kind: "image", uploadId: "b" },
      ],
      true,
    ),
  ).toBeTruthy();
  expect(() => xMediaFormat(new TextEncoder().encode("%PDF-1.7 fake"))).toThrow();
  expect(xMediaIssue([{ kind: "document", uploadId: "pdf", title: "A document" }])).toContain(
    "native documents",
  );
  expect(() => xMediaFormat(new Uint8Array([137, 80]))).toThrow();
});

it("attaches image alt text before returning postable media and resumes failed metadata without reuploading", async () => {
  const pending = job();
  pending.payload.media = [
    { kind: "image", uploadId: "image", alt: "A chart showing the owner’s new feature" },
  ];
  let metadataFails = true;
  const fetcher = vi.fn(async (raw: string | URL | Request) => {
    if (String(raw).endsWith("/metadata"))
      return metadataFails
        ? new Response(null, { status: 503 })
        : Response.json({ data: { id: "500", associated_metadata: {} } });
    return Response.json({ data: { id: "500" } });
  });
  const read = vi.fn(async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const http = new SocialHttp(fetcher);
  await expect(uploadXMedia(http, pending, "synthetic", read, false)).rejects.toMatchObject({
    code: "unknown",
  });
  expect(pending.preparation?.mediaIds).toEqual(["500"]);
  expect(pending.preparation?.xAltText).toBeUndefined();
  metadataFails = false;
  await expect(uploadXMedia(http, pending, "synthetic", read, false)).resolves.toEqual(["500"]);
  expect(read).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.filter(([raw]) => String(raw).endsWith("/upload"))).toHaveLength(1);
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(JSON.parse(calls.at(-1)![1].body as string)).toEqual({
    id: "500",
    metadata: { alt_text: { text: pending.payload.media[0].alt } },
  });
  expect(pending.preparation?.xAltText?.["500"]).toBe(pending.payload.media[0].alt);
  const before = fetcher.mock.calls.length;
  await expect(uploadXMedia(http, pending, "synthetic", read, false)).resolves.toEqual(["500"]);
  expect(fetcher).toHaveBeenCalledTimes(before);
});

it("leaves uncaptioned uploads alone and rejects unsupported descriptions before upload", async () => {
  const pending = job();
  pending.payload.media = [{ kind: "image", uploadId: "image" }];
  const fetcher = vi.fn(async () => Response.json({ data: { id: "501" } }));
  await expect(
    uploadXMedia(
      new SocialHttp(fetcher),
      pending,
      "synthetic",
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      false,
    ),
  ).resolves.toEqual(["501"]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(
    xMediaIssue([{ kind: "video", uploadId: "video", alt: "Unsupported video description" }]),
  ).toContain("images");
  expect(xMediaIssue([{ kind: "image", uploadId: "image", alt: "x".repeat(1001) }])).toContain(
    "1000",
  );
});
