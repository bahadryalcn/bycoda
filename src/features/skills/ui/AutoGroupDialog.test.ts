// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AutoGroupDialog } from "./AutoGroupDialog";
import { autoGroupSkills, createSkillGroup, listSkillGroups } from "../index";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";

vi.mock("../../settings/public/modelsSettingsLink", () => ({ openModelsSettings: vi.fn() }));

vi.mock("../index", async (original) => ({
  ...(await original<typeof import("../index")>()),
  autoGroupSkills: vi.fn(),
  resolveSkillGroupingModel: async () => ({ harness: "codex", model: "gpt-5" }),
}));
vi.mock("../../sessions", () => ({ loadModelPicker: async () => ({ ModelPicker: () => null }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(autoGroupSkills).mockReset();
  vi.mocked(openModelsSettings).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;
  expect(button, label).toBeDefined();
  await act(async () => button.click());
}
async function render() {
  createSkillGroup({ name: "Existing", skillNames: ["one"] });
  vi.mocked(autoGroupSkills).mockResolvedValue([
    { name: "Proposed", skillNames: ["one"], source: "ai" },
  ]);
  await act(async () =>
    root.render(
      createElement(AutoGroupDialog, {
        cwd: "/fixture",
        skills: [{ name: "one", description: "Writing" }],
      }),
    ),
  );
}
it("keeps one direct model-settings action without instructional copy", async () => {
  await render();
  expect(container.textContent).not.toContain("Model set in Settings");
  const settings = container.querySelector<HTMLButtonElement>('button[aria-label="Manage models"]');
  expect(settings).not.toBeNull();
  await act(async () => settings!.click());
  expect(openModelsSettings).toHaveBeenCalledExactlyOnceWith("roles");
  expect(autoGroupSkills).not.toHaveBeenCalled();
});
it.each(["Cancel", "Add as new groups"])("previews before explicit %s", async (action) => {
  await render();
  const existingId = listSkillGroups()[0].id;
  await click("Group with AI");
  expect(document.body.textContent).toContain("Proposed");
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
  await click(action);
  if (action !== "Cancel") expect(listSkillGroups()[0].id).toBe(existingId);
  expect(listSkillGroups().map((group) => group.name)).toEqual(
    action === "Cancel" ? ["Existing"] : ["Existing", "Proposed"],
  );
});
it("makes adding the proposal primary and replace a secondary danger action", async () => {
  await render();
  await click("Group with AI");
  const buttonNamed = (label: string) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent === label)!;
  expect(buttonNamed("Add as new groups").getAttribute("data-button-variant")).toBe("primary");
  const replace = buttonNamed("Replace my groups");
  expect(replace.getAttribute("data-button-variant")).toBe("secondary");
  expect(replace.getAttribute("data-button-tone")).toBe("danger");
});
it("does not replace existing groups until the danger confirmation is approved", async () => {
  await render();
  await click("Group with AI");
  await click("Replace my groups");
  expect(document.body.textContent).toContain("Replace skill groups?");
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
  await click("Replace groups");
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Proposed"]);
});
it("keeps existing groups when the replace confirmation is cancelled", async () => {
  await render();
  await click("Group with AI");
  await click("Replace my groups");
  const cancels = [...document.querySelectorAll("button")].filter(
    (item) => item.textContent === "Cancel",
  );
  await act(async () => cancels[cancels.length - 1].click());
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
  expect(document.body.textContent).toContain("Review skill groups");
});
it("aborts generation and ignores its late proposal", async () => {
  await render();
  let resolve!: (value: []) => void;
  vi.mocked(autoGroupSkills).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await click("Group with AI");
  const signal = vi.mocked(autoGroupSkills).mock.calls[0][0].signal!;
  await click("Cancel");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([]));
  expect(document.body.textContent).not.toContain("Review skill groups");
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
});
it("keeps existing groups after a generation failure and allows retry", async () => {
  await render();
  vi.mocked(autoGroupSkills).mockRejectedValueOnce(new Error("Provider unavailable"));
  await click("Group with AI");
  expect(container.textContent).toContain("Provider unavailable");
  expect(container.textContent).not.toContain("Error: Provider unavailable");
  expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
  await click("Group with AI");
  expect(document.body.textContent).toContain("Review skill groups");
  expect(container.textContent).not.toContain("Provider unavailable");
});
