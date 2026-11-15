import { expect, it } from "vitest";
import { queuedRowAuthor, withPlanBuildTarget } from "./sessionHelpers";
import { newSession } from "../../../features/sessions/model/session";

it("starts a queued row's new provider on the account it was queued with", () => {
  const session = {
    ...newSession("claude", "/repo"),
    providerAccountId: "claude-work",
    blocks: [{ id: "u1", role: "user" as const, text: "earlier" }],
  };
  const next = withPlanBuildTarget(session, {
    harness: "codex",
    model: "codex:gpt-6.1-sol",
    modelSettings: {},
    providerAccountId: "codex-personal",
  });
  expect(next).toMatchObject({ harness: "codex", providerAccountId: "codex-personal" });
  expect(next.pendingSwitch).toMatchObject({
    from: "claude",
    fromProviderAccountId: "claude-work",
  });
});

it("leaves the account unset when the queued row carries none", () => {
  const session = {
    ...newSession("claude", "/repo"),
    providerAccountId: "claude-work",
    blocks: [{ id: "u1", role: "user" as const, text: "earlier" }],
  };
  const next = withPlanBuildTarget(session, {
    harness: "codex",
    model: "codex:gpt-6.1-sol",
    modelSettings: {},
  });
  expect(next.providerAccountId).toBeUndefined();
});

it("carries the Host's stamp of a queued subagent notice, and nothing for owner rows", () => {
  const author = {
    kind: "delegation",
    runId: "run",
    title: "Child",
    reason: "completion",
  } as const;
  const session = {
    ...newSession("claude", "/repo"),
    queuedMessages: [
      { id: "agent_message_1", text: "Done", attachments: [], author },
      { id: "owner", text: "Next", attachments: [] },
    ],
  };
  expect(queuedRowAuthor(session, "agent_message_1")).toEqual({ author });
  expect(queuedRowAuthor(session, "owner")).toBeUndefined();
  expect(queuedRowAuthor(session, "missing")).toBeUndefined();
  expect(queuedRowAuthor(session, undefined)).toBeUndefined();
});
