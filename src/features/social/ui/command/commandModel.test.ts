import { describe, expect, it } from "vitest";
import type { AiAction } from "../../model/autonomy";
import type { AiPlanStep, NeedsHumanItem } from "../../model/socialActions";
import { AI_MODEL_REQUIRED_MESSAGE } from "../../model/socialTools";
import {
  activityKind,
  activityStatus,
  activityTitle,
  groupActivityByDay,
  isModelRequired,
  needsHumanReason,
  pendingApprovalIds,
  stepStatusLabel,
  summaryCards,
  undoBlockedReason,
} from "./commandModel";

const step = (id: string, needsApproval: boolean): AiPlanStep => ({
  id,
  action: "replies.send",
  input: {},
  summary: id,
  needsApproval,
});

const action = (patch: Partial<AiAction>): AiAction => ({
  id: "a1",
  at: 0,
  actor: "owner",
  action: "replies.send",
  summary: "replies.send · account a1",
  status: "done",
  ...patch,
});

describe("Command screen model", () => {
  it("lists only unfinished steps that need approval", () => {
    const steps = [step("s1", true), step("s2", false), step("s3", true)];
    expect(pendingApprovalIds(steps, {})).toEqual(["s1", "s3"]);
    expect(pendingApprovalIds(steps, { s1: { stepId: "s1", status: "done" } })).toEqual(["s3"]);
    expect(pendingApprovalIds(steps, { s3: { stepId: "s3", status: "failed" } })).toEqual(["s1"]);
  });

  it("says what each step will do before and after the run", () => {
    expect(stepStatusLabel(step("s1", false), undefined, false)).toBe("Will run automatically");
    expect(stepStatusLabel(step("s1", true), undefined, false)).toBe("Needs your approval");
    expect(stepStatusLabel(step("s1", true), undefined, true)).toBe("Approved");
    expect(stepStatusLabel(step("s1", true), { stepId: "s1", status: "blocked" }, false)).toBe(
      "Blocked",
    );
  });

  it("shows dashes before the summary loads and percentages after", () => {
    expect(summaryCards().map((card) => card.value)).toEqual(["—", "—", "—", "—"]);
    expect(
      summaryCards({
        sentToday: 3,
        pending: 2,
        newPeople: 5,
        replyRate: 0.25,
        waitingForYou: 0,
      }).map((card) => card.value),
    ).toEqual(["3", "2", "5", "25%"]);
  });

  it("matches only the exact missing-model message for the setup card", () => {
    expect(isModelRequired(AI_MODEL_REQUIRED_MESSAGE)).toBe(true);
    expect(isModelRequired("Connect a social account before asking AI to plan.")).toBe(false);
    expect(isModelRequired(undefined)).toBe(false);
  });

  it("offers undo only for recorded inverses that have not run", () => {
    expect(undoBlockedReason(action({}))).toBe("This action cannot be undone.");
    expect(
      undoBlockedReason(action({ undo: { action: "lists.removeMembers", input: {} } })),
    ).toBeUndefined();
    expect(
      undoBlockedReason(
        action({ status: "undone", undo: { action: "lists.removeMembers", input: {} } }),
      ),
    ).toBe("Already undone.");
  });

  it("uses a plain title for known operations and the Host summary otherwise", () => {
    expect(activityTitle(action({ action: "replies.send" }))).toBe("Sent a reply");
    expect(activityTitle(action({ action: "captureRules.delete" }))).toBe(
      "replies.send · account a1",
    );
  });

  it("maps every action status to a plain status word the owner can read", () => {
    expect(
      (["done", "failed", "queued", "blocked", "undone"] as const).map((status) =>
        activityStatus(action({ status })),
      ),
    ).toEqual(["succeeded", "failed", "review", "cancelled", "cancelled"]);
  });

  it("tells the owner what to do for each browser check reason", () => {
    const reasons: NeedsHumanItem["reason"][] = [
      "challenge",
      "verification",
      "login",
      "unexpected_screen",
    ];
    const texts = reasons.map((reason) => needsHumanReason({ reason } as NeedsHumanItem));
    expect(texts).toEqual([
      "A security check is open. Complete it yourself.",
      "A verification code is requested. Enter it yourself.",
      "Sign in to continue.",
      "The site showed a screen AI does not recognize.",
    ]);
  });

  it("maps Host action families to the icon kinds", () => {
    const kinds = [
      "replies.send",
      "comments.send",
      "campaigns.schedule",
      "messages.send",
      "email.send",
      "lists.addMembers",
      "people.update",
      "ai.stop",
    ].map((name) => activityKind(action({ action: name })));
    expect(kinds).toEqual([
      "reply",
      "reply",
      "publish",
      "message",
      "message",
      "audience",
      "audience",
      "other",
    ]);
  });

  it("groups a newest-first feed by local day with Today and Yesterday labels", () => {
    const now = new Date(2026, 10, 8, 15, 0).getTime();
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
    const groups = groupActivityByDay(
      [
        action({ id: "a", at: at(8, 14) }),
        action({ id: "b", at: at(8, 9) }),
        action({ id: "c", at: at(7, 23) }),
        action({ id: "d", at: at(2, 10) }),
      ],
      now,
    );
    expect(groups.map((group) => group.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);
    expect(groups[2]?.label).not.toMatch(/Today|Yesterday/);
  });

  it("gives only the loaded reply rate a meter value, clamped to 0-100", () => {
    expect(summaryCards().find((card) => card.key === "reply")?.percent).toBeUndefined();
    const loaded = (replyRate: number) =>
      summaryCards({ sentToday: 0, pending: 0, newPeople: 0, replyRate, waitingForYou: 0 }).find(
        (card) => card.key === "reply",
      )?.percent;
    expect(loaded(0.254)).toBe(25);
    expect(loaded(1.4)).toBe(100);
  });
});
