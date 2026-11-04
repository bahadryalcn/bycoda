import { beforeEach, expect, it, vi } from "vitest";
import { sessionExecutionClient } from "./sessionExecutionClient";
import { flushHostSessionBindings } from "./sessionExecutionBinding";
import type { SessionAccess } from "./sessionAccess";
vi.mock("./sessionExecutionBinding", () => ({ flushHostSessionBindings: vi.fn() }));
beforeEach(() => {
  vi.mocked(flushHostSessionBindings).mockReset();
});

it("holds ordinary Host commands until owner publication commits", async () => {
  const dispatch = vi.fn().mockResolvedValue({ commandId: "send" });
  const client = sessionExecutionClient("env", { dispatch } as unknown as SessionAccess);
  let release!: () => void;
  vi.mocked(flushHostSessionBindings).mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const result = client.dispatchCommand({
    type: "send",
    commandId: "send",
    sessionId: "s",
    text: "hello",
  });
  await Promise.resolve();
  expect(dispatch).not.toHaveBeenCalled();
  release();
  await result;
  expect(dispatch).toHaveBeenCalledOnce();
});

it("preserves Stop access when owner persistence fails and refuses ordinary dispatch", async () => {
  const dispatch = vi.fn().mockResolvedValue({ commandId: "stop" });
  const client = sessionExecutionClient("env", { dispatch } as unknown as SessionAccess);
  vi.mocked(flushHostSessionBindings).mockRejectedValue(new Error("owner quota"));
  await expect(
    client.dispatchCommand({ type: "send", commandId: "send", sessionId: "s", text: "hello" }),
  ).rejects.toThrow("owner quota");
  expect(dispatch).not.toHaveBeenCalled();
  await client.dispatchCommand({ type: "cancel", commandId: "stop", sessionId: "s", runId: "r" });
  expect(dispatch).toHaveBeenCalledOnce();
});
