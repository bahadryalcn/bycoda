// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  AttachmentOwnership,
  attachmentOwnerId,
  attachmentOwnershipScope,
  retireClosedAttachmentOwners,
} from "./attachmentOwnership";
const windows = vi.hoisted(() => ({ label: "main", live: ["main"] }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: windows.label }),
  getAllWindows: async () => windows.live.map((label) => ({ label })),
}));
beforeEach(() => {
  localStorage.clear();
  windows.label = "main";
  windows.live = ["main"];
});
it("retains shared IDs until all durable draft and queue sources are removed", async () => {
  const request = vi.fn(async () => ({ claims: [] }));
  const scope = new AttachmentOwnership("owner", "host", request);
  await scope.acquire("draft", ["file"]);
  await scope.retain("queue", ["file"]);
  await scope.replaceDurable("draft", []);
  expect(request).toHaveBeenCalledTimes(1);
  await scope.replaceDurable("queue", []);
  expect(request).toHaveBeenLastCalledWith(
    "attachments.release",
    expect.objectContaining({ ids: ["file"] }),
  );
});
it("persists release intent and retries it after a process restart", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "attachments.release") throw new Error("offline");
  });
  const scope = new AttachmentOwnership("owner", "offline", request);
  await scope.acquire("draft", ["file"]);
  await expect(scope.replaceDurable("draft", [])).rejects.toThrow("offline");
  const reconnected = vi.fn(async () => ({ claims: [] }));
  await new AttachmentOwnership("owner", "offline", reconnected).retry();
  expect(reconnected).toHaveBeenCalledWith(
    "attachments.release",
    expect.objectContaining({ ids: ["file"] }),
  );
});
it("reacquires a new generation while preserving retry of an uncertain old release", async () => {
  let offline = false;
  const request = vi.fn(async (method: string) => {
    if (offline && method === "attachments.release") throw new Error("offline");
  });
  const scope = new AttachmentOwnership("owner", "generation", request);
  await scope.acquire("draft", ["file"]);
  const old = scope.claimId("file");
  offline = true;
  await expect(scope.replaceDurable("draft", [])).rejects.toThrow();
  await scope.acquire("draft", ["file"]);
  expect(scope.claimId("file")).not.toBe(old);
  offline = false;
  await scope.retry();
  expect(request).toHaveBeenLastCalledWith("attachments.release", {
    ownerId: "owner",
    claimId: old,
    ids: ["file"],
  });
  await scope.replaceDurable("draft", []);
  expect(request.mock.calls.filter(([method]) => method === "attachments.release")).toHaveLength(3);
});
it("does not release active upload jobs or release merely on abort", async () => {
  const request = vi.fn(async () => ({ claims: [] }));
  const scope = new AttachmentOwnership("owner", "active", request);
  scope.beginJob("submit:turn");
  await scope.acquire("submit:turn", ["file"]);
  await scope.reconcileDurable({});
  scope.finishJob("submit:turn");
  expect(request.mock.calls.filter(([method]) => method === "attachments.release")).toHaveLength(0);
  // A later authoritative durable removal can retire the abandoned upload.
  await scope.reconcileDurable({});
  expect(request.mock.calls.filter(([method]) => method === "attachments.release")).toHaveLength(1);
});
it("reconciles a claimed saved draft after restart without leaking its old upload source", async () => {
  const request = vi.fn(async () => ({ claims: [] }));
  const owner = attachmentOwnerId("composer", "saved-shell");
  await new AttachmentOwnership(owner, "restart", request).acquire("submit:old-job", ["file"]);
  const restored = new AttachmentOwnership(
    attachmentOwnerId("composer", "saved-shell"),
    "restart",
    request,
  );
  await restored.reconcileDurable({ draft: ["file"] });
  expect(request.mock.calls.filter(([method]) => method === "attachments.release")).toHaveLength(0);
  await restored.reconcileDurable({ draft: [] });
  expect(request).toHaveBeenLastCalledWith(
    "attachments.release",
    expect.objectContaining({ ids: ["file"] }),
  );
});
it("does not release if durable outbox persistence fails", async () => {
  let fail = false;
  const storage = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: (key: string, value: string) => {
      if (fail) throw new Error("quota");
      localStorage.setItem(key, value);
    },
  };
  const request = vi.fn(async () => ({ claims: [] }));
  const scope = new AttachmentOwnership("owner", "quota", request, storage);
  await scope.acquire("draft", ["file"]);
  fail = true;
  await expect(scope.replaceDurable("draft", [])).rejects.toThrow("quota");
  expect(request).toHaveBeenCalledTimes(1);
});
it("batches claims and releases at the protocol limit", async () => {
  const request = vi.fn(async () => ({ claims: [] }));
  const scope = new AttachmentOwnership("owner", "batch", request);
  await scope.acquire(
    "draft",
    Array.from({ length: 45 }, (_, index) => `id-${index}`),
  );
  await scope.replaceDurable("draft", []);
  expect(request).toHaveBeenCalledTimes(6);
  for (const [, params] of request.mock.calls)
    expect((params as { ids: string[] }).ids.length).toBeLessThanOrEqual(20);
});
it("acquires surviving references before retiring a closed window, preserving live other owners", async () => {
  const request = vi.fn(async () => ({ claims: [] }));
  const old = attachmentOwnershipScope(
    "machine-retire",
    "host",
    JSON.stringify(["composer", "shell", "closed"]),
    request,
  );
  const other = attachmentOwnershipScope(
    "machine-retire",
    "host",
    JSON.stringify(["composer", "shell", "other"]),
    request,
  );
  await old.acquire("draft", ["file"]);
  await other.acquire("draft", ["file"]);
  windows.live = ["main", "other"];
  const current = attachmentOwnershipScope(
    "machine-retire",
    "host",
    attachmentOwnerId("composer", "shell"),
    request,
  );
  await retireClosedAttachmentOwners(
    "machine-retire",
    "host",
    current,
    { draft: ["file"] },
    request,
  );
  expect(request.mock.calls[2][0]).toBe("attachments.claim");
  const releases = request.mock.calls.filter(([method]) => method === "attachments.release");
  expect(releases).toHaveLength(1);
  expect(releases[0][1]).toEqual(expect.objectContaining({ ownerId: old.ownerId }));
});
it("rotates a queue snapshot generation before a fresh get while an old release is delayed", async () => {
  let finish!: () => void;
  const request = vi.fn(async (method: string) => {
    if (method === "attachments.release")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  const scope = new AttachmentOwnership("owner", "queue-generation", request);
  const old = scope.cacheClaimId();
  await scope.adoptClaimed("cache", ["file"], old);
  const releasing = scope.replaceDurable("cache", []);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  const fresh = scope.cacheClaimId();
  expect(fresh).not.toBe(old);
  const adopted = scope.adoptClaimed("cache", ["file"], fresh);
  finish();
  await releasing;
  await adopted;
  expect(scope.claimId("file")).toBe(fresh);
  expect(request).toHaveBeenCalledWith("attachments.release", {
    ownerId: "owner",
    claimId: old,
    ids: ["file"],
  });
});
it("repairs a host claim created before a lost queue response was adopted locally", async () => {
  const old = new AttachmentOwnership("owner", "lost-response", async () => {});
  const claimId = old.cacheClaimId();
  const request = vi.fn(async (method: string) =>
    method === "attachments.claims" ? { claims: [{ id: "orphan", claimId }] } : {},
  );
  const restored = new AttachmentOwnership("owner", "lost-response", request);
  await restored.reconcileDurable({});
  expect(request).toHaveBeenLastCalledWith("attachments.release", {
    ownerId: "owner",
    claimId,
    ids: ["orphan"],
  });
});
it("reclaims referenced bytes before retiring a phantom older generation", async () => {
  const request = vi.fn(async (method: string) =>
    method === "attachments.claims"
      ? { claims: [{ id: "retained", claimId: "unknown-old-generation" }] }
      : {},
  );
  const scope = new AttachmentOwnership("owner", "repair-live", request);
  await scope.reconcileDurable({ draft: ["retained"] });
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "attachments.claim",
    "attachments.claims",
    "attachments.release",
  ]);
  expect(request).toHaveBeenLastCalledWith("attachments.release", {
    ownerId: "owner",
    claimId: "unknown-old-generation",
    ids: ["retained"],
  });
});
it("pages through host claims and bounds orphan releases to twenty IDs", async () => {
  let pages = 0;
  const request = vi.fn(async (method: string) => {
    if (method !== "attachments.claims") return {};
    pages++;
    return pages === 1
      ? {
          claims: Array.from({ length: 200 }, (_, index) => ({
            id: `file-${index}`,
            claimId: "old",
          })),
          next: { id: "file-199", claimId: "old" },
        }
      : { claims: [{ id: "last", claimId: "old" }] };
  });
  await new AttachmentOwnership("owner", "paged", request).reconcileDurable({});
  const releases = request.mock.calls.filter(([method]) => method === "attachments.release");
  expect(pages).toBe(2);
  expect(releases).toHaveLength(11);
});
