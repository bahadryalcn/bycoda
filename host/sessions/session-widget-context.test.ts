import { expect, it } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { sessionWidgetContext } from "./session-widget-context";

it("projects short pending question and real turn timing; classifies only structured failure signals", () => {
  const value = {
    status: "running",
    session: {
      blocks: [],
      pendingQuestion: { questions: [{ prompt: "Deploy?" }] },
      usageLimit: {},
    },
  } as unknown as HostSession;
  expect(sessionWidgetContext(value, 123)).toEqual({
    questionPrompt: "Deploy?",
    startedAt: 123,
    failureCategory: "rate_limited",
  });
  expect(
    sessionWidgetContext({
      ...value,
      status: "interrupted",
      session: { ...value.session, usageLimit: undefined, pendingQuestion: undefined },
    }),
  ).toEqual({ failureCategory: "stopped" });
  value.session.pendingQuestion!.delivery = "queued";
  expect(sessionWidgetContext(value)?.questionPrompt).toBeUndefined();
  expect(
    sessionWidgetContext({ ...value, session: { ...value.session, usageLimit: undefined } })
      ?.failureCategory,
  ).toBe("failed");
});

it("does not label idle as completed without authoritative turn timing", () => {
  const idle = { status: "idle", session: { blocks: [] } } as unknown as HostSession;
  expect(sessionWidgetContext(idle)?.completedAt).toBeUndefined();
  expect(sessionWidgetContext(idle, 100, 50)?.completedAt).toBe(150);
});
