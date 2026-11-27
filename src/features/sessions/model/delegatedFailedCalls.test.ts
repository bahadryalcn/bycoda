import { describe, expect, it } from "vitest";
import { placeDelegatedCards } from "./delegatedCards";
import { failedAskCard } from "./delegatedFailedCalls";
import type { Block } from "./session";
import { subagentReport, toolCallState } from "./transcriptActivity";

const call = (
  title: string,
  detail: string | undefined,
  status = "completed",
  extra: Partial<NonNullable<Block["tool"]>> = {},
): Block => ({
  id: "d1",
  role: "tool",
  text: title,
  tool: {
    kind: "other",
    title,
    status,
    ...(detail ? { detail } : {}),
    ...extra,
  },
});

describe("failedAskCard", () => {
  it("shows a delegate call that returned an error object as a failed subagent card", () => {
    const card = failedAskCard(
      call("bycoda-conversation:conversation_agents_delegate", '{"error":"Model unavailable"}'),
    );
    expect(card?.id).toBe("d1");
    expect(card?.tool?.kind).toBe("subagent");
    expect(toolCallState(card!)).toBe("rejected");
    expect(subagentReport(card!)).toBe("Model unavailable");
    expect(card?.agentRun).toMatchObject({ name: "Subagent", steps: [], unstarted: true });
  });

  it("names a consult call's card Advisor and reads a nested error message", () => {
    const card = failedAskCard(call("agents.consult", '{"error":{"message":"Limit reached"}}'));
    expect(card?.agentRun?.name).toBe("Advisor");
    expect(subagentReport(card!)).toBe("Limit reached");
  });

  it("uses the plain result text of a call marked failed, and the model the preview names", () => {
    const card = failedAskCard(
      call("agents.delegate", "Skill preparation failed", "failed", {
        preview: { kind: "read", path: "grok:grok-4.6" },
      }),
    );
    expect(subagentReport(card!)).toBe("Skill preparation failed");
    expect(card?.agentRun?.model).toBe("grok:grok-4.6");
  });

  it("leaves started, running, empty and unrelated calls alone", () => {
    expect(
      failedAskCard(call("agents.delegate", '{"runId":"r","sessionId":"c1"}')),
    ).toBeUndefined();
    expect(
      failedAskCard(call("agents.delegate", '{"error":"x","sessionId":"c1"}')),
    ).toBeUndefined();
    expect(failedAskCard(call("agents.delegate", undefined, "running"))).toBeUndefined();
    expect(failedAskCard(call("agents.delegate", '{"error":"x"}', "running"))).toBeUndefined();
    expect(failedAskCard(call("agents.wait", '{"error":"x"}'))).toBeUndefined();
    expect(failedAskCard(call("agents.delegate", "plain text"))).toBeUndefined();
  });

  it("replaces the call in the transcript even with no child session", () => {
    const blocks = [call("agents.delegate", '{"error":"no model"}')];
    const placed = placeDelegatedCards(blocks, []);
    expect(placed).toHaveLength(1);
    expect(placed[0].tool?.kind).toBe("subagent");
  });
});
