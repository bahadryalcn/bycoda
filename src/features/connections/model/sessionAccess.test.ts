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
