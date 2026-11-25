// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VoiceWorkEntry } from "../../model/voiceWorkLedger";
import { VoiceWorkList, voiceWorkStatus } from "./VoiceWorkList";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const entry = (overrides: Partial<VoiceWorkEntry> = {}): VoiceWorkEntry => ({
  id: "w1",
  tool: "app_tool_call",
  action: "workspace.sessions.create",
  request: "build a game",
  startedAt: Date.now() - 5 * 60_000,
  status: "done",
  sessionIds: ["s1"],
  jobIds: [],
  projectPath: "C:\\Projects\\games",
  title: "Snake game",
  progress: "working",
  ...overrides,
});

it("renders nothing while the ledger is empty", async () => {
  await act(async () =>
    root.render(createElement(VoiceWorkList, { entries: [], onOpenSession: vi.fn() })),
  );
  expect(container.innerHTML).toBe("");
});

it("lists title, project and status, and opens an entry's session", async () => {
  const onOpenSession = vi.fn();
  const work = entry();
  await act(async () =>
    root.render(
      createElement(VoiceWorkList, {
        entries: [work, entry({ id: "w2", title: undefined, sessionIds: [], jobIds: ["j1"] })],
        onOpenSession,
      }),
    ),
  );
  expect(container.textContent).toContain("Work started by voice");
  expect(container.textContent).toContain("Snake game");
  expect(container.textContent).toContain("games");
  expect(container.textContent).toContain("Working");
  expect(container.textContent).toContain("sessions create");
  const first = container.querySelector<HTMLButtonElement>('[data-voice-work-id="w1"]')!;
  await act(async () => first.click());
  expect(onOpenSession).toHaveBeenCalledWith(work);
  const jobOnly = container.querySelector<HTMLButtonElement>('[data-voice-work-id="w2"]')!;
  expect(jobOnly.disabled).toBe(true);
});

it("maps dispatch and progress to one status", () => {
  expect(voiceWorkStatus(entry({ status: "running", progress: undefined }))[1]).toBe("Starting");
  expect(voiceWorkStatus(entry({ status: "uncertain", progress: undefined }))[0]).toBe("needs-you");
  expect(voiceWorkStatus(entry({ progress: "failed" }))[0]).toBe("failed");
  expect(voiceWorkStatus(entry({ progress: "finished" }))[1]).toBe("Finished");
  expect(voiceWorkStatus(entry({ progress: undefined }))[1]).toBe("Started");
});
