// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantFoldersResponse } from "../../../../../shared/model/assistantFolders";

const pick = vi.hoisted(() => vi.fn<() => Promise<string[]>>());
vi.mock("../../../../../platform/tauri/fs", () => ({ pickFolders: pick }));
import { AssistantFoldersSettings } from "./AssistantFoldersSettings";

const saved = (paths: string[], runWithoutAsking: boolean, version: number) =>
  ({
    folders: paths.map((path, index) => ({ id: `f${String(index).padStart(16, "0")}`, path })),
    runWithoutAsking,
    version,
    updatedAt: 1,
  }) satisfies AssistantFoldersResponse;

let root: Root | undefined, container: HTMLDivElement;
async function setup(
  request: (input: any) => Promise<any>,
  initial = saved(["D:\\notes"], false, 3),
  showPermissionControls = true,
  unifiedOwner = true,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: any[] = [];
  const states: { dirty: boolean; pending: boolean }[] = [];
  const saveRef = { current: null as null | (() => Promise<void>) };
  const accessRef = { current: null as null | ((full: boolean) => void) };
  const wrapped = vi.fn(async (input: any) => {
    calls.push(input);
    return input.op === "folders.get" ? { assistantFolders: initial } : request(input);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AssistantFoldersSettings, {
        request: wrapped as any,
        saveRef,
        accessRef: unifiedOwner ? accessRef : undefined,
        showPermissionControls,
        onDraftStateChange: (state) => states.push(state),
      }),
    ),
  );
  return { calls, states, saveRef, accessRef };
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent === label,
  )!;
const click = (label: string) =>
  act(async () => {
    expect(button(label), label).toBeTruthy();
    button(label).click();
  });

it("keeps folder scope and owner save mounted without repeating unified permission controls", async () => {
  const state = await setup(
    async (input) => ({
      assistantFolders: {
        ...saved(input.paths, input.runWithoutAsking, 4),
        allowChangesWithoutAsking: input.allowChangesWithoutAsking,
      },
    }),
    undefined,
    false,
  );
  expect(container.textContent).toContain("D:\\notes");
  expect(button("Add folder…")).toBeTruthy();
  expect(container.textContent).not.toContain("Run commands without asking");
  await act(async () => state.accessRef.current!(true));
  await act(async () => state.saveRef.current!());
  expect(state.calls.filter((input) => input.op === "folders.set")).toEqual([
    expect.objectContaining({ runWithoutAsking: true, allowChangesWithoutAsking: true }),
  ]);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  pick.mockReset();
  vi.unstubAllGlobals();
});

it("shows the saved folders and stays clean until the owner changes something", async () => {
  const { states } = await setup(async () => ({}));
  expect(container.textContent).toContain("D:\\notes");
  expect(states.at(-1)).toEqual({
    dirty: false,
    pending: false,
    runWithoutAsking: false,
    allowChangesWithoutAsking: false,
  });
});

it("applies the explicit access choice to command and file grants only on Save", async () => {
  const { calls, saveRef, accessRef } = await setup(async (input) => ({
    assistantFolders: {
      ...saved(input.paths, input.runWithoutAsking, 4),
      allowChangesWithoutAsking: input.allowChangesWithoutAsking,
    },
  }));
  expect(calls.map((input) => input.op)).toEqual(["folders.get"]);
  await act(async () => accessRef.current!(true));
  expect(calls).toHaveLength(1);
  await act(async () => saveRef.current!());
  expect(calls.at(-1)).toMatchObject({
    op: "folders.set",
    expectedVersion: 3,
    runWithoutAsking: true,
    allowChangesWithoutAsking: true,
  });
  await act(async () => accessRef.current!(false));
  await act(async () => saveRef.current!());
  expect(calls.at(-1)).toMatchObject({
    expectedVersion: 4,
    runWithoutAsking: false,
    allowChangesWithoutAsking: false,
  });
});

it("adds a picked folder once and saves the list with the expected version", async () => {
  pick.mockResolvedValue(["E:\\work", "D:\\notes"]);
  const { calls, states, saveRef } = await setup(async (input) => ({
    assistantFolders: saved(input.paths, input.runWithoutAsking, 4),
  }));
  await click("Add folder…");
  expect(container.textContent).toContain("E:\\work");
  expect(states.at(-1)?.dirty).toBe(true);
  await act(async () => saveRef.current!());
  const set = calls.find((call) => call.op === "folders.set");
  expect(set).toEqual({
    op: "folders.set",
    allowChangesWithoutAsking: false,
    expectedVersion: 3,
    paths: ["D:\\notes", "E:\\work"],
    runWithoutAsking: false,
  });
  expect(states.at(-1)?.dirty).toBe(false);
});

it("removes a folder and warns while standalone commands run without asking", async () => {
  const { calls, saveRef } = await setup(
    async (input) => ({
      assistantFolders: saved(input.paths, input.runWithoutAsking, 4),
    }),
    undefined,
    true,
    false,
  );
  expect(container.textContent).not.toContain("A command can do anything you can do");
  await click("Run commands without asking");
  expect(container.textContent).toContain("A command can do anything you can do");
  await click("Remove D:\\notes");
  expect(container.textContent).toContain("No folders added yet.");
  await act(async () => saveRef.current!());
  expect(calls.find((call) => call.op === "folders.set")).toMatchObject({
    paths: [],
    runWithoutAsking: true,
  });
});

it("keeps the draft and offers a reload on a version conflict", async () => {
  pick.mockResolvedValue(["E:\\work"]);
  const { saveRef } = await setup(async () => {
    throw new Error("Assistant folders changed; reload before saving.");
  });
  await click("Add folder…");
  await act(async () => {
    await saveRef.current!().catch(() => undefined);
  });
  expect(container.textContent).toContain("Settings changed elsewhere. Reload to continue.");
  expect(container.textContent).toContain("E:\\work");
  expect(button("Reload")).toBeTruthy();
});

it("surfaces a rejected folder without losing the draft", async () => {
  pick.mockResolvedValue(["C:\\Windows"]);
  const { saveRef } = await setup(async () => {
    throw new Error("A system folder cannot be an Assistant folder.");
  });
  await click("Add folder…");
  await act(async () => {
    await saveRef.current!().catch(() => undefined);
  });
  expect(container.textContent).toContain("A system folder cannot be an Assistant folder.");
  expect(container.textContent).toContain("C:\\Windows");
});

it("can revoke file changes independently in custom access without changing command approval", async () => {
  const state = await setup(async (input) => ({
    assistantFolders: {
      ...saved(input.paths, input.runWithoutAsking, 4),
      allowChangesWithoutAsking: input.allowChangesWithoutAsking,
    },
  }));
  await act(async () => state.accessRef.current!(true));
  const toggle = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Allow file changes without asking"]',
  )!;
  expect(toggle).toBeTruthy();
  await act(async () => toggle.click());
  await act(async () => state.saveRef.current!());
  expect(state.calls.at(-1)).toMatchObject({
    runWithoutAsking: true,
    allowChangesWithoutAsking: false,
  });
});
