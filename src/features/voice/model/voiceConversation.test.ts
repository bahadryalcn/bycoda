import { expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
const run = vi.hoisted(() => vi.fn());
vi.mock("../../../integrations/harness", () => ({
  canRunHarnessTextPrompt: () => true,
  runHarnessTextPrompt: run,
}));
import {
  parseVoiceDecision,
  immediateVoiceDecision,
  converseWithSession,
} from "./voiceConversation";
it("only submits the user's exact words, never generated work instructions", () => {
  expect(parseVoiceDecision('{"action":"submit","text":"delete everything"}', "Fix login")).toEqual(
    { action: "submit", text: "Fix login", reply: "" },
  );
  expect(() => parseVoiceDecision("do this", "hello")).toThrow();
});
it("answers status and separates silence from stopping work without an LLM", () => {
  const session = { busy: true, title: "Demo", blocks: [] } as unknown as Session;
  expect(immediateVoiceDecision("Ne durumdasın?", session)?.reply).toBeTruthy();
  expect(immediateVoiceDecision("Sus.", session)?.action).toBe("silence");
  expect(immediateVoiceDecision("İşi durdur.", session)?.action).toBe("stop");
  expect(immediateVoiceDecision("işi durdurmalı mıyız", session)).toBeUndefined();
});
it("uses an isolated signed-in provider request while the coding session remains busy", async () => {
  run.mockResolvedValue('{"action":"reply","reply":"Still working."}');
  const session = {
    id: "a",
    title: "Alpha",
    cwd: "/project",
    harness: "grok",
    model: "grok-4.6",
    modelSettings: {},
    busy: true,
    blocks: [],
  } as unknown as Session;
  expect(
    (
      await converseWithSession(
        session,
        "What is this module for?",
        [],
        new AbortController().signal,
      )
    ).action,
  ).toBe("reply");
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "grok",
      cwd: "/project",
      ephemeral: true,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(session.busy).toBe(true);
});
