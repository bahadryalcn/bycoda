// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import type { ManualSupervisionController } from "../model/assistantManual";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../model/assistantSessions", () => ({ useAssistantSession: mocks.session }));
vi.mock("../../sessions/public/modelSource", () => ({
  useModelSource: () => ({
    resolve: (harness: string, model: string) => ({
      harness,
      id: model,
      name: model === "gpt-fixture" ? "GPT Fixture" : model,
    }),
  }),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "en",
  formatNumber: (value: number) => String(value),
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

it("names the provider and model beside each job session title", async () => {
  mocks.session.mockReturnValue({
    record: {
      projectId: "project-one",
      environmentId: "original-host",
      status: "running",
      updatedAt: 1,
      session: { title: "Recovery session", harness: "codex", model: "gpt-fixture" },
    },
    loading: false,
    error: "",
    refresh: vi.fn(),
  });
  await render({ jobs: [job] });
  const model = container.querySelector("[data-session-model]");
  expect(model?.textContent).toBe("GPT Fixture");
  expect(model?.querySelector("img")).toBeTruthy();
  const row = container.querySelector('[data-assistant-session="session-one"]');
  expect(row?.textContent).toContain("Recovery session");
});

it("omits the model label while the session record has no provider", async () => {
  await render({ jobs: [job] });
  expect(container.querySelector("[data-session-model]")).toBeNull();
  expect(container.textContent).toContain("Recovery session");
});

it("shows unknown context usage as an empty meter and text, never as ready", async () => {
  await render({ jobs: [job] });
  expect(container.textContent).toContain("Context usage unavailable");
  expect(container.textContent).not.toContain("Context ready");
  expect(container.querySelector('[role="meter"]')).toBeNull();
});

it.each([
  { used: 10, tone: "neutral", reason: "Context ready" },
  { used: 60, tone: "warning", reason: "Compaction required before the next message" },
  { used: 90, tone: "danger", reason: "Handoff required before the next message" },
])("tones the context meter by threshold: $used of 100", async ({ used, tone, reason }) => {
  mocks.session.mockReturnValue({
    record: {
      projectId: "project-one",
      environmentId: "original-host",
      status: "running",
      updatedAt: 1,
      session: { title: "Recovery session", context: { used, window: 100 } },
    },
    loading: false,
    error: "",
    refresh: vi.fn(),
  });
  await render({ jobs: [job] });
  const meter = container.querySelector('[role="meter"]');
  expect(meter?.getAttribute("aria-valuenow")).toBe(String(used));
  expect(meter?.getAttribute("data-tone")).toBe(tone);
  expect(container.textContent).toContain(reason);
});

it("opens the session on the Host confirmed by its record", async () => {
  const onOpenSession = vi.fn();
  await render({ jobs: [job], environmentId: "requested-host", onOpenSession });
  expect(container.textContent).toContain("Recovery session");
  await act(() => button("Open session").click());
  expect(onOpenSession).toHaveBeenCalledWith("session-one", "original-host");
});

it("groups sessions under their job and keeps a skeleton while the first record loads", async () => {
  mocks.session.mockReturnValue({
    record: null,
    loading: true,
    error: "",
    refresh: vi.fn(),
  });
  await render({ jobs: [job, { ...job, id: "job-two", title: "Second job", sessionIds: ["s2"] }] });
  const groups = [...container.querySelectorAll("[data-assistant-session-group]")];
  expect(groups.map((group) => group.getAttribute("data-assistant-session-group"))).toEqual([
    "job-one",
    "job-two",
  ]);
  expect(groups[0].textContent).toContain("Check recovery");
  const row = container.querySelector('[data-assistant-session="session-one"]');
  await vi.waitFor(() =>
    expect(row?.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0),
  );
  expect(row?.textContent).not.toContain("Context usage unavailable");
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

it("keeps disabled supervision compact during a background refresh", async () => {
  const controller: ManualSupervisionController = {
    data: { policy: { enabled: false, version: 1, projectIds: [] }, grants: [], candidates: [] },
    pending: "list",
    stopping: false,
    error: "",
    chief: true,
    refresh: vi.fn(),
    enroll: vi.fn(),
    revoke: vi.fn(),
    save: vi.fn(),
    off: vi.fn(),
  };
  await act(() =>
    root.render(createElement(ManualSessionSupervision, { controller, projects: [] })),
  );
  expect(container.textContent).toContain("Off");
  expect(container.textContent).not.toContain("Turn off supervision");
  expect(container.textContent).not.toContain("No visible conversations");
});
