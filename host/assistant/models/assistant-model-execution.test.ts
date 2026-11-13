import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../src/shared/model/host-contracts/model-routing";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import { selectModelRouting } from "../../model-routing/selector";
import type { ModelRoutingService } from "../../model-routing/service";
import {
  createAssistantModelSelector,
  chooseAssistantExecution,
} from "./assistant-model-execution";
import { modelHoldRecord, modelHoldNotification } from "../work/assistant-model-hold";

const profile = {
  execution: {
    harness: "codex",
    model: "profile-model",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 42,
  },
} as AssistantProfile;
const state = (): ModelRoutingState => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  version: 1,
  updatedAt: 1,
  entries: ["a", "b"].map((id) => ({
    id,
    harness: "codex",
    model: id,
    providerAccountId: "work",
    modelSettings: { effort: "high" },
    minRemainingPercent: 20,
    unknownLimit: "use",
  })),
  pools: [{ id: "replies", name: "Replies", entryIds: ["b"] }],
  roles: {
    "assistant.reply": { kind: "pool", poolId: "replies" },
    "assistant.chief": {
      kind: "fixed",
      target: { harness: "claude", model: "chief", modelSettings: {} },
    },
  },
});
function setup(draft = state(), limited = false) {
  const resolve = vi.fn(async (input) =>
    selectModelRouting(draft, input, {
      available: () => true,
      signedIn: () => true,
      quota: () => ({ leftPercent: limited ? 0 : 100, resetsAt: 5000 }),
    }),
  );
  return {
    selector: createAssistantModelSelector({
      routing: () => ({ resolve }) as unknown as ModelRoutingService,
    }),
    resolve,
  };
}
describe("assistant routing", () => {
  it("resolves order, per-role pool and fixed binding, retaining profile permissions and deadline", async () => {
    const { selector } = setup();
    expect(await selector("worker", profile)).toMatchObject({
      rowId: "a",
      execution: {
        model: "a",
        providerAccountId: "work",
        runtimeMode: "supervised",
        maxRunMinutes: 42,
      },
    });
    expect(await selector("reply", profile)).toMatchObject({
      rowId: "b",
      execution: { model: "b" },
    });
    expect(await selector("chief", profile)).toMatchObject({
      rowId: "fixed",
      execution: { model: "chief" },
    });
    expect(await selector("planning", profile)).toMatchObject({ execution: { model: "a" } });
  });
  it("unconfigured routing keeps profile role execution", async () => {
    const draft = state();
    draft.entries = [];
    draft.roles = {};
    expect(await setup(draft).selector("worker", profile)).toBeNull();
  });
  it("noEligibleEntry feeds the existing hold and stable notification identity", async () => {
    const { selector } = setup(state(), true);
    expect(await selector("worker", profile)).toEqual({
      held: "limits",
      nextResetAt: 5000,
      reason: "noEligibleEntry",
    });
    try {
      await chooseAssistantExecution(selector, "worker", profile);
      throw new Error("expected hold");
    } catch (error) {
      expect(error).toMatchObject({ name: "AssistantModelsHeldError", nextResetAt: 5000 });
      const one = modelHoldNotification(
        { id: "job", title: "Job" },
        modelHoldRecord(error as never, 10),
      );
      const two = modelHoldNotification(
        { id: "job", title: "Job" },
        modelHoldRecord(error as never, 20),
      );
      expect(one.id).toBe(two.id);
      expect(one.body).toContain("No eligible model");
    }
  });
  it("never resolves an existing provider thread again, including an existing thread", async () => {
    const { selector, resolve } = setup();
    expect(await selector("chief", profile, "old-thread")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("persists a concrete target before reusing a Chief provider thread", async () => {
    const records = new Map<string, unknown>();
    const routing = setup();
    const selector = createAssistantModelSelector({
      routing: () => ({ resolve: routing.resolve }) as unknown as ModelRoutingService,
      repository: {
        get: async (_table: string, id: string) => records.get(id),
        put: async (_table: string, row: { id: string }) => {
          records.set(row.id, row);
        },
      } as never,
    });
    const choice = await chooseAssistantExecution(selector, "chief", profile);
    await selector.rememberThread!("thread", choice!);
    routing.resolve.mockClear();
    expect(await selector("chief", profile, "thread")).toEqual(choice);
    expect(routing.resolve).not.toHaveBeenCalled();
  });
});
