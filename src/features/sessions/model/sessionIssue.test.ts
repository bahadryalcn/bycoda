import { expect, it } from "vitest";
import { newSession } from "./session";
import { sessionIssue, sessionRetryNotice } from "./sessionIssue";
import { liveAgentsFromSessions } from "./liveAgents";
import { liveSessionInfos } from "./recentSessions";
import { historyWithLiveSessions, summaryFromSession } from "../data/sessionHistory";
import {
  appendUser,
  applyHarnessEvent,
  applyHarnessEvents,
  stopStreaming,
} from "../../../integrations/harness/core/apply";

it.each([
  ["Reconnecting... 3/5", true, "3/5"],
  ["Reconnecting… 2/5", true, "2/5"],
  ["Reconnecting…", true, undefined],
  ["Retrying (2/3)…", false, "2/3"],
  ["Retrying (1/3)...", false, "1/3"],
  ["Retrying (attempt 2): Service unavailable", false, "Retrying (attempt 2): Service unavailable"],
  ["Reconnecting to the MCP server failed", false, "Reconnecting to the MCP server failed"],
  ["Temporary service interruption", false, "Temporary service interruption"],
] as const)(
  "formats provider retry notice %s without losing error details",
  (message, reconnecting, detail) => {
    expect(sessionRetryNotice(message)).toEqual({ reconnecting, detail });
  },
);

it("shows retries without interrupting the transcript and clears them on streaming progress", () => {
  const working = appendUser(newSession("codex", "/repo"), "go");
  const retry = applyHarnessEvent(working, {
    type: "status",
    key: "provider-retry",
    text: "Reconnecting... 1/5",
  });
  expect(retry.blocks).toBe(working.blocks);
  expect(sessionIssue(retry)).toBe("retrying");
  expect(liveAgentsFromSessions([retry])[0]).toMatchObject({
    issue: "retrying",
    activity: "Retrying",
    done: false,
  });
  expect(liveSessionInfos([retry])[0].status).toBe("retrying");
  expect(
    sessionIssue(applyHarnessEvents(retry, [{ type: "message.delta", text: "recovered" }])),
  ).toBeUndefined();
  expect(stopStreaming(retry).retryMessage).toBeUndefined();
  expect(appendUser(retry, "new turn").retryMessage).toBeUndefined();
});

it("keeps failures distinct from Done and overlays existing history until a new prompt", () => {
  const working = appendUser(newSession("codex", "/repo"), "go");
  const stored = summaryFromSession(working);
  const failed = stopStreaming(
    applyHarnessEvent(working, { type: "session.error", message: "Service unavailable" }),
  );
  expect(sessionIssue(failed)).toBe("failed");
  expect(liveAgentsFromSessions([failed])[0]).toMatchObject({
    issue: "failed",
    activity: "Failed",
    done: true,
  });
  expect(liveSessionInfos([failed], new Set([failed.id]))[0].status).toBe("failed");
  expect(historyWithLiveSessions([stored], [failed], "/repo")[0].issue).toBe("failed");
  expect(sessionIssue(appendUser(failed, "try again"))).toBeUndefined();
});
