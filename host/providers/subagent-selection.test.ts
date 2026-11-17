import { expect, it, vi } from "vitest";
import { withSubagentSelection } from "./subagent-selection";

const parent =
  '{"parentSessionId":"p","runId":"r","kind":"subagent","model":"claude:sonnet","startedAt":1,"round":1}';

it("holds a Host-run turn's native subagents and advisor to the owner's selection", async () => {
  const send = vi.fn(async (_input: { modelSettings?: Record<string, string> }) => {});
  const claude = withSubagentSelection("claude", { send } as never) as unknown as {
    send(input: object): Promise<void>;
  };
  await claude.send({
    sessionId: "s",
    providerAccountId: "work",
    modelSettings: {
      crossSubagents: "[]",
      crossAdvisor: '{"harness":"codex","model":"codex:gpt"}',
      delegationParent: parent,
      subagentPolicy: "force",
    },
  });
  const settings = send.mock.calls[0]![0].modelSettings!;
  // Explicit Off removes Claude's Agent/Task tool; another provider's advisor is not native.
  expect(settings.subagentModel).toBe("off");
  expect(settings.advisor).toBe("off");
  expect(settings).not.toHaveProperty("subagentPolicy");
  // bycoda-owned keys stay for the Host's own wrappers (crew tools, chat-only children).
  expect(settings.delegationParent).toBe(parent);
  expect(settings.crossSubagents).toBe("[]");

  const codexSend = vi.fn(async (_input: { modelSettings?: Record<string, string> }) => {});
  const codex = withSubagentSelection("codex", { send: codexSend } as never) as unknown as {
    send(input: object): Promise<void>;
  };
  await codex.send({ sessionId: "s", modelSettings: { crossSubagents: "[]" } });
  expect(codexSend.mock.calls[0]![0].modelSettings!.nativeSubagents).toBe("off");
});

it("leaves a turn without a selection untouched", async () => {
  const send = vi.fn(async (_input: object) => {});
  const claude = withSubagentSelection("claude", { send } as never) as unknown as {
    send(input: object): Promise<void>;
  };
  const input = { sessionId: "s", modelSettings: { effort: "high" } };
  await claude.send(input);
  expect(send.mock.calls[0]![0]).toEqual(input);
});
