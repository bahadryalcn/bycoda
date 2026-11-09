import { expect, it, vi } from "vitest";
import { localHostSessionAccess, remoteHostSessionAccess } from "./sessionAccess";
it.each([localHostSessionAccess, remoteHostSessionAccess])(
  "uses the same owner RPC contract for local and remote hosts",
  async (factory) => {
    const request = vi.fn(async () => ({
      revision: 1,
    })) as unknown as Parameters<typeof factory>[0];
    const access = factory(request);
    await access.dispatch({
      type: "cancel",
      commandId: "c",
      sessionId: "s",
      runId: "r",
    });
    await access.page("s", 100, 4);
    expect(request).toHaveBeenNthCalledWith(1, "commands.dispatch", {
      type: "cancel",
      commandId: "c",
      sessionId: "s",
      runId: "r",
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.page", {
      sessionId: "s",
      before: 100,
      revision: 4,
      preview: true,
    });
  },
);
it("propagates owner failures without trying another adapter", async () => {
  const request = vi.fn().mockRejectedValue(new Error("owner offline"));
  await expect(remoteHostSessionAccess(request).sync("s")).rejects.toThrow("owner offline");
  expect(request).toHaveBeenCalledOnce();
});

it.each([localHostSessionAccess, remoteHostSessionAccess])(
  "preserves explicit canonical page preview and digest choices",
  async (factory) => {
    const request = vi.fn().mockResolvedValue({});
    await factory(request).page("chat", 5, 8, true, false);
    expect(request).toHaveBeenCalledWith("sessions.page", {
      sessionId: "chat",
      before: 5,
      revision: 8,
      preview: false,
      digests: true,
    });
  },
);

it("passes caller-bound update/delete provenance and leaves legacy deletion unbound", async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  const access = remoteHostSessionAccess(request);
  await access.update("s", { title: "New title", authorityGeneration: 2 });
  await access.delete("s", "p", 2);
  await access.delete("legacy", "p");
  expect(request.mock.calls).toEqual([
    ["sessions.update", { sessionId: "s", title: "New title", authorityGeneration: 2 }],
    ["sessions.delete", { sessionId: "s", projectId: "p", authorityGeneration: 2 }],
    ["sessions.delete", { sessionId: "legacy", projectId: "p" }],
  ]);
});
