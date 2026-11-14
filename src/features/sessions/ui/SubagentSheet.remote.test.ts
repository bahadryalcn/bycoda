// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { SubagentSheet } from "./SubagentSheet";

vi.mock("../../../app/shell/GlassBackdrop", () => ({ GlassBackdrop: () => null }));
vi.mock("./AgentTranscript", () => ({ ActivityRow: () => null, agentStepBlock: () => null }));
let root: Root;
let host: HTMLDivElement;
let load: ReturnType<typeof vi.fn<(blockId: string, revision: number) => Promise<void>>>;
const command = (revision: number): Block => ({
  id: "remote-command",
  role: "tool",
  text: "Read output",
  tool: { callId: "remote-call", kind: "execute", status: "completed", output: "Saved preview" },
  remoteContent: { revision, bytes: 9000 },
});
const render = (revision = 9) =>
  act(async () =>
    root.render(
      createElement(
        "div",
        {
          "data-session-drop": "",
        },
        createElement(SubagentSheet, {
          block: command(revision),
          busy: false,
          visible: true,
          onClose: vi.fn(),
          onLoadRemoteBlock: load,
        }),
      ),
    ),
  );
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  )!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  load = vi.fn<(blockId: string, revision: number) => Promise<void>>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps the saved summary and exposes a local retry after full-output failure", async () => {
  load.mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValueOnce(undefined);
  await render();
  expect(load).not.toHaveBeenCalled();
  await act(async () => button("Load full output").click());
  expect(host.textContent).toContain("Could not load the full output.");
  expect(host.textContent).toContain("Saved preview");
  await act(async () => button("Retry").click());
  expect(load.mock.calls).toEqual([
    ["remote-command", 9],
    ["remote-command", 9],
  ]);
  expect(host.textContent).not.toContain("Could not load the full output.");
});

it("ignores an older revision's completion while a newer revision needs retry", async () => {
  let finish!: () => void;
  load
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("New revision unavailable"))
    .mockResolvedValueOnce(undefined);
  await render();
  await act(async () => button("Load full output").click());
  await render(10);
  await act(async () => button("Load full output").click());
  expect(host.textContent).toContain("Could not load the full output.");
  await act(async () => finish());
  expect(host.textContent).toContain("Could not load the full output.");
  await act(async () => button("Retry").click());
  expect(load.mock.calls).toEqual([
    ["remote-command", 9],
    ["remote-command", 10],
    ["remote-command", 10],
  ]);
  expect(host.textContent).not.toContain("Could not load the full output.");
});
