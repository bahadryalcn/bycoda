import { describe, expect, it } from "vitest";
import {
  applyTaskWorkflow,
  BUILTIN_TASK_WORKFLOWS,
  loadTaskWorkflows,
  parseTaskWorkflowDraft,
  parseTaskWorkflowProfile,
  saveTaskWorkflows,
  taskWorkflowsStorageKey,
} from "./taskWorkflows";
import { readTaskInstructions } from "./taskInstructions";

const scope = { machineId: "host-a", projectId: "project-a" };
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
const profile = () => ({
  ...BUILTIN_TASK_WORKFLOWS[0],
  id: "saved-a",
  name: "My bug workflow",
  createdAt: 10,
  updatedAt: 10,
});

describe("saved task workflows", () => {
  it("applies a saved plain-language procedure without losing the new request", () => {
    const saved = {
      ...profile(),
      draft: { prompt: "Read primary sources, draft the result, then verify every claim." },
    };
    const first = applyTaskWorkflow(saved, { prompt: "Explain the new import workflow" });
    expect(first.prompt).toContain("Explain the new import workflow");
    expect(first.prompt).toContain(saved.draft.prompt);
    expect(applyTaskWorkflow(saved, first).prompt).toBe(first.prompt);
    const structured = applyTaskWorkflow(saved, {
      prompt: JSON.stringify({
        schema: "bycoda.task.v1",
        objective: "Write the report",
        deliverables: ["report.md"],
        acceptance: ["Check every claim"],
        constraints: ["Do not publish"],
        verification: [],
      }),
    });
    expect(readTaskInstructions(structured.prompt)).toMatchObject({
      deliverables: ["report.md"],
      constraints: ["Do not publish"],
    });
    expect(readTaskInstructions(structured.prompt)?.objective).toContain(saved.draft.prompt);
  });
  it("round trips a bounded profile in its host/project scope", () => {
    const store = storage();
    const saved = {
      ...profile(),
      draft: {
        ...profile().draft,
        verifyCommand: "pnpm test -- reported.test.ts",
        modelSettings: { effort: "high" },
        requirements: [{ kind: "source" as const, id: "sources/brief.md" }],
      },
    };
    saveTaskWorkflows(scope, [saved], store);
    expect(loadTaskWorkflows(scope, store)).toEqual([saved]);
    expect(loadTaskWorkflows({ ...scope, machineId: "host-b" }, store)).toEqual([]);
    expect(loadTaskWorkflows({ ...scope, projectId: "project-b" }, store)).toEqual([]);
    expect(taskWorkflowsStorageKey({ machineId: "a,b", projectId: "c" })).not.toBe(
      taskWorkflowsStorageKey({ machineId: "a", projectId: "b,c" }),
    );
  });

  it("preserves the current objective, existing criteria and current resource references on explicit apply", () => {
    const current = {
      prompt: JSON.stringify({
        schema: "bycoda.task.v1",
        objective: "Fix the failed card payment",
        deliverables: ["Payment fix"],
        acceptance: ["Existing payment drafts survive"],
        constraints: ["No live payment"],
        verification: ["Check card fixture"],
      }),
      modelSettings: { verbosity: "low" },
      requirements: [{ kind: "source" as const, id: "payment-spec.md" }],
    };
    const before = JSON.stringify(current);
    const applied = applyTaskWorkflow(profile(), current);
    expect(readTaskInstructions(applied.prompt)).toMatchObject({
      objective: "Fix the failed card payment",
      deliverables: ["Payment fix", "A focused fix for the reported defect"],
      acceptance: expect.arrayContaining(["Existing payment drafts survive"]),
      constraints: expect.arrayContaining(["No live payment"]),
    });
    expect(applied.requirements).toEqual(current.requirements);
    expect(JSON.stringify(current)).toBe(before);
  });

  it("keeps a freeform draft and does not copy provider identities or action permissions", () => {
    const applied = applyTaskWorkflow(BUILTIN_TASK_WORKFLOWS[1], {
      prompt: "Investigate the report from October",
    });
    expect(readTaskInstructions(applied.prompt)?.objective).toBe(
      "Investigate the report from October",
    );
    expect(applied).not.toHaveProperty("autoMerge");
    expect(applied).not.toHaveProperty("providerAccountId");
    expect(() => parseTaskWorkflowDraft({ prompt: "a", autoMerge: true })).toThrow();
    expect(() =>
      parseTaskWorkflowDraft({ prompt: "a", providerAccountId: "private-account" }),
    ).toThrow();
  });

  it("rejects credential configuration and unbounded or malformed stored records", () => {
    expect(() =>
      parseTaskWorkflowDraft({ prompt: "a", modelSettings: { api_key: "secret" } }),
    ).toThrow();
    expect(() =>
      parseTaskWorkflowDraft({
        prompt: "a",
        requirements: [{ kind: "connection", id: "https://user:pass@example.test/page" }],
      }),
    ).toThrow();
    expect(() => parseTaskWorkflowProfile({ ...profile(), createdAt: NaN })).toThrow();
    expect(() => parseTaskWorkflowProfile({ ...profile(), updatedAt: 9 })).toThrow();
    expect(() => parseTaskWorkflowDraft({ prompt: "x".repeat(64_001) })).toThrow();
    expect(() =>
      saveTaskWorkflows(
        scope,
        Array.from({ length: 41 }, (_, index) => ({ ...profile(), id: `p-${index}` })),
        storage(),
      ),
    ).toThrow();
  });

  it("does not overwrite malformed stored data during reads", () => {
    const store = storage();
    const key = taskWorkflowsStorageKey(scope);
    store.setItem(key, "broken JSON");
    expect(() => loadTaskWorkflows(scope, store)).toThrow();
    expect(store.getItem(key)).toBe("broken JSON");
    expect(() => saveTaskWorkflows(scope, [profile(), profile()], store)).toThrow();
  });

  it("keeps reviewer configuration and ordinary token-count model controls without secret credentials", () => {
    const draft = parseTaskWorkflowDraft({
      prompt: "Prepare result",
      review: true,
      modelSettings: { max_tokens: "1000" },
      reviewerConfig: {
        harness: "claude",
        model: "claude:test",
        modelSettings: { effort: "high" },
        instructions: "Inspect sources before accepting.",
      },
    });
    expect(draft.reviewerConfig?.modelSettings.effort).toBe("high");
    expect(draft.modelSettings?.max_tokens).toBe("1000");
  });
});
