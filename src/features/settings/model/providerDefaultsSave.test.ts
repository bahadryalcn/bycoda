// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { saveDefaultsTargets, saveDefaultsTargetsWithDelegation } from "./providerDefaultsSave";
import { EMPTY_MODEL_ROUTING } from "../../../shared/model/host-contracts/model-routing";
import { EMPTY_DRAFT, type DefaultsTarget } from "./providerDefaultsDraft";

it("attempts every target, reports partial refusal, and retries only failed targets", () => {
  const targets: DefaultsTarget[] = [
    { kind: "global" },
    { kind: "project", path: "C:/one" },
    { kind: "project", path: "C:/two" },
  ];
  const save = vi
    .fn()
    .mockReturnValueOnce({ state: "saved" })
    .mockReturnValueOnce({ state: "unsaved", message: "Storage refused" })
    .mockReturnValueOnce({ state: "saved" });
  const result = saveDefaultsTargets(EMPTY_DRAFT, targets, save);
  expect(result.saved).toEqual([targets[0], targets[2]]);
  expect(result.failed).toEqual([{ target: targets[1], message: "Storage refused" }]);
  save.mockReset().mockReturnValue({ state: "saved" });
  expect(
    saveDefaultsTargets(
      EMPTY_DRAFT,
      result.failed.map((entry) => entry.target),
      save,
    ).failed,
  ).toEqual([]);
  expect(save).toHaveBeenCalledExactlyOnceWith(EMPTY_DRAFT, targets[1]);
});

it("continues after thrown storage errors", () => {
  const save = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("Offline");
    })
    .mockReturnValueOnce({ state: "saved" });
  const result = saveDefaultsTargets(
    EMPTY_DRAFT,
    [{ kind: "global" }, { kind: "project", path: "C:/one" }],
    save,
  );
  expect(result.failed[0]?.message).toBe("Offline");
  expect(result.saved).toHaveLength(1);
});

it("saves Global delegation to the Host first and keeps other targets retryable independently", async () => {
  const draft = { ...EMPTY_DRAFT, providers: { claude: { extras: { crossSubagents: "[]" } } } };
  const order: string[] = [];
  const host = {
    saveChanges: vi.fn(async () => {
      order.push("host");
      return { ...structuredClone(EMPTY_MODEL_ROUTING), version: 1, updatedAt: 1 };
    }),
  };
  const save = vi.fn((_draft, target) => {
    order.push(target.kind);
    return { state: "saved" as const };
  });
  const targets = [{ kind: "global" } as const, { kind: "project", path: "/one" } as const];
  const outcome = await saveDefaultsTargetsWithDelegation(draft, targets, host, save);
  expect(order).toEqual(["host", "global", "project"]);
  expect(outcome.failed).toEqual([]);
  expect(host.saveChanges).toHaveBeenCalledExactlyOnceWith(draft);
  host.saveChanges.mockRejectedValueOnce(new Error("Conflict"));
  save.mockClear();
  const failed = await saveDefaultsTargetsWithDelegation(draft, targets, host, save);
  expect(failed.failed).toEqual([{ target: targets[0], message: "Conflict" }]);
  expect(save).toHaveBeenCalledExactlyOnceWith(draft, targets[1]);
});

it("project/group targets and older Hosts keep renderer-only saves", async () => {
  const draft = { ...EMPTY_DRAFT, providers: { claude: { extras: { crossAdvisor: "auto" } } } };
  const host = { saveChanges: vi.fn() };
  const save = vi.fn(() => ({ state: "saved" as const }));
  const targets = [
    { kind: "group", id: "team", workspace: false } as const,
    { kind: "project", path: "/one" } as const,
  ];
  expect((await saveDefaultsTargetsWithDelegation(draft, targets, host, save)).saved).toEqual(
    targets,
  );
  expect(host.saveChanges).not.toHaveBeenCalled();
  expect(
    (await saveDefaultsTargetsWithDelegation(draft, [{ kind: "global" }], undefined, save)).failed,
  ).toEqual([]);
});
