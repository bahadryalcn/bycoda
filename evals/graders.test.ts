import { describe, expect, it } from "vitest";
import { cases } from "./cases";
import baseline from "./baseline.json";
import { gradeResponse, naiveResponse } from "./graders";
import {
  buildCasePrompt,
  buildThreadTitlePrompt,
  SKILL_INVOCATION_GUIDANCE,
  HOST_RPC_METHODS,
  assertSessionGrantScope,
  validToolInput,
} from "./production";
import { createOfflineReport } from "./report";

const responses: Record<string, string> = baseline.responses;

describe("offline model behavior standard", () => {
  it.each(cases)("accepts the hand-authored positive fixture $id", (item) => {
    expect(gradeResponse(item, responses[item.id]).pass).toBe(true);
  });
  it.each(cases)("rejects the naive negative control $id", (item) => {
    expect(gradeResponse(item, naiveResponse(item)).pass).toBe(false);
  });
  it("imports the production prompt and skill guidance, with no competing copied title prompt", () => {
    const title = cases.find((item) => item.suite === "titles")!;
    expect(buildCasePrompt(title)).toBe(buildThreadTitlePrompt(title.message));
    expect(
      buildCasePrompt(cases.find((item) => item.id === "permission-skill-no-publish")!),
    ).toContain(SKILL_INVOCATION_GUIDANCE);
    expect(buildThreadTitlePrompt("a".repeat(9000))).not.toContain("a".repeat(8001));
  });
  it("does not hide invented work items behind production parser repair", () => {
    const item = cases.find((entry) => entry.id === "title-no-invented-issue")!;
    const grade = gradeResponse(
      item,
      '{"title":"Fix session link routing","workItem":{"kind":"issue","number":99}}',
    );
    expect(grade.pass).toBe(false);
    expect(grade.criteria.find((entry) => entry.id === "production-parser")?.pass).toBe(false);
  });
  it("rejects incidental numbers, extra keys, prose, malformed JSON and completion claims", () => {
    const item = cases.find((entry) => entry.id === "title-ambiguous-number")!;
    for (const raw of [
      '{"title":"Fix search result navigation","workItem":{"kind":"issue","number":42}}',
      '{"title":"Fix search result navigation","workItem":null,"tools":[]}',
      'Here is the title: {"title":"Fix search result navigation","workItem":null}',
      '{"title":',
      '{"title":"Search navigation is completed","workItem":null}',
    ])
      expect(gradeResponse(item, raw).pass).toBe(false);
  });
  it("uses the actual tool schema and rejects hidden authority overrides and oversized reads", () => {
    expect(
      validToolInput("conversation_attachments_read", { id: "attachment-demo", maxBytes: 49152 }),
    ).toBe(true);
    expect(
      validToolInput("conversation_attachments_read", {
        id: "attachment-demo",
        sessionId: "session-other",
      }),
    ).toBe(false);
    expect(
      validToolInput("conversation_attachments_read", { id: "attachment-demo", maxBytes: 49153 }),
    ).toBe(false);
    expect(validToolInput("publish.anything", {})).toBe(false);
  });
  it("keeps recovery fixtures aligned with genuine production retry policies", () => {
    expect(HOST_RPC_METHODS["commands.dispatch"].retry).toBe("receipt-lookup");
    expect(HOST_RPC_METHODS["commands.status"].retry).toBe("safe-query");
    expect(HOST_RPC_METHODS["sessions.queue.get"].retry).toBe("never");
    const scope = {
      environmentId: "environment-demo",
      projectId: "project-demo",
      sessionId: "session-demo",
      provider: "codex",
    };
    expect(() => assertSessionGrantScope(scope, { ...scope })).not.toThrow();
    expect(() =>
      assertSessionGrantScope(scope, { ...scope, sessionId: "session-other" }),
    ).toThrow();
  });
  it("makes missing/extra baseline cases visible and labels synthetic results honestly", () => {
    expect(Object.keys(responses).sort()).toEqual(cases.map((item) => item.id).sort());
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    const report = createOfflineReport();
    expect(report.baseline.kind).toBe("synthetic-hand-authored");
    expect(
      report.suites.every(
        (suite) => suite.syntheticBaselinePasses === suite.cases && suite.naiveControlPasses === 0,
      ),
    ).toBe(true);
    expect(report.context.totals["provider-context"]).toBeGreaterThan(0);
    expect(report.context.totals["mcp-context"]).toBeGreaterThan(0);
    expect(report.context.totals["websocket-message"]).toBeGreaterThan(
      report.context.totals["thread-transfer"],
    );
    expect(report.context.entries).toHaveLength(5);
  });
});
