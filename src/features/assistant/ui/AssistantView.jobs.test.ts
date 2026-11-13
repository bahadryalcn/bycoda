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

it("discusses a job through the durable thread and reviews one multiline brief before explicit Start", async () => {
  mock.snapshot!.profile.confirmJobs = false;
  mock.snapshot!.jobs = [];
  const thread = {
    id: "planning-one",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    projectId: "project-one",
    purpose: "job-planning" as const,
    summary: "",
  };
  const brief = "Update release notes\nScope: public changes only\nCheck: links resolve";
  const history: any[] = [];
  let unconfirmed = false;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "threads.open" && input.purpose === "job-planning") return { thread };
    if (input.op === "threads.messages" && input.threadId === thread.id)
      return { thread, messages: history };
    if (input.op === "threads.send") {
      expect(input.threadId).toBe(thread.id);
      if (unconfirmed) throw new Error("Provider outcome unknown");
      history.push(
        ...["user", "assistant"].map((role, index) => ({
          id: `planning-message-${index}`,
          version: 1,
          createdAt: index + 1,
          updatedAt: index + 1,
          threadId: thread.id,
          role,
          via: "text",
          text: role === "user" ? input.text : brief,
          jobIds: [],
        })),
      );
      return { messages: [...history] };
    }
    if (input.op === "jobs.create")
      return {
        job: {
          ...job("planned-job"),
          request: input.request,
          title: input.title,
          idempotencyKey: input.idempotencyKey,
          projectIds: input.projectIds,
        },
      };
    return base(input);
  });
  await render();
  await click("Jobs");
  await flush();
  const composer = document.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="What should this job achieve?"]',
  )!;
  expect(composer).not.toBeNull();
  setTextareaValue(composer, "Help refine a release notes job");
  await act(async () =>
    composer.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  await flush();
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(1);
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
  await click("Today");
  await click("Discuss a job");
  await flush();
  expect(document.body.textContent).toContain("Scope: public changes only");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(1);
  const retained = {
    source: brief,
    frozen: true,
    environmentId: "room-fixture",
    rows: ["one", "two"].map((id) => ({
      id,
      key: id,
      title: id,
      request: id,
      projectId: "project-one",
      projectIds: ["project-one"],
    })),
  };
  localStorage.setItem("bycoda.assistant.job-review", JSON.stringify(retained));
  await click("Review brief");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem("bycoda.assistant.job-review")).toBe(JSON.stringify(retained));
  await click("Check conversation");
  localStorage.setItem(
    "bycoda.assistant.job-review",
    JSON.stringify({ ...retained, frozen: false }),
  );
  await click("Review brief");
  const review = document.querySelector('[role="dialog"]')!;
  expect(review.querySelectorAll("textarea")).toHaveLength(1);
  expect(review.querySelector("textarea")!.value).toBe(brief);
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
  const start = [...review.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Start",
  )!;
  await act(async () => start.click());
  await flush();
  const creates = mock.request.mock.calls.filter(([input]) => input.op === "jobs.create");
  expect(creates).toHaveLength(1);
  expect(creates[0][0].request).toBe(brief);
  unconfirmed = true;
  const currentComposer = document.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="What should this job achieve?"]',
  )!;
  setTextareaValue(currentComposer, "Refine another job");
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () =>
      currentComposer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    await flush();
  }
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(2);
  expect(currentComposer.value).toBe("Refine another job");
  expect(JSON.parse(localStorage.getItem("bycoda.assistant.send-intents")!)[thread.id].text).toBe(
    "Refine another job",
  );
  await render({ visibleProjectPaths: [] });
  await flush();
  expect(document.body.textContent).not.toContain("Scope: public changes only");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
});

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
