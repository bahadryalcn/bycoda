// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AgentTranscript } from "./AgentTranscript";
import { managedTurnRecoveryNotice } from "../model/managedTurnRecovery";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { isActivityBlock } from "../model/transcriptActivity";
import type { Block } from "../model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/desktopInstance", () => ({
  desktopInstanceId: () => "desktop-window-test",
}));
const blocks: Block[] = [
  { id: "user", role: "user", text: "Update the file" },
  {
    id: "error",
    role: "system",
    text: "A different managed turn is still active or has an unknown outcome",
  },
];
const props = { sessionId: "session", managedWorkspaceId: "workspace", cwd: "/worktree", blocks };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const reset = () =>
  container.querySelector<HTMLButtonElement>("[data-managed-turn-recovery] button");

it("keeps old managed failures in a visible notice with a recovery action", () => {
  expect(isSessionErrorBlock(blocks[1])).toBe(true);
  expect(isActivityBlock(blocks[1])).toBe(false);
  act(() => root.render(createElement(AgentTranscript, props)));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(blocks[1].text);
  expect(reset()?.textContent).toBe("Reset stuck turn");
});

it("asks the native store once and waits for a positive Host recovery acknowledgement", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => (resolve = done)));
  act(() => root.render(createElement(AgentTranscript, props)));
  act(() => {
    reset()?.click();
    reset()?.click();
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_turn_recover", {
    sessionId: "session",
    clientId: "desktop-window-test",
  });
  expect(reset()?.getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).not.toContain("You can send again");
  await act(async () => resolve({ released: true }));
  expect(reset()).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Stuck turn reset. You can send again.",
  );
  expect(container.textContent).toContain("Update the file");
});

it("keeps the fence and allows another check when the Host reports a blocker", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    released: false,
    reason: "A complete before capture exists. Reconcile the running turn.",
  });
  act(() => root.render(createElement(AgentTranscript, props)));
  await act(async () => reset()?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "complete before capture",
  );
  expect(reset()).not.toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce({ released: true });
  await act(async () => reset()?.click());
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(reset()).toBeNull();
});

it("keeps recovery available after transport failure or an invalid acknowledgement", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Connection unavailable"));
  act(() => root.render(createElement(AgentTranscript, props)));
  await act(async () => reset()?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Connection unavailable",
  );
  vi.mocked(invoke).mockResolvedValueOnce({ released: "yes" });
  await act(async () => reset()?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("did not confirm");
  expect(reset()).not.toBeNull();
});

it("offers recovery only for the latest failed local managed boundary while idle", () => {
  expect(managedTurnRecoveryNotice(props)).toEqual({ sessionId: "session", errorId: "error" });
  for (const change of [
    { busy: true },
    { managedWorkspaceId: undefined },
    { sessionId: undefined },
    { cwd: "remote://host/repo" },
    { blocks: [...blocks, { id: "reply", role: "assistant" as const, text: "Finished" }] },
    { blocks: [...blocks, { id: "next", role: "user" as const, text: "Next turn" }] },
    { blocks: [{ id: "done", role: "system" as const, text: "Managed turn completed" }] },
    { blocks: [{ ...blocks[1], shell: { command: "echo", output: blocks[1].text, exitCode: 0 } }] },
  ])
    expect(managedTurnRecoveryNotice({ ...props, ...change })).toBeUndefined();
  expect(
    managedTurnRecoveryNotice({
      ...props,
      blocks: [...blocks, { id: "draft", role: "user", text: "Keep this draft", draft: true }],
    }),
  ).toEqual({ sessionId: "session", errorId: "error" });
});
