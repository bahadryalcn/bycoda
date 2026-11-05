// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import type { ManualSupervisionController } from "../model/assistantManual";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../model/assistantSessions", () => ({ useAssistantSession: mocks.session }));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));
import { AssistantSessions } from "./AssistantSessions";
import { ManualSessionSupervision } from "./ManualSessionSupervision";

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const job = {
  id: "job-one",
  title: "Check recovery",
  projectId: "project-one",
  status: "running",
  sessionIds: ["session-one"],
} as AssistantJob;
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === name || element.getAttribute("aria-label") === name,
  )!;
async function render(props: Partial<Parameters<typeof AssistantSessions>[0]> = {}) {
  await act(() =>
    root.render(
      createElement(AssistantSessions, {
        jobs: [],
        query: "",
        filter: "",
        projectName: (id) => id,
        ...props,
      }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.session.mockReturnValue({
    record: {
      projectId: "project-one",
      environmentId: "original-host",
      status: "idle",
      updatedAt: 1,
      session: { title: "Recovery session" },
    },
    loading: false,
    error: "",
    refresh: vi.fn(),
  });
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("offers the jobs destination when no job sessions exist", async () => {
  const onJobs = vi.fn();
  await render({ onJobs });
  expect(container.textContent).toContain("No sessions from assistant jobs yet");
  expect(button("Clear filters")).toBeUndefined();
  await act(() => button("View jobs").click());
  expect(onJobs).toHaveBeenCalledOnce();
});

it.each([
  { query: "no match", filter: "" },
  { query: "", filter: "completed" },
])("distinguishes filtered results from an unused job list: %j", async (criteria) => {
  const onReset = vi.fn();
  await render({ jobs: [job], ...criteria, onReset, onJobs: vi.fn() });
  expect(container.textContent).toContain("No matching sessions");
  expect(container.textContent).not.toContain("No sessions from assistant jobs yet");
  expect(button("View jobs")).toBeUndefined();
  await act(() => button("Clear filters").click());
  expect(onReset).toHaveBeenCalledOnce();
});

it("opens the session on the Host confirmed by its record", async () => {
  const onOpenSession = vi.fn();
  await render({ jobs: [job], environmentId: "requested-host", onOpenSession });
  expect(container.textContent).toContain("Recovery session");
  await act(() => button("Open session").click());
  expect(onOpenSession).toHaveBeenCalledWith("session-one", "original-host");
});

it("keeps unavailable manual policy unknown and offers refresh recovery", async () => {
  const refresh = vi.fn(async () => {});
  const controller: ManualSupervisionController = {
    data: null,
    pending: "",
    stopping: false,
    error: "",
    chief: true,
    refresh,
    enroll: vi.fn(),
    revoke: vi.fn(),
    save: vi.fn(),
    off: vi.fn(),
  };
  await act(() =>
    root.render(
      createElement(ManualSessionSupervision, {
        controller,
        projects: [],
      }),
    ),
  );
  expect(container.textContent).toContain("Unknown");
  expect(container.textContent).toContain(
    "Manual supervision state is unavailable. Refresh to retry.",
  );
  expect(
    [...container.querySelectorAll("span")].some((element) => element.textContent === "Off"),
  ).toBe(false);
  await act(() => button("Refresh").click());
  expect(refresh).toHaveBeenCalledOnce();
});
