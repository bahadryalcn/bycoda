import { expect, it } from "vitest";
import { summary } from "./store";
import { newSession } from "../src/features/sessions/model/session";
import {
  appendUser,
  applyHarnessEvent,
  stopStreaming,
} from "../src/integrations/harness/core/apply";

it("includes retry and failure attention in host summaries and clears it after recovery", () => {
  const working = appendUser(newSession("codex", "/repo"), "go");
  const retry = applyHarnessEvent(working, {
    type: "status",
    key: "provider-retry",
    text: "Reconnecting... 1/5",
  });
  const host = {
    session: retry,
    projectId: "project",
    revision: 2,
    updatedAt: 100,
    status: "running" as const,
  };
  expect(summary(host)).toMatchObject({
    issue: "retrying",
    issueTurnId: working.blocks[0].id,
    issueMessage: "Reconnecting... 1/5",
  });
  const recovered = applyHarnessEvent(retry, { type: "message.delta", text: "Recovered" });
  expect(summary({ ...host, session: recovered }).issue).toBeUndefined();
  const failed = stopStreaming(
    applyHarnessEvent(retry, { type: "session.error", message: "Connection failed" }),
  );
  expect(summary({ ...host, session: failed, status: "idle" })).toMatchObject({
    issue: "failed",
    issueMessage: "Connection failed",
  });
});
