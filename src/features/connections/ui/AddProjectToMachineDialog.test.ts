// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AddProjectToMachineDialog } from "./AddProjectToMachineDialog";
import type { AddProjectToMachineRequest } from "../model/addProjectToMachine";
import { pickFolderOnMachine } from "../model/machineFolderPick";
import * as model from "../model/addProjectToMachine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../model/machineFolderPick", () => ({ pickFolderOnMachine: vi.fn() }));
vi.mock("../model/addProjectToMachine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/addProjectToMachine")>()),
  cloneProjectToMachine: vi.fn(),
  copyIgnoredFiles: vi.fn(),
  defaultCloneParent: vi.fn(),
  listIgnoredFiles: vi.fn(),
}));

const URL = "git@github.com:acme/app.git";
let root: Root;
let container: HTMLDivElement;
const done = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  done.mockReset();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "remote_machines")
      return [{ id: "m", name: "Home server", endpoint: "ssh://home", environmentId: "env" }];
    throw new Error(`Unexpected ${String(command)}`);
  });
  vi.mocked(model.defaultCloneParent).mockResolvedValue("/home/me");
  vi.mocked(model.listIgnoredFiles).mockResolvedValue([".env", "notes.txt"]);
  vi.mocked(model.cloneProjectToMachine).mockReset();
  vi.mocked(model.copyIgnoredFiles).mockReset().mockResolvedValue([]);
  vi.mocked(pickFolderOnMachine).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

async function render() {
  const request: AddProjectToMachineRequest = {
    target: { kind: "remote", machineId: "m" },
    sourceCwd: "/work/app",
    url: URL,
    claim: () => undefined,
    settle: () => undefined,
  };
  await act(async () =>
    root.render(createElement(AddProjectToMachineDialog, { request, onDone: done })),
  );
  await flush();
}

const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  ) as HTMLButtonElement;

it("clones over the chosen protocol into the folder, copies the checked files and settles", async () => {
  vi.mocked(model.cloneProjectToMachine).mockResolvedValue("remote://env/home/me/app");
  await render();
  expect(document.body.textContent).toContain("Add to Home server");
  await act(async () => button("HTTPS").click());
  await act(async () => button("Clone").click());
  await flush();
  expect(model.cloneProjectToMachine).toHaveBeenCalledWith(
    expect.objectContaining({
      machine: { id: "m", environmentId: "env" },
      url: "https://github.com/acme/app.git",
      parent: "/home/me",
    }),
  );
  // Only the file copied by default (.env) is brought along.
  expect(model.copyIgnoredFiles).toHaveBeenCalledWith("/work/app", "remote://env/home/me/app", [
    ".env",
  ]);
  expect(done).toHaveBeenCalledWith("remote://env/home/me/app");
});

it("settles with the located folder and returns when the pick is cancelled", async () => {
  await render();
  vi.mocked(pickFolderOnMachine).mockResolvedValueOnce(undefined);
  await act(async () => button("Locate folder").click());
  await flush();
  expect(pickFolderOnMachine).toHaveBeenCalledWith({ kind: "remote", machineId: "m" });
  expect(done).not.toHaveBeenCalled();
  expect(button("Clone")).toBeTruthy();
  vi.mocked(pickFolderOnMachine).mockResolvedValueOnce("remote://env/srv/app");
  await act(async () => button("Locate folder").click());
  await flush();
  expect(done).toHaveBeenCalledWith("remote://env/srv/app");
});

it("shows a clone error and does not settle", async () => {
  vi.mocked(model.cloneProjectToMachine).mockRejectedValue(new Error("Permission denied"));
  await render();
  await act(async () => button("Clone").click());
  await flush();
  expect(document.body.textContent).toContain("Permission denied");
  expect(done).not.toHaveBeenCalled();
  expect(button("Clone").disabled).toBe(false);
});
