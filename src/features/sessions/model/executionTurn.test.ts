import { expect, it, vi } from "vitest";
import {
  appendUser,
  appendSteerUser,
  stopStreaming,
} from "../../../integrations/harness/core/apply";
import { newSession } from "./session";
import { liveAgentsFromSessions } from "./liveAgents";

it("keeps the execution owner's elapsed and completed duration across multiple steering messages", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1000);
    let session = appendUser(newSession("codex", "/repo"), "Start");
    session = { ...session, busy: true };
    const owner = session.blocks.at(-1)!;
    vi.setSystemTime(4000);
    session = appendSteerUser(session, "Steer");
    session = appendSteerUser(session, "Question answer");
    expect(session.blocks.at(-1)?.continuationOf).toBe(owner.id);
    expect(session.blocks.at(-1)?.startedAt).toBeUndefined();
    expect(liveAgentsFromSessions([session])[0]?.startedAt).toBe(1000);
    session = stopStreaming(session, 7000);
    expect(liveAgentsFromSessions([session], new Set([session.id]))[0]?.durationMs).toBe(6000);
    vi.setSystemTime(9000);
    session = { ...appendUser(session, "Next real turn"), busy: true };
    expect(liveAgentsFromSessions([session])[0]?.startedAt).toBe(9000);
  } finally {
    vi.useRealTimers();
  }
});

it("does not fabricate timing for an imported untimed turn after a completed earlier turn", () => {
  let session = newSession("codex", "/repo");
  session.blocks = [
    { id: "old", role: "user", text: "Old", startedAt: 1000, durationMs: 100 },
    { id: "imported", role: "user", text: "Untimed" },
  ];
  session = appendSteerUser({ ...session, busy: true }, "Follow up");
  expect(liveAgentsFromSessions([session])[0]?.startedAt).toBeUndefined();
  session = stopStreaming(session, 8000);
  expect(session.blocks[0].durationMs).toBe(100);
  expect(session.blocks[1].durationMs).toBeUndefined();
});
