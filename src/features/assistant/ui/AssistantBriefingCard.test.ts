// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
const ports = vi.hoisted(() => ({
  request: vi.fn(),
  find: vi.fn(),
  verify: vi.fn(),
  speak: vi.fn(),
  jump: vi.fn(),
}));
vi.mock("../model/assistantClient", () => ({ assistantRequest: ports.request }));
vi.mock("../model/assistantHostRead", () => ({
  captureAssistantHostRead: async (environmentId?: string) => ({
    environmentId: environmentId ?? "host",
    snapshot: async () => (await ports.request({ op: "snapshot", limit: 100 })).snapshot,
  }),
}));
vi.mock("../model/assistantBriefing", () => ({
  findAssistantApprovals: ports.find,
  verifyAssistantApproval: ports.verify,
}));
vi.mock("../model/assistantBriefingSpeech", () => ({ listenAssistantBriefing: ports.speak }));
vi.mock("../../voice/model/voiceActivity", () => ({
  isVoiceConversationActive: () => false,
  subscribeVoiceConversationActivity: () => () => {},
}));
vi.mock("../../sessions/model/transcriptJump", () => ({ requestTranscriptJump: ports.jump }));
import { AssistantBriefingCard } from "./AssistantBriefingCard";
let container: HTMLDivElement, root: ReturnType<typeof createRoot>, snapshot: AssistantSnapshot;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  snapshot = {
    profile: { voiceSetupComplete: true, language: "tr" },
    briefing: { id: "brief", text: "The actual retained briefing", createdAt: 1 },
    jobs: [],
  } as AssistantSnapshot;
  ports.request.mockReset().mockImplementation(async () => ({ snapshot }));
  ports.find.mockReset().mockResolvedValue({ targets: [], unavailable: 0 });
  ports.verify.mockReset().mockResolvedValue(undefined);
  ports.speak.mockReset().mockResolvedValue(undefined);
  ports.jump.mockReset();
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const props = () => ({
  snapshot,
  onDismiss: vi.fn(),
  onOpenNotes: vi.fn(),
  onSetupVoice: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenGoal: vi.fn(),
  onChooseLanguage: vi.fn(),
});
async function render(input = props()) {
  await act(async () => root.render(createElement(AssistantBriefingCard, input)));
  return input;
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("filters fresh approval sources and refuses navigation when the selected project becomes hidden", async () => {
  const hiddenJob = { id: "hidden-job", projectId: "hidden" };
  const visibleJob = { id: "job", projectId: "visible" };
  snapshot.jobs = [hiddenJob, visibleJob] as any;
  const target = {
    kind: "goal",
    environmentId: "host",
    goalId: "goal",
    jobId: "job",
    projectId: "visible",
    title: "Visible approval",
  };
  ports.find.mockResolvedValue({ targets: [target], unavailable: 0 });
  let allowed = true;
  ports.verify.mockImplementation(async () => {
    allowed = false;
  });
  const p = { ...props(), canSeeProject: (id: string) => id === "visible" && allowed };
  await render(p);
  await click("Go to approvals");
  expect(ports.find).toHaveBeenCalledWith(
    [visibleJob],
    expect.objectContaining({ environmentId: "host" }),
  );
  expect(p.onOpenGoal).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Visible approval");
});
it("starts output only after Listen and exposes an actual cancellable Stop while it plays", async () => {
  let signal: AbortSignal | undefined;
  ports.speak.mockImplementation(
    async (_id, value: AbortSignal, update: (playing: boolean) => void) => {
      signal = value;
      update(true);
      await new Promise<void>((resolve) =>
        value.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  );
  const p = await render();
  expect(ports.speak).not.toHaveBeenCalled();
  await click("Listen");
  expect(container.textContent).toContain("This does not open the microphone");
  await click("Stop listening");
  expect(signal?.aborted).toBe(true);
  await click("Open notes");
  expect(p.onOpenNotes).toHaveBeenCalledTimes(1);
});
it("opens the verified current approval source and exact block without making an approval decision", async () => {
  const target = {
    kind: "session",
    environmentId: "host",
    projectId: "project",
    jobId: "job",
    sessionId: "exact",
    blockId: "approval-block",
    requestId: 8,
    runId: "run",
  };
  ports.find.mockResolvedValue({ targets: [target], unavailable: 0 });
  const p = await render();
  await click("Go to approvals");
  expect(ports.verify).toHaveBeenCalledWith(
    target,
    snapshot.jobs,
    expect.objectContaining({ environmentId: "host" }),
  );
  expect(p.onOpenSession).toHaveBeenCalledWith("exact", "host");
  expect(ports.jump).toHaveBeenCalledWith("exact", "approval-block");
  expect(ports.request.mock.calls.every(([input]) => input.op === "snapshot")).toBe(true);
});
it("does not navigate after the owner leaves the card while approval discovery is pending", async () => {
  let release!: (value: unknown) => void;
  ports.find.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const p = await render();
  await click("Go to approvals");
  await act(async () => root.render(null));
  await act(async () => release({ targets: [{ kind: "goal", goalId: "goal" }], unavailable: 0 }));
  expect(p.onOpenGoal).not.toHaveBeenCalled();
  expect(p.onOpenSession).not.toHaveBeenCalled();
});
it("keeps audio failure and explicit retry on the initiating card", async () => {
  ports.speak.mockRejectedValueOnce(new Error("Output unavailable"));
  await render();
  await click("Listen");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Output unavailable");
  await click("Retry listening");
  expect(ports.speak).toHaveBeenCalledTimes(2);
});
it("offers language settings rather than guessing English when no accepted spoken language exists", async () => {
  snapshot.profile.language = "auto";
  snapshot.lastSpokenLanguage = null;
  const p = await render();
  expect(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Listen",
    )?.disabled,
  ).toBe(true);
  await click("Choose language");
  expect(p.onChooseLanguage).toHaveBeenCalledTimes(1);
  expect(ports.speak).not.toHaveBeenCalled();
});
it("does not claim there are no approvals when some sources are unavailable", async () => {
  ports.find.mockResolvedValue({ targets: [], unavailable: 1 });
  await render();
  await click("Go to approvals");
  expect(container.textContent).toContain("Some approval sources could not be checked");
  expect(container.textContent).not.toContain("No pending approvals found.");
});
