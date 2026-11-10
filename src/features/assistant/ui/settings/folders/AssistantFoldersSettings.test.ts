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
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: any[] = [];
  const states: { dirty: boolean; pending: boolean }[] = [];
  const saveRef = { current: null as null | (() => Promise<void>) };
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
        onDraftStateChange: (state) => states.push(state),
      }),
    ),
  );
  return { calls, states, saveRef };
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
  expect(states.at(-1)).toEqual({ dirty: false, pending: false });
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
    expectedVersion: 3,
    paths: ["D:\\notes", "E:\\work"],
    runWithoutAsking: false,
  });
  expect(states.at(-1)?.dirty).toBe(false);
});

it("removes a folder and warns while commands run without asking", async () => {
  const { calls, saveRef } = await setup(async (input) => ({
    assistantFolders: saved(input.paths, input.runWithoutAsking, 4),
  }));
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
