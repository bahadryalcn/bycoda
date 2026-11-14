import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  roomPrivacy: { pending: false, error: null as string | null },
}));
vi.mock("../../group-lock/model/roomPrivacyProjection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRoomPrivacyStatus: () => mock.roomPrivacy,
  subscribeRoomPrivacyStatus: () => () => {},
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
  dateTimeFormat: (locale: string, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options),
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
import * as privacyModel from "../model/assistantPrivacy";
import { AssistantSetup } from "./AssistantSetup";
import { click, job, snapshot, stubNavigatorLocks } from "./AssistantView.testSupport";
let root: Root | undefined, container: HTMLDivElement;
let queryClient: QueryClient;
beforeEach(() => {
  stubNavigatorLocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.environmentId = "room-fixture";
  mock.automations = [];
  mock.roomPrivacy = { pending: false, error: null };
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
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AssistantView, {
          projectPath: "/one",
          projects: [{ id: "project-one", name: "One", path: "/one" }],
          ...props,
        }),
      ),
    ),
  );
}
it("keeps background privacy qualification out of the Room layout", async () => {
  mock.roomPrivacy = { pending: true, error: null };
  await render();
  expect(container.textContent).not.toContain("Confirming Room privacy protection...");
  await click("Assistant status");
  expect(document.body.textContent).toContain("Confirming Room privacy protection...");
});

it("opens Room at its global conversation even when a coding project is selected", async () => {
  mock.snapshot!.threads = [
    {
      id: "planning-thread",
      purpose: "job-planning",
      version: 1,
      createdAt: 1,
      updatedAt: 9,
      summary: "",
    },
    {
      id: "project-thread",
      projectId: "project-one",
      version: 1,
      createdAt: 1,
      updatedAt: 5,
      summary: "",
    },
    { id: "global-thread", version: 1, createdAt: 1, updatedAt: 1, summary: "" },
  ];
  localStorage.setItem(
    "bycoda.assistant.thread-drafts",
    JSON.stringify({
      "global-thread": "Manage all projects",
      "project-thread": "Coding draft",
    }),
  );
  await render({ initialTab: "conversations" });
  expect(container.querySelector("textarea")?.value).toBe("Manage all projects");
  expect(mock.request.mock.calls.some(([input]) => input.threadId === "planning-thread")).toBe(
    false,
  );
  await click("Open conversation");
  expect(mock.request).toHaveBeenCalledWith({ op: "threads.open" }, "room-fixture");
});
it("shows the Host's working-hours hold without changing the saved job or autonomy", async () => {
  mock.snapshot!.workHoursActive = false;
  await render();
  expect(container.textContent).toContain(
    "Outside working hours. Accepted turns can finish; new work waits.",
  );
  expect(
    mock.request.mock.calls.some(
      ([request]) => request.op === "profile.update" || request.op === "jobs.control",
    ),
  ).toBe(false);
  mock.snapshot!.workHoursActive = true;
  await render();
  expect(container.textContent).not.toContain("Outside working hours.");
});
it("keeps one compact identity and reveals health metadata only on owner request", async () => {
  await render();
  expect(container.querySelectorAll("header h1")).toHaveLength(1);
  expect(container.querySelector("header")?.textContent).not.toContain("Room ·");
  expect(container.textContent).not.toContain("Last checked:");
  expect(container.textContent).not.toContain("Work tracking continues while voice is off.");
  await click("Assistant status");
  expect(document.body.textContent).toContain("Work tracking continues while voice is off.");
  expect(
    mock.request.mock.calls.some(
      ([input]) => !["projects.list", "snapshot", "manual.list"].includes(input.op),
    ),
  ).toBe(false);
});
it("keeps every settings field mounted while switching settings pages", async () => {
  await render({ initialTab: "settings" });
  const groups = [...document.querySelectorAll<HTMLElement>("[data-settings-page]")];
  const cost = groups.find(
    (group) =>
      group.dataset.settingsPage === "advanced" && group.textContent?.includes("Cost and context"),
  )!;
  expect(cost).toBeDefined();
  expect(cost.hidden).toBe(true);
  const fields = cost.querySelectorAll("input,button,select");
  expect(fields.length).toBeGreaterThan(0);
  const advanced = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => tab.textContent === "Advanced",
  )!;
  await act(async () => advanced.click());
  expect(cost.hidden).toBe(false);
  expect(cost.querySelectorAll("input,button,select").length).toBe(fields.length);
  expect(mock.request.mock.calls.some(([input]) => input.op === "profile.update")).toBe(false);
});
it("keeps the confirmed availability while the owner's presence change is pending or unconfirmed", async () => {
  const now = Date.now();
  mock.snapshot!.automaticPresence = {
    state: "present",
    supported: true,
    since: now,
    updatedAt: now,
    idleMs: 0,
  };
  mock.snapshot!.effectivePresence = "present";
  const base = mock.request.getMockImplementation()!;
  let reject!: (error: Error) => void;
  mock.request.mockImplementation((input) =>
    input.op === "presence.set"
      ? new Promise((_resolve, fail) => {
          reject = fail;
        })
      : base(input),
  );
  await render();
  const presence = () => container.querySelector('header [role="status"]')?.textContent;
  expect(presence()).toContain("Here");
  await click("Presence");
  await click("I'm back");
  expect(presence()).toContain("Here");
  await act(async () => reject(new Error("Unconfirmed owner update")));
  expect(presence()).toContain("Here");
  expect(presence()).not.toContain("Unknown");
  expect(mock.snapshot!.effectivePresence).toBe("present");
});

it("removes hidden jobs, selected counts, details, history and trash after live visibility changes without changing Host cache", async () => {
  const secret = {
    ...job("secret-job"),
    projectId: "project-secret",
    title: "Secret project work",
    request: "Secret request",
    summary: "Secret summary",
    sessionIds: ["secret-session"],
  };
  mock.snapshot!.jobs = [job(), secret];
  mock.snapshot!.activity = [
    {
      id: "secret-activity",
      version: 1,
      kind: "job.started",
      jobId: secret.id,
      summary: "Secret timeline",
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  mock.snapshot!.trash = [
    {
      id: "jobs:secret-deleted",
      kind: "jobs",
      projectId: "project-secret",
      title: "Secret deleted",
      deletedAt: 1,
      expiresAt: 2,
    },
  ];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input) =>
    input.op === "projects.list"
      ? Promise.resolve({
          projects: [
            { id: "project-one", name: "One", path: "/one" },
            { id: "project-secret", name: "Secret name", path: "/secret" },
          ],
        })
      : base(input),
  );
  await render({ initialTab: "jobs", visibleProjectPaths: ["/one", "/secret"] });
  const secretCheckbox = [
    ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) => input.getAttribute("aria-label")?.includes(secret.title));
  if (secretCheckbox) await act(async () => secretCheckbox.click());
  await click(secret.title);
  expect(document.body.textContent).toContain("Secret request");
  await render({ initialTab: "jobs", visibleProjectPaths: ["/one"] });
  expect(document.body.textContent).not.toContain("Secret");
  expect(document.body.textContent).not.toContain("secret-session");
  expect(container.textContent).not.toContain("1 selected");
  expect(mock.snapshot!.jobs).toHaveLength(2);
  await click("Records");
  await click("What I did");
  expect(container.textContent).not.toContain("Secret timeline");
  await click("More options");
  const trashItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes("Recently deleted"),
  )!;
  await act(async () => trashItem.click());
  expect(document.body.textContent).not.toContain("Secret deleted");
});

it("hides a selected private transcript and draft immediately, retaining its canonical draft for unlock", async () => {
  const now = Date.now();
  mock.snapshot!.threads = [
    { id: "global", version: 1, createdAt: now, updatedAt: now, summary: "Global conversation" },
    {
      id: "secret-thread",
      projectId: "project-secret",
      version: 1,
      createdAt: now,
      updatedAt: now,
      summary: "Secret thread",
    },
  ];
  localStorage.setItem(
    "bycoda.assistant.thread-drafts",
    JSON.stringify({ "secret-thread": "Secret unsent draft" }),
  );
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input) =>
    input.op === "projects.list"
      ? Promise.resolve({
          projects: [
            { id: "project-one", name: "One", path: "/one" },
            { id: "project-secret", name: "Secret name", path: "/secret" },
          ],
        })
      : input.op === "threads.messages"
        ? Promise.resolve({
            messages: [
              {
                id: "secret-message",
                threadId: "secret-thread",
                text: "Secret transcript",
                role: "user",
                via: "text",
                version: 1,
                createdAt: now,
                updatedAt: now,
                jobIds: [],
              },
            ],
          })
        : base(input),
  );
  await render({
    initialTab: "conversations",
    projectPath: "/secret",
    visibleProjectPaths: ["/one", "/secret"],
  });
  // Select the source explicitly because initial Host project discovery is asynchronous.
  const threadButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith("Secret name"),
  )!;
  await act(async () => threadButton.click());
  expect(container.textContent).toContain("Secret transcript");
  await render({
    initialTab: "conversations",
    projectPath: "/secret",
    visibleProjectPaths: ["/one"],
  });
  expect(document.body.textContent).not.toContain("Secret");
  expect(container.querySelector("textarea")?.value).toBe("");
  expect(localStorage.getItem("bycoda.assistant.thread-drafts")).toContain("Secret unsent draft");
  await render({
    initialTab: "conversations",
    projectPath: "/secret",
    visibleProjectPaths: ["/one", "/secret"],
  });
  const unlockedThread = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.startsWith("Secret name"),
  )!;
  await act(async () => unlockedThread.click());
  expect(container.querySelector("textarea")?.value).toBe("Secret unsent draft");
});
it("shows recorded actions with their transcript and hides the whole row when a contributor disappears", async () => {
  const thread = {
    id: "thread-actions",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    projectId: "project-one",
    summary: "",
  };
  mock.snapshot!.threads = [thread];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input) =>
    input.op === "projects.list"
      ? Promise.resolve({
          projects: [
            { id: "project-one", path: "/one", name: "One" },
            { id: "project-secret", path: "/secret", name: "Secret" },
          ],
        })
      : input.op === "threads.messages"
        ? Promise.resolve({
            messages: [
              {
                id: "accepted-owner",
                version: 1,
                createdAt: 1,
                updatedAt: 1,
                threadId: thread.id,
                role: "user",
                via: "voice",
                text: "Accepted owner request with recorded activity",
                jobIds: ["accepted-job"],
                projectIds: ["project-one", "project-secret"],
                toolActions: [
                  {
                    id: "actual-ticket",
                    family: "conversation",
                    action: "tasks.get",
                    status: "completed",
                    createdAt: 1,
                  },
                ],
              },
            ],
          })
        : base(input),
  );
  await render({
    initialTab: "conversations",
    projectPath: "/one",
    visibleProjectPaths: ["/one", "/secret"],
  });
  const sourceThread = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith("One"),
  )!;
  await act(async () => sourceThread.click());
  expect(container.textContent).toContain("Accepted owner request with recorded activity");
  expect(container.querySelector("details summary")?.textContent).toContain("Recorded actions");
  expect(container.textContent).toContain("tasks.get");
  expect(container.textContent).toContain("accepted-job");
  await render({ initialTab: "conversations", projectPath: "/one", visibleProjectPaths: ["/one"] });
  expect(container.textContent).not.toContain("Accepted owner request with recorded activity");
  expect(container.textContent).not.toContain("tasks.get");
  expect(container.textContent).not.toContain("accepted-job");
});
it("keeps global emergency-stop uncertainty visible without leaking a hidden source after a lock", async () => {
  let rejectStop!: (cause: Error) => void;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input) =>
    input.op === "pauseAll"
      ? new Promise((_, reject) => {
          rejectStop = reject;
        })
      : base(input),
  );
  await render({ visibleProjectPaths: ["/one"] });
  await click("Stop everything");
  await render({ visibleProjectPaths: [] });
  await act(async () => rejectStop(new Error("Secret source failed to stop")));
  expect(document.body.textContent).toContain(
    "The stop request could not be confirmed. Check the Room.",
  );
  expect(document.body.textContent).not.toContain("Secret source");
});
it("forwards the actual row-read Host identity to navigation without inventing a current Host", async () => {
  mock.snapshot!.jobs = [job()];
  const open = vi.fn(async () => {});
  await render({ initialTab: "sessions", onOpenSession: open });
  await click("Open session");
  expect(open).toHaveBeenCalledWith("session-one", "room-fixture");
});

it("gates an unconfigured core and keeps execution controls unavailable", async () => {
  mock.snapshot!.profile.setupComplete = false;
  mock.snapshot!.profile.name = "";
  await render();
  expect(container.textContent).toContain("Choose a name, working permissions and a daily budget");
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
});

it("reviews multiline jobs and retains the failed request with its original idempotency key", async () => {
  localStorage.setItem("bycoda.assistant.job-draft", "Fix login\nWrite docs");
  let creates = 0;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.create") {
      AssistantRequestSchema.parse(input);
      creates++;
      if (creates === 2) throw new Error("Host offline");
      return {
        job: {
          ...job(input.idempotencyKey),
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
  await click("Review jobs");
  await click("Start");
  expect(document.body.textContent).toContain("Host offline");
  const attempts = mock.request.mock.calls
    .filter(([input]) => input.op === "jobs.create")
    .map(([input]) => input);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].projectId).toBe("project-one");
  expect(attempts[0].idempotencyKey).not.toBe(attempts[1].idempotencyKey);
  await click("Check and retry");
  const retried = mock.request.mock.calls
    .filter(([input]) => input.op === "jobs.create")
    .map(([input]) => input);
  expect(retried).toHaveLength(3);
  expect(retried[2]).toEqual(attempts[1]);
  expect(localStorage.getItem("bycoda.assistant.job-draft")).toBe("");
});

it("stops the exact versioned job and suppresses duplicate clicks while pending", async () => {
  mock.snapshot!.jobs = [job()];
  let finish!: () => void;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) =>
    input.op === "jobs.control"
      ? new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        })
      : base(input),
  );
  await render();
  await click("Job actions");
  await click("Stop job");
  await click("Job actions");
  const again = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === "Stop job",
  );
  if (again) await act(async () => again.click());
  const calls = mock.request.mock.calls.filter(([input]) => input.op === "jobs.control");
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toEqual({
    op: "jobs.control",
    id: "job-one",
    expectedVersion: 7,
    action: "stop",
  });
  await act(async () => finish());
});

it("recovers only a blocked Chief review without cancelling running jobs", async () => {
  mock.snapshot!.profile.autonomy = "chief";
  mock.snapshot!.chiefReview = { blocked: true, message: "The review outcome is unknown." };
  await render();
  expect(container.textContent).toContain("Supervisor review needs attention");
  await click("Retry review");
  expect(mock.request).toHaveBeenCalledWith({ op: "chief.retry" }, "room-fixture");
  expect(
    mock.request.mock.calls.some(([input]) => input.op === "pauseAll" || input.op === "resumeAll"),
  ).toBe(false);
});

it("keeps emergency Stop available during a pending navigation and prevents duplicate stops", async () => {
  mock.snapshot!.jobs = [job()];
  let finishNavigation!: () => void;
  let finishStop!: () => void;
  const open = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishNavigation = resolve;
      }),
  );
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input) =>
    input.op === "pauseAll"
      ? new Promise((resolve) => {
          finishStop = () => resolve({ ok: true });
        })
      : base(input),
  );
  await render({ initialTab: "sessions", onOpenSession: open });
  await click("Open session");
  await click("Stop everything");
  await click("Stop everything");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "pauseAll")).toHaveLength(1);
  expect(open).toHaveBeenCalledOnce();
  await act(async () => {
    finishStop();
    finishNavigation();
  });
});

it("surfaces failed session navigation and preserves the room for retry", async () => {
  mock.snapshot!.jobs = [job()];
  const open = vi.fn(async () => {
    throw new Error("Session Host unavailable");
  });
  await render({ initialTab: "sessions", onOpenSession: open });
  await click("Open session");
  expect(container.textContent).toContain("Session Host unavailable");
  await click("Open session");
  expect(open).toHaveBeenCalledTimes(2);
});

it("toggles memory with only canonical schema fields and its captured version", async () => {
  mock.snapshot!.memory = [
    {
      id: "rule-one",
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      kind: "rule",
      text: "Do not interrupt me",
      scope: "voice",
      source: "typed",
      quote: "Do not interrupt me",
      active: true,
      forbiddenTerms: [],
    },
  ];
  await render({ initialTab: "memory" });
  await click("Enable memory");
  const request = mock.request.mock.calls.find(([input]) => input.op === "memory.save")![0];
  expect(request).toMatchObject({
    id: "rule-one",
    expectedVersion: 2,
    active: false,
  });
  expect(() => AssistantRequestSchema.parse(request)).not.toThrow();
});

it("restores the composite trash identity after deleting a job", async () => {
  mock.snapshot!.jobs = [job()];
  await render();
  await click("Job actions");
  await click("Delete...");
  await click("Delete job only");
  expect(container.textContent).toContain("Deleted");
  await click("Undo");
  expect(mock.request).toHaveBeenCalledWith(
    {
      op: "trash.restore",
      id: "jobs:job-one",
    },
    "room-fixture",
  );
});
it("defaults to job-only deletion while showing every canonical task beyond the summary IDs", async () => {
  mock.snapshot!.jobs = [job()];
  const base = mock.request.getMockImplementation()!;
  const review = {
    jobId: job().id,
    jobVersion: job().version,
    sourceToken: "a".repeat(64),
    goalId: job().goalId,
    projectIds: [job().projectId],
    tasks: [
      {
        id: "task-one",
        title: "First canonical task",
        projectId: job().projectId,
        status: "running",
        updatedAt: 1,
      },
      {
        id: "task-two",
        title: "Another canonical task",
        projectId: job().projectId,
        status: "queued",
        updatedAt: 1,
      },
    ],
  };
  mock.request.mockImplementation(async (input) =>
    input.op === "jobs.deleteReview" ? { deleteReview: review } : base(input),
  );
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Delete...");
  expect(document.body.textContent).toContain("Another canonical task");
  const check = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!;
  expect(check.checked).toBe(false);
  await click("Delete job only");
  const input = mock.request.mock.calls.find(([input]) => input.op === "jobs.control")![0];
  expect(input).not.toHaveProperty("deleteTasks");
  expect(input).not.toHaveProperty("taskDeleteToken");
});
it("freezes selected task scope after an uncertain deletion and Keeps the actual latest job paused without Resume", async () => {
  mock.snapshot!.jobs = [job()];
  const base = mock.request.getMockImplementation()!,
    review = {
      jobId: job().id,
      jobVersion: job().version,
      sourceToken: "a".repeat(64),
      goalId: job().goalId,
      projectIds: [job().projectId],
      tasks: [
        {
          id: "task-one",
          title: "Canonical task",
          projectId: job().projectId,
          status: "running",
          updatedAt: 1,
        },
      ],
    };
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.deleteReview") return { deleteReview: review };
    if (input.op === "jobs.control") {
      mock.snapshot!.jobs = [
        { ...job(), version: 8, status: "waiting", pendingTaskDeletion: true },
      ];
      throw new Error("Original retirement unknown");
    }
    if (input.op === "jobs.deleteAbort") {
      expect(input.expectedVersion).toBe(8);
      const kept = {
        ...job(),
        version: 9,
        status: "paused" as const,
        pendingTaskDeletion: false,
        awaitingOwnerRestart: true,
      };
      mock.snapshot!.jobs = [kept];
      return { job: kept };
    }
    return base(input);
  });
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Delete...");
  const check = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!;
  await act(async () => check.click());
  await click("Delete job and tasks");
  expect(document.body.textContent).toContain("Original retirement unknown");
  expect(mock.request.mock.calls.find(([input]) => input.op === "jobs.control")?.[0]).toMatchObject(
    { deleteTasks: true, taskDeleteToken: review.sourceToken, expectedVersion: 7 },
  );
  await act(async () => check.click());
  await click("Delete job only");
  expect(document.body.textContent).toContain("Keep its original task selection");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.control")).toHaveLength(1);
  await click("Cancel");
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Keep job and tasks");
  expect(mock.request).toHaveBeenCalledWith(
    { op: "jobs.deleteAbort", id: job().id, expectedVersion: 8 },
    "room-fixture",
  );
  await click("Job actions");
  expect(document.body.textContent).not.toMatch(/\bResume\b/);
});

it("keeps failed conversation drafts across tabs and reuses the accepted send identity", async () => {
  const thread = {
    id: "thread-one",
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    projectId: "project-one",
    summary: "",
  };
  mock.snapshot!.threads = [thread];
  localStorage.setItem(
    "bycoda.assistant.thread-drafts",
    JSON.stringify({ "thread-one": "Plan the next release" }),
  );
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "threads.send") throw new Error("Reply outcome unknown");
    return base(input);
  });
  await render({ initialTab: "conversations" });
  await click("Send");
  const first = mock.request.mock.calls.find(([input]) => input.op === "threads.send")![0];
  expect(document.body.textContent).toContain("Reply outcome unknown");
  await click("Jobs");
  await click("Conversations");
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    "Plan the next release",
  );
  // Draft restoration is safe; an uncertain send does not automatically replay.
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(1);
  expect(first).toMatchObject({
    threadId: "thread-one",
    text: "Plan the next release",
    via: "text",
  });
});

async function renderConversationDraft() {
  mock.snapshot!.threads = [
    {
      id: "keyboard-thread",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      summary: "",
    },
  ];
  localStorage.setItem(
    "bycoda.assistant.thread-drafts",
    JSON.stringify({ "keyboard-thread": "Keep this exact draft" }),
  );
  await render({ initialTab: "conversations" });
  return container.querySelector<HTMLTextAreaElement>("textarea")!;
}

it("coalesces conversation draft writes while keeping current input", async () => {
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input, environment) =>
    input.op === "threads.messages"
      ? Promise.resolve({
          messages: Array.from({ length: 100 }, (_, index) => ({
            id: `message-${index}`,
            threadId: "keyboard-thread",
            version: 1,
            createdAt: index + 1,
            updatedAt: index + 1,
            role: "user",
            via: "text",
            text: `Message ${index}`,
            jobIds: [],
          })),
        })
      : base(input, environment),
  );
  const textarea = await renderConversationDraft();
  expect(container.querySelectorAll("article")).toHaveLength(100);
  const writes = vi.spyOn(localStorage, "setItem");
  const project = vi.spyOn(privacyModel, "projectAssistantSnapshot");
  const messages = vi.spyOn(privacyModel, "visibleAssistantMessages");
  const formatDates = vi.spyOn(Date.prototype, "toLocaleDateString");
  for (let index = 1; index <= 5; index++) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        `draft ${index}`,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(textarea.value).toBe("draft 5");
  expect(
    writes.mock.calls.filter(([key]) => key === "bycoda.assistant.thread-drafts"),
  ).toHaveLength(0);
  expect(project).toHaveBeenCalledTimes(0);
  expect(messages).toHaveBeenCalledTimes(0);
  expect(formatDates).toHaveBeenCalledTimes(0);
  await click("Jobs");
  expect(
    writes.mock.calls.filter(([key]) => key === "bycoda.assistant.thread-drafts"),
  ).toHaveLength(1);
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.thread-drafts")!)["keyboard-thread"],
  ).toBe("draft 5");
  writes.mockRestore();
  project.mockRestore();
  messages.mockRestore();
  formatDates.mockRestore();
});

it("retains an unsaved conversation draft across tab changes and retries storage", async () => {
  const textarea = await renderConversationDraft();
  const originalSet = localStorage.setItem.bind(localStorage);
  const denied = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === "bycoda.assistant.thread-drafts") throw new Error("quota");
    originalSet(key, value);
  });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "Unsaved reply",
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(document.body.textContent).toContain("Could not save this draft");
  await click("Jobs");
  await click("Conversations");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Unsaved reply");
  denied.mockRestore();
  await click("Retry saving");
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.thread-drafts")!)["keyboard-thread"],
  ).toBe("Unsaved reply");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(0);
});

it("flushes a continuously edited conversation draft within two seconds", async () => {
  const textarea = await renderConversationDraft();
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  vi.useFakeTimers();
  const writes = vi.spyOn(localStorage, "setItem");
  for (let index = 1; index <= 6; index++) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        `continuous ${index}`,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(350);
    });
  }
  await act(async () => vi.advanceTimersByTime(300));
  expect(
    writes.mock.calls.filter(([key]) => key === "bycoda.assistant.thread-drafts"),
  ).toHaveLength(1);
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.thread-drafts")!)["keyboard-thread"],
  ).toBe("continuous 6");
  writes.mockRestore();
});

it("sends the retained chat draft with Enter and clears it only after a confirmed reply", async () => {
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "threads.send")
      return {
        messages: [
          {
            id: "keyboard-reply",
            threadId: input.threadId,
            role: "assistant",
            via: "text",
            text: "Confirmed reply",
            jobIds: [],
            version: 1,
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      };
    return base(input);
  });
  const textarea = await renderConversationDraft();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => textarea.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
  const sends = mock.request.mock.calls.filter(([input]) => input.op === "threads.send");
  expect(sends).toHaveLength(1);
  expect(sends[0]).toEqual([
    expect.objectContaining({
      threadId: "keyboard-thread",
      text: "Keep this exact draft",
      via: "text",
      idempotencyKey: expect.any(String),
    }),
    "room-fixture",
  ]);
  expect(textarea.value).toBe("");
  expect(container.textContent).toContain("Confirmed reply");
});

it.each([
  ["Shift+Enter", { shiftKey: true }],
  ["Alt+Enter", { altKey: true }],
  ["Ctrl+Enter", { ctrlKey: true }],
  ["Meta+Enter", { metaKey: true }],
  ["IME composition", { isComposing: true }],
] as const)("keeps %s native and retains the unsent chat draft", async (_label, modifiers) => {
  const textarea = await renderConversationDraft();
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  await act(async () => textarea.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false);
  expect(mock.request.mock.calls.some(([input]) => input.op === "threads.send")).toBe(false);
  expect(textarea.value).toBe("Keep this exact draft");
});

it("does not send the chat draft for legacy IME Enter key code 229", async () => {
  const textarea = await renderConversationDraft();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  Object.defineProperty(enter, "keyCode", { value: 229 });
  await act(async () => textarea.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false);
  expect(mock.request.mock.calls.some(([input]) => input.op === "threads.send")).toBe(false);
  expect(textarea.value).toBe("Keep this exact draft");
});

it("blocks another Enter while the chat reply is pending and retains a failed draft", async () => {
  const base = mock.request.getMockImplementation()!;
  let rejectSend!: (cause: Error) => void;
  mock.request.mockImplementation((input) =>
    input.op === "threads.send"
      ? new Promise((_resolve, reject) => {
          rejectSend = reject;
        })
      : base(input),
  );
  const textarea = await renderConversationDraft();
  const pressEnter = () =>
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  await act(async () => {
    pressEnter();
  });
  await act(async () => {
    pressEnter();
  });
  expect(mock.request.mock.calls.filter(([input]) => input.op === "threads.send")).toHaveLength(1);
  expect(textarea.value).toBe("Keep this exact draft");
  await act(async () => rejectSend(new Error("Reply outcome unknown")));
  expect(container.textContent).toContain("Reply outcome unknown");
  expect(textarea.value).toBe("Keep this exact draft");
});

it("does not send from Enter when this Host has no conversation capability", async () => {
  mock.snapshot!.capabilities.conversations = false;
  const textarea = await renderConversationDraft();
  await act(async () =>
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(mock.request.mock.calls.some(([input]) => input.op === "threads.send")).toBe(false);
  expect(textarea.value).toBe("Keep this exact draft");
  expect(container.textContent).toContain("Conversation replies are unavailable.");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(true);
});

it("applies repeated external navigation without remounting the room", async () => {
  await render({ initialTab: "memory", navigationToken: 1 });
  expect(container.querySelector('[aria-label="Memory"]')).not.toBeNull();
  await click("Jobs");
  await render({ initialTab: "memory", navigationToken: 2 });
  expect(container.querySelector("#assistant-content")?.getAttribute("aria-label")).toBe("Memory");
});

it("clears the captured complete conversation while retaining its unsent draft and freezing its target until confirmation settles", async () => {
  const thread = {
    id: "thread-one",
    version: 9,
    createdAt: 1,
    updatedAt: 1,
    projectId: "project-one",
    summary: "Retained summary",
  };
  mock.snapshot!.threads = [thread];
  localStorage.setItem(
    "bycoda.assistant.thread-drafts",
    JSON.stringify({ "thread-one": "Unsent owner draft" }),
  );
  const base = mock.request.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "threads.messages")
      return {
        messages: [
          {
            id: "visible",
            version: 1,
            createdAt: 1,
            updatedAt: 1,
            threadId: thread.id,
            role: "user",
            via: "text",
            text: "Visible saved message",
            jobIds: [],
          },
        ],
      };
    if (input.op === "threads.clear")
      return new Promise((done) => {
        resolve = done;
      });
    return base(input);
  });
  await render({ initialTab: "conversations" });
  await click("Conversation actions");
  await click("Clear conversation...");
  expect(document.body.textContent).toContain("Move all messages in this conversation");
  await click("Clear all messages");
  expect(mock.request).toHaveBeenCalledWith(
    { op: "threads.clear", threadId: "thread-one", expectedVersion: 9 },
    "room-fixture",
  );
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    "Unsent owner draft",
  );
  expect(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "Open conversation",
    )?.disabled,
  ).toBe(true);
  await act(async () => resolve({ thread: { ...thread, version: 10 } }));
  expect(container.textContent).not.toContain("Visible saved message");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    "Unsent owner draft",
  );
  expect(thread.summary).toBe("Retained summary");
});

function summaryThread(
  version = 1,
  status: "pending" | "working" | "blocked" | "ready" = "working",
  updatedAt = 10,
) {
  return {
    id: "summary-thread",
    projectId: "project-one",
    version,
    createdAt: 1,
    updatedAt: 1,
    summary: "Private summary text must never be shown",
    summaryState: { status, updatedAt, message: "Private provider error must never be shown" },
    ...(status === "ready"
      ? {
          summaryProof: {
            id: "summary-proof",
            version: 1,
            projectIds: ["project-one"],
            throughMessageId: "last-owner",
            messageCount: 8,
            createdAt: updatedAt,
            inputTruncated: false,
            omittedMessages: 0,
          },
        }
      : {}),
  };
}
it("refreshes summaries only explicitly and keeps a lost ACK nonce through retry while preserving newer status", async () => {
  const thread = summaryThread();
  mock.snapshot!.threads = [thread];
  const base = mock.request.getMockImplementation()!;
  let count = 0,
    acknowledge!: (value: unknown) => void;
  mock.request.mockImplementation(async (input, env) => {
    if (input.op === "threads.summary.refresh") {
      if (++count === 1) throw new Error("Sensitive upstream result lost");
      return new Promise((resolve) => {
        acknowledge = resolve;
      });
    }
    return base(input, env);
  });
  await render({ initialTab: "conversations" });
  expect(count).toBe(0);
  expect(container.textContent).toContain("Updating conversation summary");
  await click("Conversation actions");
  await click("Refresh conversation summary");
  const summary = [...container.querySelectorAll<HTMLElement>("[data-tooltip-owner]")].find(
    (element) => element.textContent === "Summary unavailable",
  )!;
  await act(async () => {
    summary.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "Summary refresh was not confirmed.",
  );
  expect(container.textContent).toContain("Summary unavailable");
  expect(container.textContent).not.toContain("Sensitive upstream");
  await click("Conversation actions");
  await click("Retry summary refresh");
  const calls = mock.request.mock.calls.filter(([input]) => input.op === "threads.summary.refresh");
  expect(calls).toHaveLength(2);
  expect(calls[0][0]).toEqual(calls[1][0]);
  expect(calls.map(([, env]) => env)).toEqual(["room-fixture", "room-fixture"]);
  await click("Conversation actions");
  expect(
    mock.request.mock.calls.filter(([input]) => input.op === "threads.summary.refresh"),
  ).toHaveLength(2);
  await act(async () => acknowledge({ thread: summaryThread(2, "ready", 40) }));
  expect(container.textContent).not.toContain("Summary waiting");
  expect(container.textContent).not.toContain(thread.summary);
  expect(container.textContent).not.toContain(thread.summaryState.message);
  mock.snapshot!.threads = [summaryThread(1, "working", 20)];
  await render({ initialTab: "conversations" });
  expect(container.textContent).not.toContain("Summary waiting");
  await click("Conversation actions");
  expect(document.body.textContent).toContain("Refresh conversation summary");
  expect(document.body.textContent).not.toContain("Retry summary refresh");
  await act(async () =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  mock.snapshot!.threads = [summaryThread(3, "blocked", 50)];
  await render({ initialTab: "conversations" });
  expect(container.textContent).toContain("Summary waiting");
  expect(container.textContent).not.toContain("A verified conversation summary is available.");
});
it("merges summary metadata returned with messages by same-version summary timestamp", async () => {
  mock.snapshot!.threads = [summaryThread(4, "pending", 10)];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input, env) =>
    input.op === "threads.messages"
      ? Promise.resolve({ messages: [], thread: summaryThread(4, "ready", 30) })
      : base(input, env),
  );
  await render({ initialTab: "conversations" });
  expect(container.textContent).not.toContain("Summary waiting");
  mock.snapshot!.threads = [summaryThread(4, "working", 20)];
  await render({ initialTab: "conversations" });
  expect(container.textContent).not.toContain("Summary waiting");
  mock.snapshot!.threads = [summaryThread(4, "blocked", 40)];
  await render({ initialTab: "conversations" });
  expect(container.textContent).toContain("Summary waiting");
  expect(mock.request.mock.calls.some(([input]) => input.op === "threads.summary.refresh")).toBe(
    false,
  );
});
it("keeps an original summary nonce after Host swap and ignores its late ACK even with cloned thread IDs", async () => {
  mock.snapshot!.threads = [summaryThread()];
  const base = mock.request.getMockImplementation()!;
  let acknowledge!: (value: unknown) => void;
  mock.request.mockImplementation(async (input, env) =>
    input.op === "threads.summary.refresh"
      ? new Promise((resolve) => {
          acknowledge = resolve;
        })
      : base(input, env),
  );
  await render({ initialTab: "conversations" });
  await click("Conversation actions");
  await click("Refresh conversation summary");
  const call = mock.request.mock.calls.find(([input]) => input.op === "threads.summary.refresh")!;
  mock.environmentId = "replacement-host";
  mock.snapshot!.threads = [summaryThread(1, "blocked", 90)];
  await render({ initialTab: "conversations" });
  await act(async () => acknowledge({ thread: summaryThread(9, "ready", 100) }));
  expect(call[1]).toBe("room-fixture");
  expect(container.textContent).not.toContain("A verified conversation summary is available.");
  const retainedKeys = Object.keys(localStorage).filter((key) =>
    key.startsWith("bycoda.assistant.summary-refresh:"),
  );
  expect(retainedKeys).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(retainedKeys[0])!)).toMatchObject({
    environmentId: "room-fixture",
    threadId: "summary-thread",
    requestId: call[0].requestId,
  });
  expect(
    mock.request.mock.calls.filter(([input]) => input.op === "threads.summary.refresh"),
  ).toHaveLength(1);
  mock.environmentId = "room-fixture";
  mock.snapshot!.threads = [summaryThread()];
  await render({ initialTab: "conversations" });
  await click("Conversation actions");
  expect(document.body.textContent).toContain("Retry summary refresh");
});
it("withholds ready status and refresh for a summary whose saved contributors are hidden", async () => {
  const thread = summaryThread(3, "ready", 40);
  thread.summaryProof!.projectIds = ["project-one", "project-secret"];
  mock.snapshot!.threads = [thread];
  await render({ initialTab: "conversations", visibleProjectPaths: ["/one"] });
  expect(container.textContent).not.toContain("A verified conversation summary is available.");
  expect(container.textContent).not.toContain(thread.summary);
  await click("Conversation actions");
  const refresh = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Refresh conversation summary",
  )!;
  expect(refresh.disabled).toBe(true);
  expect(mock.request.mock.calls.some(([input]) => input.op === "threads.summary.refresh")).toBe(
    false,
  );
});

it("retains the chosen retention draft after failure and retries with the acknowledged profile version", async () => {
  const base = mock.request.getMockImplementation()!;
  let savedVersion = 3,
    retentionCalls = 0;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "profile.update")
      return { profile: { ...mock.snapshot!.profile, version: ++savedVersion } };
    if (input.op === "conversations.retention") {
      if (++retentionCalls === 1) throw new Error("Retention save unavailable");
      return { ok: true };
    }
    return base(input);
  });
  await render({ initialTab: "settings" });
  await click("Keep conversation messages: Forever");
  await click("30 days");
  await click("Save profile settings");
  expect(document.body.textContent).toContain("Retention save unavailable");
  expect(document.body.textContent).toContain("30 days");
  await click("Save profile settings");
  expect(
    mock.request.mock.calls
      .filter(([input]) => input.op === "profile.update")
      .map(([input]) => input.expectedVersion),
  ).toEqual([3, 4]);
  expect(
    mock.request.mock.calls
      .filter(([input]) => input.op === "conversations.retention")
      .map(([input]) => input.days),
  ).toEqual([30, 30]);
});
it("creates an explicitly reviewed global quick note in Report mode and opens only its exact canonical note", async () => {
  const text = "Save my personal note";
  localStorage.setItem("bycoda.assistant.job-draft", text);
  mock.snapshot!.capabilities.jobs = false;
  mock.snapshot!.capabilities.quickNotes = true;
  const base = mock.request.getMockImplementation()!;
  const savedNote = {
    id: "quick-note",
    title: "Save my personal note",
    body: text,
    tags: ["assistant"],
    createdAt: 1,
    updatedAt: 1,
  };
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.create") {
      AssistantRequestSchema.parse(input);
      expect(input.kind).toBe("quick");
      expect(input).not.toHaveProperty("projectId");
      const accepted = {
        ...job(),
        ...input,
        kind: "quick",
        projectId: null,
        projectIds: [],
        status: "done",
        goalId: undefined,
        taskIds: [],
        sessionIds: [],
        quickResult: { noteId: savedNote.id },
      };
      mock.snapshot!.jobs = [accepted as any];
      return { job: accepted };
    }
    if (input.op === "notes.get") return { note: savedNote };
    return base(input);
  });
  await render();
  await click("Review jobs");
  await click("Job type: Project work");
  await click("Save personal note");
  expect(document.body.textContent).toContain("Note content");
  expect(
    [...document.querySelectorAll("button")].some((button) =>
      button.getAttribute("aria-label")?.startsWith("Participating projects:"),
    ),
  ).toBe(false);
  await click("Save notes");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
  await render();
  await click("Jobs");
  await click(text);
  await click("Open saved note");
  expect(mock.request).toHaveBeenCalledWith({ op: "notes.get", id: "quick-note" }, "room-fixture");
  expect(document.querySelector('section[aria-label="Edit note"]')).not.toBeNull();
  expect(document.querySelector("[data-note-editor] .cm-content")?.textContent).toBe(text);
});
it("retains a frozen quick review across cancel/reopen and resolves the original lost receipt without a second create", async () => {
  const text = "Save a private personal note";
  localStorage.setItem("bycoda.assistant.job-draft", text);
  mock.snapshot!.capabilities.quickNotes = true;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.create") {
      mock.snapshot!.jobs = [
        {
          ...job(),
          ...input,
          kind: "quick",
          projectId: null,
          projectIds: [],
          status: "done",
          goalId: undefined,
          taskIds: [],
          sessionIds: [],
          quickResult: { noteId: "saved-note" },
        } as any,
      ];
      throw new Error("Quick receipt lost after commit");
    }
    return base(input);
  });
  await render();
  await click("Review jobs");
  await click("Job type: Project work");
  await click("Save personal note");
  await click("Save notes");
  expect(document.body.textContent).toContain("Quick receipt lost");
  const persisted = JSON.parse(localStorage.getItem("bycoda.assistant.job-review")!);
  expect(persisted.frozen).toBe(true);
  expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.disabled).toBe(
    true,
  );
  await click("Cancel");
  await click("Review jobs");
  expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value).toBe(text);
  await click("Check and retry");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.create")).toHaveLength(1);
  expect(localStorage.getItem("bycoda.assistant.job-review")).toBeNull();
});
it.each([true, false])(
  "uses only the exact note trash receipt for Undo and falls back to Recently deleted for an older Host: %s",
  async (receipt) => {
    const note = {
      id: "native-note-id",
      title: "Owner note",
      body: "Body",
      tags: ["assistant"],
      createdAt: 1,
      updatedAt: 7,
    };
    mock.snapshot!.notes = [note];
    const base = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (input) =>
      input.op === "notes.delete"
        ? { ok: true, ...(receipt ? { trashId: "notetrash:actual-backup-id" } : {}) }
        : base(input),
    );
    await render({ initialTab: "notes" });
    await click("Delete note");
    await click("Delete");
    if (receipt) {
      await click("Undo");
      expect(mock.request).toHaveBeenCalledWith(
        { op: "trash.restore", id: "notetrash:actual-backup-id" },
        "room-fixture",
      );
    } else {
      expect(
        [...document.querySelectorAll("button")].some((button) => button.textContent === "Undo"),
      ).toBe(false);
      await click("Recently deleted");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Deleted records are kept for seven days",
      );
    }
    expect(mock.request).not.toHaveBeenCalledWith({
      op: "trash.restore",
      id: "notetrash:native-note-id",
    });
  },
);
it.each([true, false])(
  "retires only a confirmed exact Undo target after library restore; preserves unknown receipts: %s",
  async (acknowledged) => {
    const note = {
      id: "native-note-id",
      title: "Owner note",
      body: "Body",
      tags: ["assistant"],
      createdAt: 1,
      updatedAt: 7,
    };
    mock.snapshot!.notes = [note];
    mock.snapshot!.trash = [
      {
        id: "notetrash:actual-backup",
        kind: "notetrash",
        title: note.title,
        deletedAt: 1,
        expiresAt: Date.now() + 100000,
      },
      {
        id: "notetrash:unrelated",
        kind: "notetrash",
        title: "Other owner note",
        deletedAt: 1,
        expiresAt: Date.now() + 100000,
      },
    ];
    const base = mock.request.getMockImplementation()!;
    let restores = 0;
    mock.request.mockImplementation(async (input) => {
      if (input.op === "pauseAll") throw new Error("Unrelated stop outcome is uncertain");
      if (input.op === "notes.delete") return { ok: true, trashId: "notetrash:actual-backup" };
      if (input.op === "trash.restore") {
        if (++restores === 1) throw new Error("Original exact Undo failed");
        if (acknowledged)
          mock.snapshot!.trash = mock.snapshot!.trash.filter((item) => item.id !== input.id);
        return acknowledged ? { ok: true } : {};
      }
      return base(input);
    });
    await render({ initialTab: "notes" });
    await click("Delete note");
    await click("Delete");
    await click("Undo");
    expect(document.body.textContent).toContain("Original exact Undo failed");
    if (acknowledged) await click("Stop everything");
    await click("More options");
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Recently deleted"),
    )!;
    await act(async () => item.click());
    await click("Restore");
    if (acknowledged) {
      expect(document.body.textContent).toContain("Unrelated stop outcome is uncertain");
      expect(document.body.textContent).not.toContain("Original exact Undo failed");
      expect(
        [...document.querySelectorAll("button")].some((button) => button.textContent === "Undo"),
      ).toBe(false);
      expect(document.body.textContent).toContain("Other owner note");
    } else {
      expect(document.body.textContent).toContain("The restore could not be confirmed");
      expect(document.body.textContent).toContain("Original exact Undo failed");
      expect(
        [...document.querySelectorAll("button")].some((button) => button.textContent === "Undo"),
      ).toBe(true);
    }
    expect(
      mock.request.mock.calls
        .filter(([input]) => input.op === "trash.restore")
        .every(([input]) => input.id === "notetrash:actual-backup"),
    ).toBe(true);
  },
);
it("preserves explicit assistant role providers and nullable inheritance in settings saves", async () => {
  mock.snapshot!.profile.chiefExecution = {
    harness: "codex",
    model: "gpt-5",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 30,
  };
  mock.snapshot!.profile.replyExecution = null;
  mock.snapshot!.profile.planningExecution = {
    harness: "claude",
    model: "sonnet",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 20,
  };
  await render({ initialTab: "settings" });
  // Save is disabled until the draft changes; this edit leaves the role patch unchanged.
  await click("Allow profanity");
  await click("Save profile settings");
  expect(mock.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({
        chiefExecution: mock.snapshot!.profile.chiefExecution,
        replyExecution: null,
        planningExecution: mock.snapshot!.profile.planningExecution,
      }),
    }),
    "room-fixture",
  );
});
it("submits every existing policy field from Settings without forwarding profile authority metadata", async () => {
  const policy = {
    idleMinutes: 7,
    awayMinutes: 83,
    activeStart: 22,
    activeEnd: 6,
    notificationPresent: "none" as const,
    notificationAway: "all" as const,
    notificationDnd: "none" as const,
    chiefWakeLimit: 11,
    nudgeLimit: 0,
    summaryRefreshMessages: 37,
  };
  Object.assign(mock.snapshot!.profile, policy);
  await render({ initialTab: "settings" });
  expect(mock.request.mock.calls.some(([input]) => input.op === "profile.update")).toBe(false);
  // Save is disabled until the draft changes; this toggle leaves the policy fields under test intact.
  await click("Allow profanity");
  await click("Save profile settings");
  const [input, environment] = mock.request.mock.calls.find(
    ([input]) => input.op === "profile.update",
  )!;
  expect(environment).toBe("room-fixture");
  expect(input.expectedVersion).toBe(3);
  expect(input.patch).toMatchObject({
    ...policy,
    name: "Arif",
    quietStart: 22,
    quietEnd: 8,
    dailyTokenBudget: 200000,
    perWakeTokenCap: 8000,
  });
  for (const key of ["enabled", "setupComplete", "voiceSetupComplete", "version", "updatedAt"])
    expect(input.patch).not.toHaveProperty(key);
  AssistantRequestSchema.parse(input);
});
it("saves edited overnight hours to the bound Host and shows that exact range after reopening", async () => {
  mock.snapshot!.profile.activeStart = 0;
  mock.snapshot!.profile.activeEnd = 0;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input, environment) => {
    if (input.op !== "profile.update") return base(input, environment);
    AssistantRequestSchema.parse(input);
    expect(environment).toBe("room-fixture");
    mock.snapshot!.profile = {
      ...mock.snapshot!.profile,
      ...input.patch,
      version: input.expectedVersion + 1,
    };
    return { profile: mock.snapshot!.profile };
  });
  await render({ initialTab: "settings" });
  await click("Work hours");
  for (const [label, hour] of [
    ["Work hours start: 09:00", "22:00"],
    ["Work hours end: 17:00", "06:00"],
  ]) {
    await click(label);
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (element) => element.textContent === hour,
    )!;
    expect(option).toBeTruthy();
    await act(async () => option.click());
  }
  expect(mock.request.mock.calls.some(([input]) => input.op === "profile.update")).toBe(false);
  await click("Save profile settings");
  expect(mock.snapshot!.profile).toMatchObject({ activeStart: 22, activeEnd: 6, version: 4 });
  expect(document.querySelector('button[aria-label="Work hours start: 22:00"]')).toBeTruthy();
  expect(document.querySelector('button[aria-label="Work hours end: 06:00"]')).toBeTruthy();
  expect(mock.request.mock.calls.filter(([input]) => input.op === "profile.update")).toHaveLength(
    1,
  );
});
it("reviews a project-scoped automation with an explicit model, then opens only its actual original Host row", async () => {
  const text = "Schedule the morning summary";
  localStorage.setItem("bycoda.assistant.job-draft", text);
  mock.snapshot!.capabilities.quickAutomations = true;
  mock.snapshot!.capabilities.jobs = false;
  const base = mock.request.getMockImplementation()!,
    open = vi.fn();
  mock.request.mockImplementation(async (input) => {
    if (input.op === "jobs.create") {
      AssistantRequestSchema.parse(input);
      expect(input).not.toHaveProperty("projectId");
      const accepted = {
        ...job(),
        ...input,
        kind: "quick",
        projectId: "project-one",
        projectIds: ["project-one"],
        goalId: undefined,
        status: "done",
        taskIds: [],
        sessionIds: [],
        quickResult: { automationId: "actual-automation" },
      };
      mock.snapshot!.jobs = [accepted as any];
      return { job: accepted };
    }
    return base(input);
  });
  await render({ onOpenAutomation: open });
  await click("Review jobs");
  await click("Job type: Project work");
  await click("Create scheduled automation");
  expect(document.body.textContent).toContain("It does not run it now");
  const create = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Create automations",
    )!;
  // Automatic routing is valid before explicitly selecting a model.
  expect(create().disabled).toBe(false);
  await click("Choose a fixture model");
  expect(create().disabled).toBe(false);
  await click("Create automations");
  const input = mock.request.mock.calls.find(([input]) => input.op === "jobs.create")!;
  expect(input[1]).toBe("room-fixture");
  expect(input[0]).toMatchObject({
    kind: "quick",
    quickAction: {
      kind: "automation",
      projectId: "project-one",
      harness: "claude",
      model: "fixture-catalog-model",
      maxRunMinutes: 30,
      maxRunsPerDay: 1,
      enabled: false,
    },
  });
  await click("Jobs");
  await click(text);
  expect(document.body.textContent).toContain("Automation created");
  await click("Open automation");
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("unavailable on its original computer");
  mock.automations = [{ id: "actual-automation", projectId: "project-one" }];
  await click("Open automation");
  expect(open).toHaveBeenCalledWith({
    id: "actual-automation",
    projectId: "project-one",
    environmentId: "room-fixture",
  });
  expect(document.body.textContent).not.toContain("Job details");
});

it.each(["failed", "old-Host"] as const)(
  "keeps the initiating automation details when navigation is %s",
  async (outcome) => {
    const quick = {
      ...job(),
      kind: "quick",
      goalId: undefined,
      projectIds: ["project-one"],
      status: "done",
      taskIds: [],
      sessionIds: [],
      quickAction: { kind: "automation", projectId: "project-one" },
      quickResult: { automationId: "actual-automation" },
    };
    mock.snapshot!.jobs = [quick] as any;
    mock.automations = [{ id: "actual-automation", projectId: "project-one" }];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const open = vi.fn(async () => {
      await held;
      if (outcome === "failed") throw new Error("Navigation unavailable");
    });
    await render({ onOpenAutomation: open });
    await click("Jobs");
    await click(quick.title);
    await click("Open automation");
    expect(open).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Job details");
    if (outcome === "old-Host") {
      mock.environmentId = "replacement";
      await render({ onOpenAutomation: open });
    }
    await act(async () => finish());
    expect(document.body.textContent).toContain("Job details");
    if (outcome === "failed") expect(document.body.textContent).toContain("Navigation unavailable");
  },
);
it("keeps the settings source across profile-to-retention awaits while emergency stop independently uses the displayed Host", async () => {
  let acknowledge!: (value: any) => void;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input, environment) => {
    if (input.op === "profile.update")
      return new Promise((resolve) => {
        acknowledge = resolve;
      });
    if (input.op === "conversations.retention") return { ok: true };
    return base(input, environment);
  });
  await render({ initialTab: "settings" });
  await click("Keep conversation messages: Forever");
  await click("30 days");
  await click("Save profile settings");
  mock.environmentId = "replacement";
  await render({ initialTab: "settings" });
  await click("Stop everything");
  expect(mock.request.mock.calls.find(([input]) => input.op === "pauseAll")?.[1]).toBe(
    "replacement",
  );
  await act(async () => acknowledge({ profile: { ...mock.snapshot!.profile, version: 4 } }));
  expect(
    mock.request.mock.calls.find(([input]) => input.op === "conversations.retention")?.[1],
  ).toBe("room-fixture");
});
it("parks a legacy attempted job review without a captured Host and preserves its original request", async () => {
  const text = "Retained job";
  localStorage.setItem("bycoda.assistant.job-draft", text);
  localStorage.setItem(
    "bycoda.assistant.job-review",
    JSON.stringify({
      source: text,
      frozen: true,
      rows: [
        {
          id: "row",
          key: "stable-key",
          title: text,
          request: text,
          projectId: "project-one",
          projectIds: ["project-one"],
        },
      ],
    }),
  );
  await render();
  await click("Review jobs");
  await click("Check and retry");
  expect(document.body.textContent).toContain("original Host could not be verified");
  expect(mock.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(false);
  expect(JSON.parse(localStorage.getItem("bycoda.assistant.job-review")!).rows[0].key).toBe(
    "stable-key",
  );
});
it.each(["original-Host", undefined])(
  "retains a stored uncertain text turn on its original Host and session, including missing-source legacy intents: %s",
  async (origin) => {
    const thread = {
      id: "thread-one",
      projectId: "project-one",
      summary: "",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    mock.snapshot!.threads = [thread];
    mock.environmentId = "replacement";
    localStorage.setItem(
      "bycoda.assistant.thread-drafts",
      JSON.stringify({ [thread.id]: "Original unsent text" }),
    );
    localStorage.setItem(
      "bycoda.assistant.send-intents",
      JSON.stringify({
        [thread.id]: {
          text: "Original unsent text",
          key: "retained-key",
          environmentId: origin,
          sessionId: "original-session",
        },
      }),
    );
    const base = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (input, environment) => {
      if (input.op === "threads.send") {
        expect(environment).toBe("original-Host");
        throw new Error("Original Host changed");
      }
      return base(input, environment);
    });
    await render({ initialTab: "conversations", sessionId: "replacement-session" });
    await click("Send");
    const sends = mock.request.mock.calls.filter(([input]) => input.op === "threads.send");
    // A retained identity is uncertain evidence, not permission to replay on
    // either the replacement Host or its original Host.
    expect(sends).toHaveLength(0);
    expect(container.textContent).toContain("The reply has not been confirmed");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Original unsent text",
    );
    expect(JSON.parse(localStorage.getItem("bycoda.assistant.send-intents")!)[thread.id]).toEqual({
      text: "Original unsent text",
      key: "retained-key",
      ...(origin ? { environmentId: origin } : {}),
      sessionId: "original-session",
    });
  },
);

it("retains a new note identity and body across a lost acknowledgement, cancel/reopen and exact read recovery", async () => {
  localStorage.setItem("bycoda.assistant.note-draft:new:title", "Retained owner note");
  localStorage.setItem("bycoda.assistant.note-draft:new:body", "Exact unsent owner body");
  const base = mock.request.getMockImplementation()!;
  let committed: any;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "notes.save") {
      AssistantRequestSchema.parse(input);
      committed = {
        id: input.id,
        title: input.title,
        body: input.body,
        tags: ["assistant"],
        updatedAt: 77,
        createdAt: 77,
      };
      throw new Error("Reply lost after native commit");
    }
    if (input.op === "notes.get") return { note: committed };
    return base(input);
  });
  await render({ initialTab: "notes" });
  await click("New note");
  await click("Save");
  const writes = mock.request.mock.calls.filter(([input]) => input.op === "notes.save");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toMatchObject({
    expectedUpdatedAt: 0,
    title: "Retained owner note",
    body: "Exact unsent owner body",
  });
  expect(writes[0][0].id).toBeTruthy();
  expect(document.body.textContent).toContain("Reply lost after native commit");
  await click("Source");
  expect(
    document.querySelector("[data-note-editor] .cm-content")?.getAttribute("contenteditable"),
  ).toBe("false");
  await click("Close");
  await click("New note");
  expect(document.querySelector("[data-note-editor] .cm-content")?.textContent).toBe(
    "Exact unsent owner body",
  );
  await click("Save");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "notes.save")).toHaveLength(1);
  expect(mock.request).toHaveBeenCalledWith(
    { op: "notes.get", id: writes[0][0].id },
    "room-fixture",
  );
  expect(document.querySelector('section[aria-label="New note"]')).toBeNull();
  expect(localStorage.getItem("bycoda.assistant.note-draft:new:record")).toBeNull();
});

it("keeps the uncertain note draft when exact lookup is missing and never recreates a possibly owner-deleted note", async () => {
  localStorage.setItem("bycoda.assistant.note-draft:new:title", "Uncertain note");
  localStorage.setItem("bycoda.assistant.note-draft:new:body", "Keep this exact draft");
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) => {
    if (input.op === "notes.save") throw new Error("Unknown delivery");
    if (input.op === "notes.get") return { note: null };
    return base(input);
  });
  await render({ initialTab: "notes" });
  await click("New note");
  await click("Save");
  await click("Close");
  await click("New note");
  await click("Save");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "notes.save")).toHaveLength(1);
  expect(document.body.textContent).toContain("note is no longer available");
  expect(document.querySelector("[data-note-editor] .cm-content")?.textContent).toBe(
    "Keep this exact draft",
  );
  expect(localStorage.getItem("bycoda.assistant.note-draft:new:record")).toContain(
    "Keep this exact draft",
  );
});

it("marks the owner returned and prepares the current daily briefing without starting voice", async () => {
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input) =>
    input.op === "snapshot" ? { snapshot: mock.snapshot } : base(input),
  );
  await render();
  await click("Presence");
  await click("I'm back");
  const ops = mock.request.mock.calls.map(([input]) => input.op);
  expect(ops.indexOf("presence.set")).toBeLessThan(ops.indexOf("briefing.daily"));
  expect(mock.request).toHaveBeenCalledWith(
    { op: "presence.set", state: "present" },
    "room-fixture",
  );
  expect(mock.request.mock.calls.find(([input]) => input.op === "briefing.daily")?.[0].day).toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  expect(container.textContent).toContain("Nothing new to report.");
});

it("offers the unconfigured setup budget without saving and saves rules before enabling", async () => {
  mock.snapshot!.profile.setupComplete = false;
  localStorage.setItem(
    "bycoda.assistant.setup-draft",
    JSON.stringify({
      step: 9,
      patch: { ...mock.snapshot!.profile, dailyTokenBudget: 0 },
      rules: "Keep replies concise",
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(AssistantSetup, { onClose: mock.close })));
  const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Start",
  )!;
  expect(start.disabled).toBe(false);
  expect(document.body.textContent).toContain((1_000_000).toLocaleString());
  expect(mock.request.mock.calls.some(([input]) => input.op === "profile.update")).toBe(false);
  await act(async () => root!.unmount());
  root = undefined;
  container.remove();
  localStorage.setItem(
    "bycoda.assistant.setup-draft",
    JSON.stringify({
      step: 9,
      patch: { ...mock.snapshot!.profile, dailyTokenBudget: 300000 },
      rules: "Keep replies concise",
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(AssistantSetup, { onClose: mock.close })));
  await click("Start");
  const ops = mock.request.mock.calls.map(([input]) => input.op);
  expect(ops.indexOf("memory.save")).toBeLessThan(ops.indexOf("profile.update"));
  expect(mock.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      expectedVersion: 3,
      patch: expect.objectContaining({ setupComplete: true, dailyTokenBudget: 300000 }),
    }),
    "room-fixture",
  );
  await click("Done"); // The optional "Ready for 24/7" checklist follows a successful Start.
  expect(mock.close).toHaveBeenCalledOnce();
});
it("saves project priority through its captured Host and preserves exact uncertain replans", async () => {
  const original = job();
  mock.snapshot!.jobs = [original];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input, env) =>
    input.op === "jobs.priority"
      ? { job: { ...original, version: 8, priority: input.priority } }
      : input.op === "jobs.replan"
        ? Promise.reject(new Error("Replan reply lost"))
        : input.op === "jobs.get"
          ? { job: original }
          : base(input, env),
  );
  localStorage.setItem(
    "bycoda.assistant.job-edit:room-fixture:job-one:priority",
    JSON.stringify({ feedback: "", priority: "high" }),
  );
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Priority");
  await click("Save");
  expect(mock.request).toHaveBeenCalledWith(
    { op: "jobs.priority", id: original.id, expectedVersion: 7, priority: "high" },
    "room-fixture",
  );
  localStorage.setItem(
    "bycoda.assistant.job-edit:room-fixture:job-one:replan",
    JSON.stringify({ feedback: "Keep the login fix; revise only validation.", priority: "normal" }),
  );
  await click("Job actions");
  await click("Replan");
  await click("Replan");
  expect(document.body.textContent).toContain("Replan reply lost");
  const frozen = JSON.parse(
    localStorage.getItem("bycoda.assistant.job-edit:room-fixture:job-one:replan")!,
  );
  expect(frozen.intent).toEqual({
    op: "jobs.replan",
    id: original.id,
    expectedVersion: 7,
    feedback: "Keep the login fix; revise only validation.",
  });
  await click("Close");
  await click("Job actions");
  await click("Replan");
  expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value).toBe(
    frozen.feedback,
  );
  await click("Check status");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.replan")).toHaveLength(1);
  expect(mock.request).toHaveBeenCalledWith({ op: "jobs.get", id: original.id }, "room-fixture");
  expect(document.body.textContent).toContain("Review the epic before starting another replan");
  mock.environmentId = "other-host";
  await render({ initialTab: "jobs" });
  expect(document.body.textContent).not.toContain(frozen.feedback);
  expect(localStorage.getItem("bycoda.assistant.job-edit:room-fixture:job-one:replan")).toContain(
    frozen.feedback,
  );
});

it("keeps replan input editable and blocks dispatch while local storage is unavailable", async () => {
  mock.snapshot!.jobs = [job()];
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Replan");
  const originalSet = localStorage.setItem.bind(localStorage);
  const denied = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key.includes("job-edit:")) throw new Error("quota");
    originalSet(key, value);
  });
  const textarea =
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Replan feedback"]') ??
    document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "Keep this feedback",
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(textarea.value).toBe("Keep this feedback");
  expect(document.body.textContent).toContain("Could not save this draft");
  await click("Replan");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.replan")).toHaveLength(0);
  await click("Close");
  await click("Job actions");
  await click("Replan");
  expect(document.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")?.value).toBe(
    "Keep this feedback",
  );
  denied.mockRestore();
  await click("Retry saving");
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.job-edit:room-fixture:job-one:replan")!)
      .feedback,
  ).toBe("Keep this feedback");
});

it("keeps priority selection and blocks dispatch until its intent can be saved", async () => {
  mock.snapshot!.jobs = [job()];
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Priority");
  const originalSet = localStorage.setItem.bind(localStorage);
  const denied = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key.includes("job-edit:")) throw new Error("quota");
    originalSet(key, value);
  });
  await click("Priority: Normal");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === "High",
  )!;
  expect(option).toBeTruthy();
  await act(async () => option.click());
  expect(document.querySelector('[aria-label="Priority: High"]')).toBeTruthy();
  expect(document.body.textContent).toContain("Could not save this draft");
  await click("Save");
  expect(mock.request.mock.calls.filter(([input]) => input.op === "jobs.priority")).toHaveLength(0);
  await click("Close");
  await click("Job actions");
  await click("Priority");
  expect(document.querySelector('[aria-label="Priority: High"]')).toBeTruthy();
  denied.mockRestore();
  await click("Retry saving");
  expect(
    JSON.parse(localStorage.getItem("bycoda.assistant.job-edit:room-fixture:job-one:priority")!)
      .priority,
  ).toBe("high");
});
it("opens project goal and task links through the canonical job source and excludes quick actions", async () => {
  const original = job();
  mock.snapshot!.jobs = [original];
  const review = vi.fn(async () => {});
  await render({ initialTab: "jobs", onReviewJobTasks: review });
  await click(original.title);
  await click(original.goalId);
  await click(original.taskIds[0]);
  expect(review).toHaveBeenCalledTimes(2);
  expect(review).toHaveBeenLastCalledWith({
    jobId: original.id,
    goalId: original.goalId,
    projectId: original.projectId,
    projectIds: [original.projectId],
    environmentId: "room-fixture",
  });
  await click("Close");
  mock.snapshot!.jobs = [
    {
      ...original,
      kind: "quick",
      projectId: null,
      projectIds: [],
      goalId: undefined,
      taskIds: [],
      sessionIds: [],
      quickAction: { kind: "note", title: "Note", body: "Body" },
    } as any,
  ];
  await render({ initialTab: "jobs" });
  await click("Job actions");
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Priority");
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Replan");
});
it("shows the cached daily summary with its timestamp and suppresses hidden contributors", async () => {
  const current = mock.snapshot!,
    base = mock.request.getMockImplementation()!;
  const summarized = {
    ...current,
    briefing: {
      id: "today-brief",
      text: "Exact canonical daily summary",
      createdAt: 1234567,
      projectIds: ["project-one"],
    },
  };
  mock.snapshot!.briefing = {
    id: "global-decoy",
    text: "Yesterday or another return briefing must not appear",
    createdAt: 1234,
    projectIds: ["project-one"],
  };
  mock.request.mockImplementation(async (input, env) =>
    input.op === "briefing.daily"
      ? { ok: true, snapshot: summarized }
      : input.op === "snapshot"
        ? { snapshot: mock.snapshot }
        : base(input, env),
  );
  await render({ initialTab: "notes" });
  expect(mock.request.mock.calls.some(([input]) => input.op === "briefing.daily")).toBe(false);
  await click("Summarize today");
  const call = mock.request.mock.calls.find(([input]) => input.op === "briefing.daily")!;
  expect(call[1]).toBe("room-fixture");
  expect(call[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(document.body.textContent).toContain("Exact canonical daily summary");
  expect(document.body.textContent).not.toContain(
    "Yesterday or another return briefing must not appear",
  );
  expect(mock.request.mock.calls.some(([input]) => input.op === "snapshot")).toBe(false);
  expect(document.body.textContent).toContain("Saved daily summary");
  expect(document.body.textContent).toContain("Today's summary is reused");
  expect(mock.request.mock.calls.some(([input]) => input.op === "notes.save")).toBe(false);
  await render({ initialTab: "notes", visibleProjectPaths: [] });
  expect(document.body.textContent).not.toContain("Exact canonical daily summary");
});
it("shows only measured worker cache counters and percentage coverage", async () => {
  mock.snapshot!.usage.cacheUsage = {
    scope: "worker-turns",
    measuredTurns: 2,
    totalTurns: 4,
    percentageTurns: 1,
    cacheReadTokens: 120,
    cacheHitPercent: 25,
    complete: false,
  };
  await render({ initialTab: "settings" });
  expect(document.body.textContent).toContain("Some usage is unavailable.");
  expect(document.body.textContent).toContain("Cache read tokens: 120");
  expect(document.body.textContent).toContain("Mean reported cache hit: 25%");
  await click("About usage");
  expect(document.body.textContent).toContain("Partial cache usage");
  expect(document.body.textContent).toContain("Cache write tokens: Unavailable");
  expect(document.body.textContent).toContain("2 of 4 worker turns measured");
  expect(document.body.textContent).toContain("Average of 1 provider-reported worker percentages");
});
it("filters Jobs by visible project and creation date without changing the canonical collection", async () => {
  const now = Date.now();
  mock.snapshot!.jobs = [
    { ...job("recent"), title: "Recent first project", createdAt: now },
    { ...job("old"), title: "Older first project", createdAt: now - 10 * 86400000 },
    { ...job("second"), title: "Second project", projectId: "project-two", createdAt: now },
  ];
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input, env) =>
    input.op === "projects.list"
      ? {
          projects: [
            { id: "project-one", path: "/one", name: "One" },
            { id: "project-two", path: "/two", name: "Two" },
          ],
        }
      : base(input, env),
  );
  await render({ initialTab: "jobs", visibleProjectPaths: ["/one", "/two"] });
  await click("Filter");
  await click("Created: All dates");
  const today = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (e) => e.textContent?.trim() === "Today",
  )!;
  expect(today).toBeDefined();
  await act(async () => today.click());
  expect(container.textContent).not.toContain("Older first project");
  expect(container.textContent).toContain("Recent first project");
  await click("Project: All projects");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (e) => e.textContent?.trim() === "Two",
  )!;
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(container.textContent).not.toContain("Recent first project");
  expect(container.textContent).toContain("Second project");
  expect(mock.snapshot!.jobs).toHaveLength(3);
  await render({ initialTab: "jobs", visibleProjectPaths: ["/one"] });
  expect(document.body.textContent).not.toContain("Second project");
  expect(document.body.textContent).not.toContain("Two");
});
it("keeps a daily summary request bound to its source after a Host change", async () => {
  let finish!: (value: any) => void;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input, env) =>
    input.op === "briefing.daily" ? new Promise((resolve) => (finish = resolve)) : base(input, env),
  );
  await render({ initialTab: "notes" });
  await click("Summarize today");
  mock.environmentId = "replacement-host";
  await render({ initialTab: "notes" });
  await act(async () =>
    finish({
      ok: true,
      snapshot: {
        ...mock.snapshot,
        briefing: {
          id: "late-daily",
          text: "Old Host daily summary",
          createdAt: 1,
          projectIds: [],
        },
      },
    }),
  );
  expect(
    mock.request.mock.calls
      .filter(([input]) => input.op === "snapshot")
      .every(([, env]) => env === "room-fixture"),
  ).toBe(true);
  expect(document.body.textContent).not.toContain("Saved daily summary");
});
it("does not let a late closed priority dialog erase a newer retained replan draft", async () => {
  const original = job();
  mock.snapshot!.jobs = [original];
  let settle!: (value: any) => void;
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((input, env) =>
    input.op === "jobs.priority" ? new Promise((resolve) => (settle = resolve)) : base(input, env),
  );
  localStorage.setItem(
    "bycoda.assistant.job-edit:room-fixture:job-one:priority",
    JSON.stringify({ feedback: "", priority: "high" }),
  );
  localStorage.setItem(
    "bycoda.assistant.job-edit:room-fixture:job-one:replan",
    JSON.stringify({ feedback: "Keep this newer replan draft", priority: "normal" }),
  );
  await render({ initialTab: "jobs" });
  await click("Job actions");
  await click("Priority");
  await click("Save");
  const dismiss = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close"]',
  )!;
  expect(dismiss).toBeDefined();
  await act(async () => dismiss.click());
  await click("Job actions");
  await click("Replan");
  await act(async () => settle({ job: { ...original, priority: "high", version: 8 } }));
  expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value).toBe(
    "Keep this newer replan draft",
  );
  expect(localStorage.getItem("bycoda.assistant.job-edit:room-fixture:job-one:priority")).toContain(
    '"intent"',
  );
});
it("does not fall back to a mutable global briefing when the daily receipt is missing", async () => {
  mock.snapshot!.briefing = {
    id: "other-return",
    text: "Wrong global briefing",
    createdAt: 1,
    projectIds: [],
  };
  await render({ initialTab: "notes" });
  await click("Summarize today");
  expect(document.body.textContent).toContain("Daily summary was not confirmed");
  expect(document.body.textContent).not.toContain("Wrong global briefing");
  expect(mock.request.mock.calls.some(([input]) => input.op === "snapshot")).toBe(false);
});
it("pages timestamp siblings using the exact oldest loaded message identity", async () => {
  const thread = {
    id: "ties-thread",
    projectId: "project-one",
    summary: "",
    version: 1,
    createdAt: 0,
    updatedAt: 500,
  };
  mock.snapshot!.threads = [thread];
  const message = (n: number) => ({
    id: `canonical-${n}`,
    threadId: thread.id,
    projectIds: ["project-one"],
    role: "user" as const,
    via: "text" as const,
    text: `Timestamp sibling ${n}`,
    jobIds: [],
    version: 1,
    createdAt: 500,
    updatedAt: 500,
  });
  const base = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (input, env) => {
    if (input.op !== "threads.messages") return base(input, env);
    if (input.beforeId === undefined)
      return { messages: Array.from({ length: 100 }, (_, i) => message(i + 100)) };
    expect(input).toEqual({
      op: "threads.messages",
      threadId: thread.id,
      limit: 100,
      before: 500,
      beforeId: "canonical-100",
    });
    expect(env).toBe("room-fixture");
    return { messages: Array.from({ length: 100 }, (_, i) => message(i)) };
  });
  await render({ initialTab: "conversations" });
  expect(container.querySelectorAll("article")).toHaveLength(100);
  await click("Load earlier messages");
  expect(container.querySelectorAll("article")).toHaveLength(200);
  expect(container.textContent).toContain("Timestamp sibling 0");
  expect(container.textContent).toContain("Timestamp sibling 199");
  const texts = [...container.querySelectorAll("article")].map((row) => row.textContent);
  expect(new Set(texts).size).toBe(200);
});
it("keeps loaded history after a cursor error and retries the same canonical zero-timestamp cursor", async () => {
  const thread = {
    id: "cursor-thread",
    projectId: "project-one",
    summary: "",
    version: 1,
    createdAt: 0,
    updatedAt: 1,
  };
  mock.snapshot!.threads = [thread];
  const loaded = Array.from({ length: 100 }, (_, n) => ({
    id: `saved-${n}`,
    threadId: thread.id,
    projectIds: ["project-one"],
    role: "user" as const,
    via: "text" as const,
    text: `Retained history ${n}`,
    jobIds: [],
    version: 1,
    createdAt: n === 0 ? 0 : 1,
    updatedAt: 1,
  }));
  const base = mock.request.getMockImplementation()!;
  let olderCalls = 0;
  mock.request.mockImplementation(async (input, env) => {
    if (input.op !== "threads.messages") return base(input, env);
    if (!("beforeId" in input)) return { messages: loaded };
    olderCalls++;
    expect(input).toEqual({
      op: "threads.messages",
      threadId: thread.id,
      limit: 100,
      before: 0,
      beforeId: "saved-0",
    });
    if (olderCalls === 1) throw new Error("The history cursor changed. Check the conversation.");
    return { messages: [] };
  });
  await render({ initialTab: "conversations" });
  await click("Load earlier messages");
  expect(container.querySelectorAll("article")).toHaveLength(100);
  expect(container.textContent).toContain("Retained history 0");
  expect(container.textContent).toContain("history cursor changed");
  await click("Load earlier messages");
  expect(olderCalls).toBe(2);
  expect(container.querySelectorAll("article")).toHaveLength(100);
  expect(container.textContent).toContain("Retained history 99");
});

it("shows the default portrait, a chosen avatar or the name initial in the header and a labelled Stop control that resumes when paused", async () => {
  await render();
  const avatar = container.querySelector<HTMLElement>("header [data-initial]")!;
  expect(avatar.getAttribute("data-initial")).toBe("A");
  expect(avatar.textContent).toBe("");
  const portrait = avatar.querySelector("img")!;
  expect(portrait.getAttribute("src")).toBe("/assistant/avatars/orb.webp");
  // A portrait that cannot load leaves the box empty so the initial is drawn instead.
  await act(async () => portrait.dispatchEvent(new Event("error")));
  expect(container.querySelector("header [data-initial] img")).toBeNull();
  const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop everything"]')!;
  expect(stop.textContent?.trim()).toBe("Stop");
  mock.snapshot!.profile.avatar = "🦊";
  mock.snapshot!.paused = true;
  await render();
  expect(container.querySelector("header [data-initial]")!.textContent).toBe("🦊");
  const resume = container.querySelector<HTMLButtonElement>('button[aria-label="Resume work"]')!;
  expect(resume.textContent?.trim()).toBe("Resume");
});
