import { afterEach, expect, it, vi } from "vitest";
import {
  handleInboxRpc,
  INBOX_PROJECT_LIST_TIMEOUT_MS,
  INBOX_READ_TTL_MS,
} from "./rpc-inbox";
import type { OwnerRpcRequest } from "./owner-rpc-context";

afterEach(() => {
  vi.useRealTimers();
});

type InboxResult = { items: { id: string }[]; unavailableProjectIds?: string[] };

function inboxHost(list?: (projectId: string) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const projectSessionList = vi.fn(
    list ??
      (async (projectId: string) => {
        await gate;
        return {
          list: [
            { id: `${projectId}-session`, projectId, needsInput: true, title: "", updatedAt: 1 },
          ],
        };
      }),
  );
  // Every Host gets its own engine object: reads are cached per Host.
  const store = {
    changeVersion: 0,
    projectRegistryVersion: 0,
    db: { dataMutationVersion: 0 },
    projects: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
    project: vi.fn(async (id: string) => {
      if (id === "gone") throw new Error("Project not found.");
      return { id };
    }),
    authenticated: vi.fn(async (token: string) => token !== "revoked"),
  };
  const dependencies = {
    engine: { store },
    projectSessionList,
    tasks: { list: vi.fn(async () => []) },
    goals: { list: vi.fn(async () => []) },
    automations: { list: vi.fn(async () => []) },
    social: { snapshot: vi.fn(async () => ({ threads: [] })) },
  } as unknown as Parameters<typeof handleInboxRpc>[0];
  const call = async (token: string, projectId?: string) => {
    const request = {
      input: { method: "inbox.list" },
      params: projectId === undefined ? {} : { projectId },
      token,
      result: undefined,
    } as unknown as OwnerRpcRequest;
    await handleInboxRpc(dependencies, request);
    return request.result as InboxResult;
  };
  return { call, release, projectSessionList, store, dependencies };
}

it("shares one read between concurrent inbox lists and checks each caller's authority", async () => {
  const host = inboxHost();
  const first = host.call("owner");
  const second = host.call("owner");
  const revoked = host.call("revoked");
  host.release();
  const [a, b] = await Promise.all([first, second]);
  await expect(revoked).rejects.toThrow("Session authority revoked.");
  // Two projects, read once for all three callers.
  expect(host.projectSessionList).toHaveBeenCalledTimes(2);
  expect(a.items.map((item) => item.id)).toEqual(["session:a-session", "session:b-session"]);
  expect(b).toEqual(a);
});

it("reuses a complete read until a store signal moves or the TTL ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  const host = inboxHost(async (projectId) => ({
    list: [{ id: `${projectId}-session`, projectId, needsInput: true, title: "", updatedAt: 1 }],
  }));
  const first = await host.call("owner");
  expect(await host.call("owner")).toEqual(first);
  expect(host.projectSessionList).toHaveBeenCalledTimes(2);
  expect(host.dependencies.tasks.list).toHaveBeenCalledTimes(1);

  // A revoked caller is still refused when the read is served from the cache.
  await expect(host.call("revoked")).rejects.toThrow("Session authority revoked.");
  expect(host.projectSessionList).toHaveBeenCalledTimes(2);

  // Each store signal ends reuse on its own.
  host.store.changeVersion++;
  await host.call("owner");
  expect(host.projectSessionList).toHaveBeenCalledTimes(4);
  host.store.db.dataMutationVersion++;
  await host.call("owner");
  expect(host.projectSessionList).toHaveBeenCalledTimes(6);
  host.store.projectRegistryVersion++;
  await host.call("owner");
  expect(host.projectSessionList).toHaveBeenCalledTimes(8);

  // Signals no store reports (desktop-watched sessions) are bounded by the TTL.
  await vi.advanceTimersByTimeAsync(INBOX_READ_TTL_MS + 1);
  await host.call("owner");
  expect(host.projectSessionList).toHaveBeenCalledTimes(10);
});

it("keeps scopes apart and never serves a removed project from the cache", async () => {
  const host = inboxHost(async (projectId) => ({
    list: [{ id: `${projectId}-session`, projectId, needsInput: true, title: "", updatedAt: 1 }],
  }));
  const scoped = await host.call("owner", "a");
  expect(scoped.items.map((item) => item.id)).toEqual(["session:a-session"]);
  const all = await host.call("owner");
  expect(all.items).toHaveLength(2);
  expect(host.projectSessionList).toHaveBeenCalledTimes(3);
  await expect(host.call("owner", "gone")).rejects.toThrow("Project not found.");
  await expect(host.call("owner", "gone")).rejects.toThrow("Project not found.");
});

it("answers without a project whose list misses its deadline and does not cache that answer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  let hung = true;
  const host = inboxHost(async (projectId) => {
    if (projectId === "b" && hung) return await new Promise<never>(() => undefined);
    return {
      list: [{ id: `${projectId}-session`, projectId, needsInput: true, title: "", updatedAt: 1 }],
    };
  });
  const pending = host.call("owner");
  await vi.advanceTimersByTimeAsync(INBOX_PROJECT_LIST_TIMEOUT_MS + 1);
  const degraded = await pending;
  expect(degraded.items.map((item) => item.id)).toEqual(["session:a-session"]);
  expect(degraded.unavailableProjectIds).toEqual(["b"]);

  // A list past its deadline is not joined forever: once the project answers again, the
  // full inbox returns with no degraded marker.
  hung = false;
  host.store.changeVersion++;
  const recovered = await host.call("owner");
  expect(recovered.unavailableProjectIds).toBeUndefined();
  expect(recovered.items).toHaveLength(2);
});

it("joins a project list still running when a store signal forces a newer read", async () => {
  const host = inboxHost();
  const first = host.call("owner");
  await vi.waitFor(() => expect(host.projectSessionList).toHaveBeenCalledTimes(2));
  host.store.changeVersion++;
  const second = host.call("owner");
  host.release();
  await Promise.all([first, second]);
  // The second read is separate (its signals differ) but starts no second list per project.
  expect(host.projectSessionList).toHaveBeenCalledTimes(2);
  expect(host.dependencies.tasks.list).toHaveBeenCalledTimes(2);
});

it("does not hide a failed project list behind the deadline fallback", async () => {
  const host = inboxHost(async (projectId) => {
    if (projectId === "b") throw new Error("Session list failed.");
    return { list: [] };
  });
  await expect(host.call("owner")).rejects.toThrow("Session list failed.");
  // A failed read is not cached.
  await expect(host.call("owner")).rejects.toThrow("Session list failed.");
});
