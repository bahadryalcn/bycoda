import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import type { SocialActionContext } from "../core/social-actions";
import { SocialAudienceStore } from "../store/social-audience-store";
import { instagramModerationRequests } from "./instagram-moderation-requests";

const directories: string[] = [];
const databases: HostStore[] = [];
afterEach(async () => {
  for (const store of databases.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "instagram-moderation-"));
  directories.push(directory);
  const host = new HostStore(join(directory, "host.sqlite"));
  databases.push(host);
  const store = new SocialAudienceStore(host);
  await store.initialize();
  const event = { direction: "inbound", platformId: "202", id: "event", text: "A comment" };
  const thread = { kind: "comment", projectId: "project", accountId: "account", events: [event] };
  const account = {
    id: "account",
    platformId: "101",
    platform: "instagram",
    grants: { project: ["reply"] },
  };
  const apply = vi.fn().mockResolvedValue(undefined);
  const service = {
    thread: vi.fn(async () => thread),
    access: vi.fn(async () => account),
    capability: vi.fn(),
    project: vi.fn(),
    adapterFor: vi.fn(() => ({ instagramCommentAction: apply })),
    credentialFor: vi.fn(async () => ({ accessToken: "fixture-credential" })),
  };
  const ctx = {
    principal: { kind: "session", projectId: "project" },
    store,
    service,
    now: Date.now,
    operationId: "operation",
  } as unknown as SocialActionContext;
  const owner = {
    ...ctx,
    principal: { kind: "owner", actorId: "owner", provider: "owner" },
  } as SocialActionContext;
  const tools = instagramModerationRequests;
  const input = { threadId: "thread", commentId: "202", action: "hide" };
  const request = () => tools["instagram.comments.request"].run(ctx, input);
  const list = async () => (await store.instagramModerationRequests("thread")).requests;
  const reviewList = () =>
    tools["instagram.comments.requests.list"].run(owner, { threadId: "thread" });
  const decide = (reviewed: unknown, id: string) =>
    tools["instagram.comments.requests.decide"].run(owner, { id, reviewed, decision: "approve" });
  return { event, thread, apply, request, list, reviewList, decide, store };
}

it("files a deduplicated project request and runs the provider once after exact review", async () => {
  const f = await fixture();
  const filed = await f.request();
  expect(await f.request()).toEqual(filed);
  expect(filed).not.toHaveProperty("commentText");
  expect(f.apply).not.toHaveBeenCalled();
  const [request] = await f.list();
  expect(request).not.toHaveProperty("commentText");
  await expect(f.reviewList()).resolves.toMatchObject({ requests: [{ commentText: "A comment" }] });
  await expect(f.decide({ ...request, action: "delete" }, request.id)).rejects.toThrow("Review");
  const results = await Promise.allSettled([
    f.decide(request, request.id),
    f.decide(request, request.id),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(await f.list()).toEqual([]);
  expect(await f.store.getRecord("instagram-moderation", request.id)).toMatchObject({
    status: "applied",
  });
});

it("refuses a session from another project and rechecks comment identity before approval", async () => {
  const f = await fixture();
  f.thread.projectId = "other";
  await expect(f.request()).rejects.toThrow("not found");
  f.thread.projectId = "project";
  await f.request();
  const [request] = await f.list();
  f.event.text = "Edited comment";
  await expect(f.reviewList()).resolves.toEqual({ requests: [request] });
  await expect(f.decide(request, request.id)).rejects.toThrow("changed after review");
  expect(f.apply).not.toHaveBeenCalled();
});

it("holds an ambiguous provider response for inspection through a duplicate request", async () => {
  const f = await fixture();
  f.apply.mockRejectedValueOnce(new Error("response lost"));
  await f.request();
  const [request] = await f.list();
  await expect(f.decide(request, request.id)).resolves.toMatchObject({ status: "uncertain" });
  await expect(f.request()).resolves.toMatchObject({ id: request.id, status: "uncertain" });
  await expect(f.decide(request, request.id)).rejects.toThrow("Review");
  expect(f.apply).toHaveBeenCalledOnce();
  expect(instagramModerationRequests["instagram.comments.requests.decide"].ownerOnly).toBe(true);
});
