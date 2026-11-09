// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultCrewPolicy, type CrewDefinition } from "../model/crew";
import { useCrewAutosave } from "./useCrewAutosave";

const saved: CrewDefinition = {
  id: "crew",
  name: "Team",
  agents: [],
  policy: { ...defaultCrewPolicy },
  updatedAt: 1,
};
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sends an edit made during a save with the revision that save returned", async () => {
  let resolveFirst!: (value: CrewDefinition) => void;
  const save = vi
    .fn<(definition: CrewDefinition) => Promise<CrewDefinition>>()
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    .mockImplementation(async (definition) => ({ ...definition, updatedAt: 3 }));
  let draft = { ...saved, name: "Team A" };
  function Harness() {
    useCrewAutosave({
      draft,
      saved,
      valid: true,
      enabled: true,
      save,
      onSaved: () => {},
    });
    return null;
  }
  const render = () => act(async () => root.render(createElement(Harness)));
  await render();
  await act(async () => vi.advanceTimersByTime(800));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].updatedAt).toBe(1);

  // Edited while the first save is still in flight; the debounce fires before it returns.
  draft = { ...draft, name: "Team B" };
  await render();
  await act(async () => vi.advanceTimersByTime(800));
  await act(async () => resolveFirst({ ...saved, name: "Team A", updatedAt: 2 }));
  await act(async () => vi.advanceTimersByTime(800));

  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toMatchObject({ name: "Team B", updatedAt: 2 });
});
