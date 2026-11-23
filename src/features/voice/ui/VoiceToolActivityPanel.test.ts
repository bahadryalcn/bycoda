// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { VoiceToolActivityEntry } from "../model/voiceToolActivity";
import { VoiceToolActivityPanel } from "./VoiceToolActivityPanel";

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const entries: VoiceToolActivityEntry[] = [
  {
    id: "a",
    name: "workspace.sessions.list",
    target: "Alpha",
    projectPath: "/alpha",
    requestId: "req-1",
    startedAt: Date.now(),
    state: "running",
  },
  {
    id: "b",
    name: "workspace.sessions.list",
    target: "Beta",
    projectPath: "/beta",
    requestId: "req-2",
    startedAt: Date.now(),
    state: "waiting-owner",
  },
];

/** Renders the panel and opens its popover, the same way a user reaches the rows. */
async function renderOpen(onStopWaiting = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(VoiceToolActivityPanel, { entries, onStopWaiting })),
  );
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  return onStopWaiting;
}

it("gives each stop button a name that identifies its own action", async () => {
  await renderOpen();
  const names = [...document.querySelectorAll<HTMLButtonElement>("li button")].map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(names).toEqual([
    "Stop waiting for workspace.sessions.list · Alpha · req-1",
    "Stop waiting for workspace.sessions.list · Beta · req-2",
  ]);
  expect(new Set(names).size).toBe(names.length);
});

it("shows the target in the row and keeps the technical id out of the visible text", async () => {
  await renderOpen();
  const rows = [...document.querySelectorAll("li")];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Alpha");
  for (const [index, id] of ["req-1", "req-2"].entries()) {
    expect(rows[index].textContent).not.toContain(id);
    expect(rows[index].querySelector("details")).toBeNull();
  }
});

it("stops only the entry whose named button was pressed", async () => {
  const onStopWaiting = await renderOpen();
  const second = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Stop waiting for workspace.sessions.list · Beta · req-2"]',
  );
  await act(async () => second!.click());
  expect(onStopWaiting).toHaveBeenCalledWith("b");
});
