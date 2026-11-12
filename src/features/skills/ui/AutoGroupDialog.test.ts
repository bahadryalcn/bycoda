// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AutoGroupDialog } from "./AutoGroupDialog";
import { autoGroupSkills, createSkillGroup, listSkillGroups } from "../index";

vi.mock("../index", async (original) => ({
  ...(await original<typeof import("../index")>()),
  autoGroupSkills: vi.fn(),
  useSkillGroupingModel: () => ({ harness: "codex", model: "gpt-5" }),
}));
vi.mock("../../sessions", () => ({ loadModelPicker: async () => ({ ModelPicker: () => null }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(autoGroupSkills).mockReset();
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
it.each(["Cancel", "Replace my groups", "Add as new groups"])(
  "previews before explicit %s",
  async (action) => {
    await render();
    const existingId = listSkillGroups()[0].id;
    await click("Group with AI");
    expect(document.body.textContent).toContain("Proposed");
    expect(listSkillGroups().map((group) => group.name)).toEqual(["Existing"]);
    await click(action);
    if (action !== "Replace my groups") expect(listSkillGroups()[0].id).toBe(existingId);
    expect(listSkillGroups().map((group) => group.name)).toEqual(
      action === "Cancel"
        ? ["Existing"]
        : action === "Replace my groups"
          ? ["Proposed"]
          : ["Existing", "Proposed"],
    );
  },
);
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
