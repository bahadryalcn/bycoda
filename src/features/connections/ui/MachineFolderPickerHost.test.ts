// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { pickFolderOnMachine } from "../model/machineFolderPick";
import { MachineFolderPickerHost } from "./MachineFolderPickerHost";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const machines = [
  { id: "a", name: "Alpha", endpoint: "ssh://a", environmentId: "env-a" },
  { id: "b", name: "Beta", endpoint: "ssh://b", environmentId: "env-b" },
];

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_machines") return machines;
    const { method, params } = input as { method: string; params: { cwd?: string } };
    if (method === "projects.browse") return { path: "/home/me", parent: "/home", entries: [] };
    if (method === "projects.open") return { id: "p", cwd: params.cwd, name: "me" };
    throw new Error(`Unexpected ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(MachineFolderPickerHost)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
});

const settle = async () => {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};
const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  )!;

it("returns the registered key of the folder opened on the requested machine only", async () => {
  let result: string | undefined;
  await act(async () => {
    void pickFolderOnMachine({ kind: "remote", machineId: "b" }).then((key) => (result = key));
  });
  await settle();
  expect(document.body.textContent).toContain("Beta");
  expect(document.body.textContent).not.toContain("Alpha");
  await act(async () => button("Open").click());
  await settle();
  expect(result).toBe("remote://env-b/home/me");
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("resolves undefined on cancel and leaves nothing registered", async () => {
  let result: string | undefined = "pending";
  await act(async () => {
    void pickFolderOnMachine({ kind: "remote", machineId: "a" }).then((key) => (result = key));
  });
  await settle();
  await act(async () => button("Cancel").click());
  await settle();
  expect(result).toBeUndefined();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter((call) => (call[1] as { method?: string })?.method === "projects.open"),
  ).toHaveLength(0);
});

it("a newer request cancels the one still open", async () => {
  const results: Array<string | undefined> = [];
  await act(async () => {
    void pickFolderOnMachine({ kind: "remote", machineId: "a" }).then((key) => results.push(key));
  });
  await settle();
  await act(async () => {
    void pickFolderOnMachine({ kind: "remote", machineId: "b" }).then((key) => results.push(key));
  });
  await settle();
  expect(results).toEqual([undefined]);
  expect(document.body.textContent).toContain("Beta");
});
