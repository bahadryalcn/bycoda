import { beforeEach, expect, it, vi } from "vitest";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  register: vi.fn(),
  run: vi.fn(),
  helper: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir }));
vi.mock("../../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: mocks.register,
}));
vi.mock("../../src/integrations/harness/core/registry", () => ({
  runHarnessTextPrompt: mocks.run,
}));
vi.mock("../work/helper-adapter", () => ({ runAssistantHelper: mocks.helper }));
import { withSocialTextInvocation } from "./social-generation";
import { socialAgentGenerator } from "./social-agent";
beforeEach(() => {
  mocks.mkdir.mockReset().mockResolvedValue(undefined);
  mocks.register.mockReset();
  mocks.run.mockReset();
  mocks.helper.mockReset().mockImplementation(async (_store, _input, run) => run());
});
it("uses the saved provider/model in the common text runner and an empty host workspace", async () => {
  mocks.run.mockResolvedValue('{"text":"Public fact"}');
  const signal = new AbortController().signal;
  const generate = socialAgentGenerator("host-social");
  expect(
    await generate(
      { provider: "antigravity", model: "antigravity:chosen-model" },
      "Trusted public prompt",
      signal,
    ),
  ).toBe('{"text":"Public fact"}');
  expect(mocks.mkdir).toHaveBeenCalledWith(join("host-social", "text-workspace"), {
    recursive: true,
    mode: 0o700,
  });
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "antigravity",
      model: "chosen-model",
      cwd: join("host-social", "text-workspace"),
      prompt: "Trusted public prompt",
      intent: "plan",
      ephemeral: true,
      timeoutMs: 90_000,
      signal,
    }),
  );
});
it("an unsupported or unauthenticated saved runner fails without selecting another provider", async () => {
  mocks.run.mockRejectedValue(new Error("Runner unavailable"));
  await expect(
    socialAgentGenerator("host-social")(
      { provider: "antigravity", model: "chosen-model" },
      "Trusted fact",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Runner unavailable");
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0][0].harness).toBe("antigravity");
});

it("passes saved account and effort to the text runner", async () => {
  mocks.run.mockResolvedValue("Reply");
  await socialAgentGenerator("host-social")(
    {
      provider: "codex",
      model: "gpt-6.1-sol",
      providerAccountId: "work",
      modelSettings: { reasoningEffort: "high" },
    },
    "Prompt",
    new AbortController().signal,
  );
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({
      providerAccountId: "work",
      modelSettings: { reasoningEffort: "high" },
    }),
  );
});

it("queues actual provider invocation with original request identity, target and measured usage", async () => {
  const store = {} as import("../store").HostStore;
  mocks.run.mockImplementation(async (input) => {
    input.onEvent({ type: "turn.metrics", inputTokens: 12, outputTokens: 3 });
    return "Reply";
  });
  const generate = socialAgentGenerator("host-social", store);
  const invocation = { operationId: "original-request", actorScope: "owner:account:action" };
  await withSocialTextInvocation(invocation, () =>
    generate(
      {
        provider: "codex",
        model: "gpt-6.1-sol",
        providerAccountId: "work",
        modelSettings: { reasoningEffort: "high" },
      },
      "Prompt",
      new AbortController().signal,
    ),
  );
  const input = mocks.helper.mock.calls[0][1];
  expect(input.source.kind).toBe("social.generation");
  expect(input.operationId).toBe("original-request");
  expect(input.target.execution.helperId).toBe(input.role);
  expect(input.target.model).toEqual({
    harness: "codex",
    model: "gpt-6.1-sol",
    providerAccountId: "work",
    modelSettings: { reasoningEffort: "high" },
  });
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(await mocks.helper.mock.results[0].value).toEqual({ text: "Reply", tokens: 15 });
});
it("preserves request source across retries and changed payload; separates actors and operations", async () => {
  mocks.run.mockResolvedValue("Reply");
  const generate = socialAgentGenerator("host-social", {} as import("../store").HostStore);
  const agent = { provider: "codex" as const, model: "gpt-6.1-sol" };
  const signal = new AbortController().signal;
  await generate(agent, "First", signal, { operationId: "request-1", actorScope: "owner-1" });
  await generate(agent, "Changed", signal, { operationId: "request-1", actorScope: "owner-1" });
  await generate(agent, "First", signal, { operationId: "request-2", actorScope: "owner-1" });
  await generate(agent, "First", signal, { operationId: "request-1", actorScope: "owner-2" });
  const inputs = mocks.helper.mock.calls.map((call) => call[1]);
  expect(inputs[0].source).toEqual(inputs[1].source);
  expect(inputs[0].source).not.toEqual(inputs[2].source);
  expect(inputs[0].source).not.toEqual(inputs[3].source);
});
it("fails before provider dispatch when Host request identity is absent", async () => {
  await expect(
    socialAgentGenerator("host-social", {} as import("../store").HostStore)(
      { provider: "codex", model: "gpt-6.1-sol" },
      "Prompt",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Host operation identity");
  expect(mocks.run).not.toHaveBeenCalled();
});

it("keeps missing provider usage unknown and forwards physical retirement observation", async () => {
  const onRetired = vi.fn();
  mocks.helper.mockImplementationOnce(async (_store, _input, run) => run(undefined, { onRetired }));
  mocks.run.mockResolvedValue("Reply");
  await socialAgentGenerator("host-social", {} as import("../store").HostStore)(
    { provider: "codex", model: "gpt-6.1-sol" },
    "Prompt",
    new AbortController().signal,
    { operationId: "request", actorScope: "owner" },
  );
  expect(mocks.run.mock.calls[0][0].onRetired).toBe(onRetired);
  expect(await mocks.helper.mock.results[0].value).toEqual({ text: "Reply" });
});
