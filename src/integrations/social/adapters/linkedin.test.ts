import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp } from "../adapter";
import { createLinkedInAdapter } from "./linkedin";

const version = "202609";
const orgAccount = (
  scopes: string[] = [
    "w_organization_social",
    "r_organization_social_feed",
    "r_organization_social",
  ],
) =>
  ({
    id: "synthetic",
    platform: "linkedin",
    platformId: "urn:li:organization:123",
    name: "Bycoda",
    accountType: "organization",
    scopes,
    connected: true,
    accessApproved: true,
    connection: "api",
    paused: false,
    executorId: "synthetic-host",
    grants: {},
    createdAt: 1,
  }) as unknown as SocialAccount;
const memberAccount = () =>
  ({
    ...orgAccount(["w_member_social"]),
    accountType: "member",
    platformId: "urn:li:person:me",
  }) as unknown as SocialAccount;
const publishJob = (payload: Partial<SocialJob["payload"]> = {}) =>
  ({
    id: "job",
    kind: "publish",
    payload: { text: "A Bycoda update", media: [], ...payload },
    status: "running",
    attempts: 1,
  }) as unknown as SocialJob;
const pdf = () => new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF");
const json = (value: unknown) => Response.json(value);

describe("LinkedIn API adapter", () => {
  it("refuses commentary over the platform limit before any request", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ text: "x".repeat(3001) }),
        "t",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a single image whose bytes are not PNG or JPEG before registering an upload", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ media: [{ kind: "image", uploadId: "local" }] } as Partial<
          SocialJob["payload"]
        >),
        "t",
        async () => new Uint8Array([1, 2, 3, 4]),
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("publishes an organization PDF through the Documents API and checkpoints the document", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = String(raw);
      calls.push(url);
      if (url.includes("/rest/documents?action=initializeUpload"))
        return json({
          value: {
            document: "urn:li:document:123",
            uploadUrl: "https://www.linkedin.com/dms-uploads/doc",
          },
        });
      if (url.includes("/dms-uploads/")) return new Response(null, { status: 201 });
      if (url.includes("/rest/documents/")) return json({ status: "AVAILABLE" });
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
    });
    const checkpoint = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const result = await adapter.send(
      orgAccount(),
      publishJob({ media: [{ kind: "document", uploadId: "local", title: "Guide" }] } as Partial<
        SocialJob["payload"]
      >),
      "t",
      async () => pdf(),
      checkpoint,
    );
    expect(result.platformId).toBe("urn:li:share:999");
    expect(checkpoint).toHaveBeenCalledWith({ mediaIds: ["urn:li:document:123"] });
    const post = fetcher.mock.calls.find(([raw]) => String(raw).endsWith("/rest/posts"));
    expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
      content: { media: { id: "urn:li:document:123", title: "Guide" } },
    });
  });

  it("refuses a PDF title with a line break before any request", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ media: [{ kind: "document", uploadId: "local", title: "a\nb" }] } as Partial<
          SocialJob["payload"]
        >),
        "t",
        async () => pdf(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("collects organization post commenters with the actor URN and a next cursor", async () => {
    const fetcher = vi.fn(async () =>
      json({
        elements: Array.from({ length: 100 }, (_, index) => ({
          actor: `urn:li:person:p${index}`,
          commentUrn: `urn:li:comment:(urn:li:share:999,${index})`,
          created: { time: 1790000000000 },
        })),
        paging: { total: 150 },
      }),
    );
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const page = await adapter.collectAudience!(orgAccount(), "t", {
      kind: "own_post_comments",
      accountId: "synthetic",
      postRef: "urn:li:share:999",
    });
    expect(page.people).toHaveLength(100);
    expect(page.people[0]).toMatchObject({
      platformId: "urn:li:person:p0",
      kind: "comment",
      at: 1790000000000,
    });
    expect(page.next).toBe("100");
  });

  it("collects reactors of the owner's post as like interactions", async () => {
    const fetcher = vi.fn(async () =>
      json({
        elements: [{ actor: "urn:li:person:liker", created: { time: 1790000000000 } }],
        paging: { total: 1 },
      }),
    );
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const page = await adapter.collectAudience!(orgAccount(), "t", {
      kind: "own_post_likes",
      accountId: "synthetic",
      postRef: "urn:li:share:999",
    });
    expect(page.people).toEqual([
      {
        platformId: "urn:li:person:liker",
        name: "urn:li:person:liker",
        kind: "like",
        ref: "urn:li:share:999",
        at: 1790000000000,
      },
    ]);
    expect(page.next).toBeUndefined();
  });

  it("refuses audience sources it does not implement and member accounts", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.collectAudience!(orgAccount(), "t", { kind: "mentions", accountId: "synthetic" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      adapter.collectAudience!(memberAccount(), "t", {
        kind: "own_post_likes",
        accountId: "synthetic",
        postRef: "urn:li:share:999",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
