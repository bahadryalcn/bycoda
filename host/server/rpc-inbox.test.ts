import { expect, it, vi } from "vitest";
import { handleInboxRpc } from "./rpc-inbox";
import type { OwnerRpcRequest } from "./owner-rpc-context";

function inboxHost() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const projectSessionList = vi.fn(async (projectId: string) => {
    await gate;
    return {
      list: [{ id: `${projectId}-session`, projectId, needsInput: true, title: "", updatedAt: 1 }],
    };
  });
  const dependencies = {
    engine: {
      store: {
        projects: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
        project: vi.fn(async (id: string) => ({ id })),
        authenticated: vi.fn(async (token: string) => token !== "revoked"),
      },
    },
    projectSessionList,
    tasks: { list: async () => [] },
    goals: { list: async () => [] },
    automations: { list: async () => [] },
    social: { snapshot: async () => ({ threads: [] }) },
  } as unknown as Parameters<typeof handleInboxRpc>[0];
  const call = async (token: string) => {
    const request = {
      input: { method: "inbox.list" },
      params: {},
      token,
      result: undefined,
    } as unknown as OwnerRpcRequest;
    await handleInboxRpc(dependencies, request);
    return request.result as { items: { id: string }[] };
  };
  return { call, release, projectSessionList };
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
  // A settled read is never reused: the next list reads again.
  await host.call("owner");
  expect(host.projectSessionList).toHaveBeenCalledTimes(4);
});
