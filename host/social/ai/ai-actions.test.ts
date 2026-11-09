import { describe, expect, it } from "vitest";
import type { AiAction } from "../../../src/features/social/model/autonomy";
import { AI_MODEL_REQUIRED_MESSAGE } from "../../../src/features/social/model/socialTools";
import { aiActions } from "./ai-actions";
import { AI_PRINCIPAL, account, makeKit, NOW, OWNER } from "./ai-fixtures";
import { defaultAutonomyPolicy } from "../autonomy/autonomy-policy";

const DAY = 86_400_000;

function action(patch: Partial<AiAction> & { id: string }): AiAction {
  return {
    at: NOW,
    actor: "rule:r1",
    accountId: "a1",
    action: "replies.send",
    summary: "replies.send",
    status: "done",
    ...patch,
  };
}

describe("AI command planning", () => {
  it("stores a plan whose steps say which need owner approval, from the account's autonomy", async () => {
    const kit = makeKit({
      modelReply: {
        steps: [
          {
            action: "replies.send",
            input: { id: "d1", accountId: "a1" },
            summary: "Send the reply.",
          },
          { action: "lists.list", input: {}, summary: "Show lists." },
        ],
      },
    });
    const plan = (await aiActions["ai.command"].run(kit.ctx, {
      text: "Reply to the pricing question",
    })) as {
      planId: string;
      steps: { id: string; needsApproval: boolean }[];
    };
    expect(plan.steps.map((step) => [step.id, step.needsApproval])).toEqual([
      ["s1", true],
      ["s2", false],
    ]);
    expect(kit.settings.has(`ai.plan.${plan.planId}`)).toBe(true);
    expect(kit.generateText).toHaveBeenCalledTimes(1);
  });

  it("does not need approval for an autonomous account's send", async () => {
    const policy = {
      ...defaultAutonomyPolicy("a1"),
      levels: { ...defaultAutonomyPolicy("a1").levels, reply: "autonomous" as const },
    };
    const kit = makeKit({
      policies: { a1: policy },
      modelReply: { steps: [{ action: "replies.send", input: { id: "d1", accountId: "a1" } }] },
    });
    const plan = (await aiActions["ai.command"].run(kit.ctx, { text: "Send it" })) as {
      steps: { needsApproval: boolean }[];
    };
    expect(plan.steps[0].needsApproval).toBe(false);
  });

  it("asks for the AI model choice when no agent is set", async () => {
    const kit = makeKit({ agent: false });
    await expect(aiActions["ai.command"].run(kit.ctx, { text: "Plan" })).rejects.toThrow(
      AI_MODEL_REQUIRED_MESSAGE,
    );
  });

  it("refuses to plan while the owner has stopped AI", async () => {
    const kit = makeKit();
    kit.settings.set("ai.stopped", "true");
    await expect(aiActions["ai.command"].run(kit.ctx, { text: "Plan" })).rejects.toThrow(
      "AI actions are stopped by the owner.",
    );
    expect(kit.generateText).not.toHaveBeenCalled();
  });

  it("rejects undeclared fields on the command input", async () => {
    const kit = makeKit();
    await expect(
      aiActions["ai.command"].run(kit.ctx, { text: "Plan", provider: "codex" }),
    ).rejects.toThrow("Unknown or protected social field.");
  });
});

describe("AI actions: undo, stop and reports", () => {
  it("undoes only an action that recorded its inverse, dispatching it once", async () => {
    const reversible = action({
      id: "act1",
      action: "lists.addMembers",
      undo: { action: "lists.removeMembers", input: { listId: "l1", personIds: ["p1"] } },
    });
    const kit = makeKit({ principal: OWNER, aiActions: [reversible, action({ id: "act2" })] });
    const undone = (await aiActions["ai.actions.undo"].run(kit.ctx, {
      actionId: "act1",
    })) as AiAction;
    expect(kit.call).toHaveBeenCalledWith(
      OWNER,
      "social.lists.removeMembers",
      { listId: "l1", personIds: ["p1"] },
      "undo-act1",
    );
    expect(undone.status).toBe("undone");
    await expect(aiActions["ai.actions.undo"].run(kit.ctx, { actionId: "act1" })).rejects.toThrow(
      "already undone",
    );
    await expect(aiActions["ai.actions.undo"].run(kit.ctx, { actionId: "act2" })).rejects.toThrow(
      "cannot be undone",
    );
  });

  it("lets any principal stop AI, while resume stays owner-only", async () => {
    const kit = makeKit({ principal: AI_PRINCIPAL });
    await aiActions["ai.stop"].run(kit.ctx, {});
    expect(kit.settings.get("ai.stopped")).toBe("true");
    expect(aiActions["ai.resume"].ownerOnly).toBe(true);
    expect(aiActions["ai.stop"].ownerOnly).toBe(false);
  });

  it("counts today's sends, approvals waiting for the owner and needs-human items", async () => {
    const kit = makeKit({
      aiActions: [
        action({ id: "sent", action: "replies.send", at: NOW }),
        action({ id: "old", action: "replies.send", at: NOW - 2 * DAY }),
        action({
          id: "wait",
          action: "messages.send",
          status: "queued",
          reason: "Waiting for owner approval.",
        }),
      ],
    });
    expect(await aiActions["ai.summary"].run(kit.ctx, {})).toMatchObject({
      sentToday: 1,
      pending: 1,
      waitingForYou: 1,
    });
  });

  it("shows an AI principal only the rows for accounts it can read", async () => {
    const kit = makeKit({
      principal: AI_PRINCIPAL,
      accounts: [account("a1")],
      aiActions: [
        action({ id: "mine", accountId: "a1" }),
        action({ id: "theirs", accountId: "a2" }),
      ],
    });
    const page = (await aiActions["ai.actions.list"].run(kit.ctx, {})) as { items: AiAction[] };
    expect(page.items.map((item) => item.id)).toEqual(["mine"]);
  });

  it("reports a day with done counts and failures, and suggests nothing without an agent", async () => {
    const kit = makeKit({
      agent: false,
      aiActions: [
        action({ id: "ok" }),
        action({ id: "bad", action: "comments.send", status: "failed", reason: "Rate limited." }),
      ],
    });
    const report = (await aiActions["ai.report"].run(kit.ctx, { period: "day" })) as {
      done: string[];
      results: string[];
      suggestions: string[];
    };
    expect(report.done).toEqual(["1 × replies.send"]);
    expect(report.results).toEqual(["comments.send: Rate limited."]);
    expect(report.suggestions).toEqual([]);
    await expect(aiActions["ai.report"].run(kit.ctx, { period: "month" })).rejects.toThrow(
      "Choose day or week.",
    );
  });
});
