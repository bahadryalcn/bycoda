// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { saveDefaultsTargets } from "./providerDefaultsSave";
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
