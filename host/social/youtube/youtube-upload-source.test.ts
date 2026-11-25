import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SocialAccount, SocialJob } from "../../../src/features/social/model/social";
import { SocialHttp } from "../../../src/integrations/social/adapter";
import { createYouTubeAdapter } from "../../../src/integrations/social/youtube";
import { YOUTUBE_UPLOAD_CHUNK_BYTES } from "../../../src/integrations/social/youtube-upload";
import type { SocialCredential } from "../social-credentials";
import { fixture, owner, runCleanups } from "../social-test-support";
import { youtubeDiskUpload } from "./youtube-upload-source";

const videoId = "demoVideo01";
const account = { id: "account", platformId: "UCchannel", executorId: "host" } as SocialAccount;
const uploadId = "0e5b5a11-c757-4e87-88a7-a2805102a256";
const uri = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret-fixture-session";
afterEach(runCleanups);

describe("disk-backed YouTube uploads", () => {
  it("resumes a disk-backed 70 MiB video from Google's acknowledged offset after restarting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "social-youtube-upload-"));
    try {
      const size = 70 * 1024 ** 2;
      await mkdir(join(directory, "media"));
      const file = await open(join(directory, "media", uploadId), "wx");
      try {
        await file.truncate(size);
        await file.write(Buffer.from("0000ftyp0000"));
      } finally {
        await file.close();
      }
      const secrets = new Map<string, SocialCredential>();
      const credentials = {
        get: async (key: string) => secrets.get(key),
        set: async (key: string, data: SocialCredential) => {
          secrets.set(key, data);
        },
        delete: async (key: string) => {
          secrets.delete(key);
        },
      };
      let job = {
        id: "publish-job",
        dedupeKey: "campaign-approval",
        kind: "publish",
        payload: {
          text: "A long video",
          media: [{ kind: "video", uploadId }],
          youtube: {
            title: "Fixture",
            privacy: "unlisted",
            madeForKids: false,
            containsSyntheticMedia: false,
          },
        },
      } as SocialJob;
      let acknowledged = 0;
      let initializations = 0;
      const ranges: string[] = [];
      const response = () =>
        new Response(null, {
          status: 308,
          headers: acknowledged ? { range: `bytes=0-${acknowledged - 1}` } : {},
        });
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/channels"))
          return Response.json({ items: [{ id: account.platformId }] });
        if (init?.method === "POST") {
          initializations++;
          expect(new Headers(init.headers).get("X-Upload-Content-Length")).toBe(String(size));
          return new Response(null, { status: 200, headers: { location: uri } });
        }
        if (init?.method === "PUT") {
          expect(init.redirect).toBe("manual");
          expect(secrets.size).toBe(1);
          expect(job.preparation?.youtubeUploadPending).toBe(true);
          const range = new Headers(init.headers).get("Content-Range")!;
          ranges.push(range);
          if (range.startsWith("bytes */"))
            return acknowledged === size
              ? Response.json({ id: videoId }, { status: 201 })
              : response();
          const [, start, end, total] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
          expect(Number(start)).toBe(acknowledged);
          expect(Number(total)).toBe(size);
          const length = Number(end) - Number(start) + 1;
          expect(length).toBeLessThanOrEqual(YOUTUBE_UPLOAD_CHUNK_BYTES);
          expect((init.body as Uint8Array).byteLength).toBe(length);
          acknowledged += length;
          if (acknowledged === 2 * YOUTUBE_UPLOAD_CHUNK_BYTES || acknowledged === size)
            throw new Error("Fixture connection drops after Google receives the bytes");
          return response();
        }
        return Response.json({
          items: [
            {
              id: videoId,
              snippet: { channelId: account.platformId },
              status: { uploadStatus: "processed", privacyStatus: "unlisted" },
              processingDetails: { processingStatus: "succeeded" },
            },
          ],
        });
      };
      const publish = () =>
        createYouTubeAdapter(new SocialHttp(fetcher)).send(
          account,
          job,
          "fixture OAuth",
          async () => {
            throw new Error("Whole-file reads are unavailable");
          },
          async (state) => {
            job.preparation = state;
          },
          async () => {},
          youtubeDiskUpload(directory, credentials, account, job),
        );
      await expect(publish()).rejects.toMatchObject({ code: "processing" });
      expect(job.preparation).toEqual({ youtubeUploadPending: true });
      expect(JSON.stringify(job)).not.toContain("secret-fixture-session");
      // Recreate both adapter and file reader using only durable job and vault state.
      job = JSON.parse(JSON.stringify(job)) as SocialJob;
      await expect(publish()).rejects.toMatchObject({ code: "processing" });
      // Losing the final response must retrieve the accepted video without another upload.
      job = JSON.parse(JSON.stringify(job)) as SocialJob;
      await expect(publish()).resolves.toMatchObject({
        platformId: videoId,
        visibility: "unlisted",
      });
      expect(initializations).toBe(1);
      expect(ranges[2]).toBe(`bytes */${size}`);
      expect(ranges[3]).toBe(
        `bytes ${2 * YOUTUBE_UPLOAD_CHUNK_BYTES}-${3 * YOUTUBE_UPLOAD_CHUNK_BYTES - 1}/${size}`,
      );
      expect(acknowledged).toBe(size);
      expect(ranges.at(-1)).toBe(`bytes */${size}`);
      expect(secrets.size).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("admits large staging only for verified local YouTube API accounts", async () => {
    const f = await fixture();
    const youtube = await f.account("youtube");
    const other = await f.account("x");
    const request = { mode: "begin", size: 70 * 1024 ** 2 };
    await expect(f.social.uploadVideo(owner, request)).rejects.toThrow(/64 MiB/);
    await expect(
      f.social.uploadVideo(owner, { ...request, youtubeAccountId: other.id }),
    ).rejects.toThrow(/YouTube API/);
    const { uploadId } = await f.social.uploadVideo(owner, {
      ...request,
      youtubeAccountId: youtube.id,
    });
    await f.social.uploadVideo(owner, { mode: "cancel", uploadId });
  });

  it("requeues only a YouTube job with durable evidence when Host restarts", async () => {
    const f = await fixture();
    const account = await f.account("youtube");
    const job = {
      id: "recover-youtube",
      dedupeKey: "recover-youtube",
      accountId: account.id,
      projectIds: [f.a.id],
      actorId: owner.actorId,
      provider: owner.provider,
      operationId: "recover-youtube",
      kind: "publish",
      status: "running",
      createdAt: f.clock.value,
      scheduledAt: f.clock.value,
      dispatchedAt: f.clock.value,
      attempts: 1,
      payload: {
        text: "",
        media: [{ kind: "video", uploadId }],
        youtube: {
          title: "Fixture",
          privacy: "private",
          madeForKids: false,
          containsSyntheticMedia: false,
        },
      },
    } as const;
    await f.social.writeJob({
      ...job,
      payload: { ...job.payload, media: [...job.payload.media] },
      projectIds: [...job.projectIds],
      preparation: { youtubeUploadPending: true },
    });
    await f.social.writeJob({
      ...job,
      id: "unconfirmed-youtube",
      dedupeKey: "unconfirmed-youtube",
      payload: { ...job.payload, media: [...job.payload.media] },
      projectIds: [...job.projectIds],
    });
    await f.restart();
    await expect(f.call("jobs.status", { id: job.id })).resolves.toMatchObject({
      status: "queued",
      dispatchedAt: f.clock.value,
      preparation: { youtubeUploadPending: true },
    });
    await expect(f.call("jobs.status", { id: "unconfirmed-youtube" })).resolves.toMatchObject({
      status: "review",
    });
  });
});
