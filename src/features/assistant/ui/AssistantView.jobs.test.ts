// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AssistantRequestSchema,
  type AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";

const mock = vi.hoisted(() => ({
  environmentId: "room-fixture",
  automations: [] as any[],
  snapshot: null as AssistantSnapshot | null,
  request: vi.fn(),
  refresh: vi.fn(async () => {}),
  close: vi.fn(),
}));
vi.mock("../model/assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: mock.snapshot,
    environmentId: mock.environmentId,
    loading: false,
    error: "",
    refresh: mock.refresh,
  }),
  assistantIdentity: (profile: any) => ({
    name: profile?.name ?? "",
    title: profile?.name ?? "Set up",
    room: `Room · ${profile?.name ?? ""}`,
    setupComplete: profile?.setupComplete,
    voiceSetupComplete: profile?.voiceSetupComplete,
  }),
  assistantRequest: mock.request,
  operationId: () => crypto.randomUUID(),
}));
vi.mock("../model/assistantHostRead", () => ({
  captureAssistantHostRead: async (environmentId?: string) => ({
    environmentId: environmentId ?? "room-fixture",
    automations: async () => mock.automations,
    projects: async () => (await mock.request({ op: "projects.list" })).projects,
    snapshot: async () => (await mock.request({ op: "snapshot", limit: 100 })).snapshot,
    session: async (id: string) => ({
      session: { id, title: id, blocks: [] },
      projectId:
        mock.snapshot?.jobs.find((job) => job.sessionIds.includes(id))?.projectId ?? "project-one",
      status: "running",
      updatedAt: 1,
    }),
  }),
}));
vi.mock("../../voice/ui/VoiceSetupSteps", () => ({
  VoiceSetupSteps: () => null,
}));
vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelPicker: (props: any) =>
    createElement(
      "button",
      { type: "button", onClick: () => props.onChange("claude", "fixture-catalog-model") },
      "Choose a fixture model",
    ),
}));
vi.mock("../../../shared/i18n", () => ({
  formatNumber: (value: number) => value.toLocaleString(),
  formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", options).format(value),
  t: (key: string, params?: Record<string, unknown>) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`)),
  useT: () => (key: string) => key,
  useLocale: () => "en",
  translateAt: (_locale: string, key: string) => key,
}));
import { AssistantView } from "./AssistantView";
import {
  click,
  flush,
  job,
  setTextareaValue,
  snapshot,
  stubNavigatorLocks,
} from "./AssistantView.testSupport";
let root: Root | undefined, container: HTMLDivElement;
beforeEach(() => {
  stubNavigatorLocks();
  mock.environmentId = "room-fixture";
  mock.automations = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mock.snapshot = snapshot();
  mock.request.mockImplementation(async (input) => {
    AssistantRequestSchema.parse(input);
    if (input.op === "projects.list")
      return { projects: [{ id: "project-one", path: "/one", name: "One" }] };
    if (input.op === "profile.update")
      return { profile: { ...mock.snapshot!.profile, ...input.patch } };
    if (input.op === "threads.messages") return { messages: [] };
    if (input.op === "snapshot") return { snapshot: mock.snapshot };
    if (input.op === "jobs.control")
      return {
        job: {
          ...job(),
          id: input.id,
          version: input.expectedVersion + 1,
          status: input.action === "pause" ? "paused" : "cancelled",
        },
      };
    return { ok: true };
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "locks");
});
async function render(props: Parameters<typeof AssistantView>[0] = {}) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      createElement(AssistantView, {
        projectPath: "/one",
        projects: [{ id: "project-one", name: "One", path: "/one" }],
        ...props,
      }),
    ),
  );
}
const jobComposer = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Give Arif a job"]')!;

it("starts a typed job directly with Enter when confirmJobs is off, and Shift+Enter adds a line", async () => {
  mock.snapshot!.profile.confirmJobs = false;
  mock.snapshot!.jobs = [];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.create") {
      AssistantRequestSchema.parse(input);
      return {
        job: {
          ...job(input.idempotencyKey),
          id: "job-direct",
          title: input.title,
          request: input.request,
          projectId: input.projectId,
          projectIds: input.projectIds,
          idempotencyKey: input.idempotencyKey,
        },
      };
    }
    return base(input);
  });
  await render();
  expect(document.body.textContent).toContain("Start");
  setTextareaValue(jobComposer(), "Fix login");
  await act(async () =>
    jobComposer().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await flush();
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
  await act(async () =>
    jobComposer().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  await flush();
  const creates = mock.request.mock.calls.filter(([input]) => input.op === "jobs.create");
  expect(creates).toHaveLength(1);
  expect(creates[0][0].request).toBe("Fix login");
  expect(document.body.textContent).not.toContain(
    "Check each request and its projects before it starts.",
  );
});

it("opens the job review instead of starting when confirmJobs is on", async () => {
  mock.snapshot!.profile.confirmJobs = true;
  mock.snapshot!.jobs = [];
  await render();
  expect(document.body.textContent).toContain("Review jobs");
  setTextareaValue(jobComposer(), "Fix login");
  await act(async () =>
    jobComposer().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  await flush();
  expect(document.body.textContent).toContain(
    "Check each request and its projects before it starts.",
  );
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
});

it("loads the job activity log newest first in the details sheet", async () => {
  mock.snapshot!.jobs = [job()];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.activity") {
      AssistantRequestSchema.parse(input);
      return {
        jobActivity: [
          {
            id: "activity-new",
            version: 1,
            createdAt: 3,
            updatedAt: 3,
            kind: "job.failed",
            summary: "Host rejected request: The linked goal is unavailable.",
            jobId: "job-one",
          },
          {
            id: "activity-old",
            version: 1,
            createdAt: 1,
            updatedAt: 1,
            kind: "job.started",
            summary: "Job started",
            jobId: "job-one",
          },
        ],
      };
    }
    return base(input);
  });
  await render();
  await click("Job actions");
  await click("Details");
  await flush();
  const reads = mock.request.mock.calls.filter(([input]) => input.op === "jobs.activity");
  expect(reads).toHaveLength(1);
  expect(reads[0][0]).toEqual({ op: "jobs.activity", id: "job-one", limit: 50 });
  const items = [...document.querySelectorAll("ol li")].map((item) => item.textContent ?? "");
  expect(items[0]).toContain("Host rejected request");
  expect(items[0]).toContain("This step failed.");
  expect(items[1]).toContain("Job started");
});

it("reports an unconfirmed activity read as an error with retry, not as an empty log", async () => {
  mock.snapshot!.jobs = [job()];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) =>
    input.op === "jobs.activity" ? {} : base(input),
  );
  await render();
  await click("Job actions");
  await click("Details");
  await flush();
  expect(document.body.textContent).toContain("Job activity could not be confirmed. Retry.");
  expect(document.body.textContent).not.toContain("No activity yet");
  expect(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Retry",
    ),
  ).toBe(true);
});

it("shows today's notes as at most three plain-text lines without markdown or event markers", async () => {
  const now = Date.now();
  mock.snapshot!.jobs = [];
  mock.snapshot!.notes = [
    {
      id: "note-today",
      title: "Progress",
      body: "## Session recovery\n- Checked the cancel path <!-- assistant-event:evt-1 -->\n* Second item\nThird item",
      tags: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  await render();
  const section = document.querySelector('[aria-label="Today\'s notes"]');
  // The note title is shown once as a heading above its lines.
  expect(
    Array.from(section?.querySelectorAll("h3") ?? []).map((heading) => heading.textContent),
  ).toEqual(["Progress"]);
  const lines = Array.from(section?.querySelectorAll<HTMLElement>("li") ?? []).map(
    (line) => line.textContent,
  );
  expect(lines).toEqual(["Session recovery", "Checked the cancel path", "Second item"]);
  expect(document.querySelector('[aria-label="Today\'s notes"]')?.textContent).not.toMatch(
    /##|<!--|^\s*[-*] /m,
  );
});
