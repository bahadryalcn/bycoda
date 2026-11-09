import { expect, it, vi } from "vitest";

vi.mock("./tools-conversation", () => ({
  dispatchConversationTools: vi.fn(),
}));

import { dispatchConversationTools } from "./tools-conversation";
import { handleConversationTools } from "./tools-conversation-redacted";

const SECRET = "sk-live-abc123";
const conversationSecrets = {
  redact: async <T>(_projectId: string, value: T): Promise<T> =>
    JSON.parse(JSON.stringify(value).split(SECRET).join("[secret:api]")) as T,
};

function request() {
  return {
    conversationPrincipal: { kind: "session", projectId: "p1", sessionId: "s1" },
    endResult: vi.fn(async () => undefined),
  };
}

it("redacts saved secret values from tool results before they reach the agent", async () => {
  const req = request();
  vi.mocked(dispatchConversationTools).mockImplementationOnce(async (_deps, guarded) => {
    await guarded.endResult({ output: `TOKEN=${SECRET}` });
  });
  await handleConversationTools({ conversationSecrets } as never, req as never);
  expect(req.endResult).toHaveBeenCalledWith(
    { output: "TOKEN=[secret:api]" },
    undefined,
    undefined,
  );
});

it("redacts saved secret values from thrown error messages", async () => {
  vi.mocked(dispatchConversationTools).mockRejectedValueOnce(new Error(`failed with ${SECRET}`));
  await expect(
    handleConversationTools({ conversationSecrets } as never, request() as never),
  ).rejects.toThrow("failed with [secret:api]");
});

it("works with the live request shape, whose endResult is a getter and result a setter", async () => {
  const endResult = vi.fn(async () => undefined);
  let result: unknown;
  const live = {
    get conversationPrincipal() {
      return { kind: "session", projectId: "p1", sessionId: "s1" };
    },
    get endResult() {
      return endResult;
    },
    get result() {
      return result;
    },
    set result(value: unknown) {
      result = value;
    },
  };
  vi.mocked(dispatchConversationTools).mockImplementationOnce(async (_deps, guarded) => {
    guarded.result = { output: SECRET };
    await guarded.endResult(guarded.result);
  });
  await handleConversationTools({ conversationSecrets } as never, live as never);
  expect(result).toEqual({ output: SECRET });
  expect(endResult).toHaveBeenCalledWith({ output: "[secret:api]" }, undefined, undefined);
});
