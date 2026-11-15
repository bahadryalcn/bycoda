// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DiscoveredMachines } from "./DiscoveredMachines";
import type { MachineCandidate } from "../model/machineCandidates";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
const account = vi.hoisted(() => ({ state: { phase: "signed-out" } as { phase: string } }));
vi.mock("../../account", () => ({
  useAccountState: () => account.state,
  useAccount: () => ({ signIn: async () => undefined }),
  isSignedIn: (state: { phase: string }) => state.phase === "signed-in",
  listOtherComputers: vi.fn(async () => []),
}));

let container: HTMLDivElement;
let root: Root;
const native: MachineCandidate = {
  key: "ssh:box",
  name: "box",
  sources: ["ssh-config"],
  routes: [{ address: "box", kind: "name" }],
  sshUser: "me",
  alreadyAdded: false,
};
const onAdd = vi.fn();

async function render(candidates: MachineCandidate[] | "missing") {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "discover_machine_candidates" && candidates !== "missing") return candidates;
    throw new Error("unknown command");
  });
  await act(async () => {
    root.render(createElement(DiscoveredMachines, { saved: [], active: true, busy: false, onAdd }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onAdd.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("lists a native candidate and adds it with its address prefilled", async () => {
  await render([native]);
  expect(container.textContent).toContain("box");
  expect(container.textContent).toContain("SSH config");
  const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!;
  await act(async () => add.click());
  expect(onAdd).toHaveBeenCalledWith({ target: "me@box", alternate: null, name: "box" });
});

it("shows the sign-in prompt and an empty state when nothing is found or the command is missing", async () => {
  await render("missing");
  expect(container.textContent).toContain("Sign in to see your other computers.");
  expect(container.textContent).not.toContain("Add");
});

it("hides machines that are already added", async () => {
  await render([{ ...native, alreadyAdded: true }]);
  expect(container.textContent).not.toContain("SSH config");
});
