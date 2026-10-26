// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Inbox } from "./SocialInbox";
import type { SocialClient } from "../model/socialClient";
import type { SocialAccount, SocialSnapshot, SocialThread } from "../model/social";
import type { Props } from "./socialShared";
import { RetainedSocialPanel } from "./RetainedSocialPanel";
import type { HostProject } from "../../connections/model/protocol";

let container: HTMLDivElement, root: Root;
const request = vi.fn();
const runResults: boolean[] = [];
const account = (id: string, overrides: Partial<SocialAccount> = {}): SocialAccount => ({
  id,
  platform: "x",
  platformId: id,
  name: id,
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: { project: ["draft", "read", "reply"] },
  createdAt: 1,
  ...overrides,
});
const thread = (id: string, kind: "message" | "comment", accountId = "account"): SocialThread => ({
  id,
  accountId,
  contactId: id,
  platformThreadId: id,
  kind,
  projectId: "project",
  lastInboundAt: 1,
  events: [{ id: id + "-event", text: "Hello", at: 1, direction: "inbound", platformId: id }],
});
function snapshot(overrides: Partial<SocialSnapshot> = {}): SocialSnapshot {
  return {
    executorId: "host",
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    accounts: [account("account")],
    campaigns: [],
    contacts: ["message", "comment"].map((id) => ({
      id,
      accountId: "account",
      platformId: id,
      name: id,
      source: "api",
      projectIds: ["project"],
      tags: [],
      replyEligible: true,
      commentEligible: true,
      optedOut: false,
      history: [],
    })),
    threads: [thread("message", "message"), thread("comment", "comment")],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: {
      account: [
        { operation: "poll", status: "available", reason: "", scopes: [], source: "api" },
        { operation: "reply", status: "available", reason: "", scopes: [], source: "api" },
        { operation: "message.reply", status: "available", reason: "", scopes: [], source: "api" },
      ],
    },
    ...overrides,
  };
}
async function startSelecting() {
  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Select",
  )!;
  await act(async () => toggle.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  runResults.length = 0;
  request.mockImplementation(async (action: string) =>
    action === "policy.get" ? { effective: {} } : {},
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(value: SocialSnapshot) {
  await act(async () =>
    root.render(
      createElement(Inbox, {
        client: { request } as unknown as SocialClient,
        snapshot: value,
        projects: [{ id: "project", name: "Project", cwd: "C:/project" }] as HostProject[],
        run: async (action) => {
          try {
            await action();
            runResults.push(true);
            return true;
          } catch {
            runResults.push(false);
            return false;
          }
        },
      }),
    ),
  );
}
it("shows local assignment progress, prevents repeated selection and recovers after failure", async () => {
  let rejectAssignment!: (reason: Error) => void;
  request.mockImplementation((action: string) =>
    action === "thread.assign"
      ? new Promise((_, reject) => {
          rejectAssignment = reject;
        })
      : Promise.resolve({}),
  );
  await mount(snapshot({ threads: [{ ...thread("message", "message"), projectId: undefined }] }));
  const projectField = Array.from(container.querySelectorAll("label")).find((label) =>
    label.textContent?.includes("Related project"),
  )!;
  const trigger = projectField.querySelector<HTMLButtonElement>("button")!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === "Project",
  )!;
  await act(async () => option.click());
  expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(trigger.disabled).toBe(true);
  await act(async () => trigger.click());
  expect(request.mock.calls.filter(([action]) => action === "thread.assign")).toHaveLength(1);
  await act(async () => rejectAssignment(new Error("Unavailable")));
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(trigger.disabled).toBe(false);
  expect(runResults).toEqual([false]);
  await act(async () => trigger.click());
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
});

it("searches the host dataset after typing, keeps truncated matches and cancels hidden searches", async () => {
  vi.useFakeTimers();
  const onFilterChange = vi.fn<NonNullable<Props["onFilterChange"]>>();
  const value = snapshot({
    threads: [
      {
        ...thread("message", "message"),
        eventsPreview: true,
        events: [{ ...thread("message", "message").events[0], text: "x".repeat(300) }],
        eventsPage: { offset: 0, limit: 1, total: 1 },
      },
    ],
    pages: { threads: { offset: 0, limit: 50, total: 125 } },
  });
  const render = (active: boolean) =>
    root.render(
      createElement(RetainedSocialPanel, {
        active,
        busy: false,
        error: "",
        notice: "",
        children: createElement(Inbox, {
          client: { request } as unknown as SocialClient,
          snapshot: value,
          projects: [],
          run: async (work) => {
            await work();
            return true;
          },
          onFilterChange,
        }),
      }),
    );
  try {
    await act(async () => render(true));
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = async (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("Archived");
    await type("Archived needle");
    await act(async () => vi.advanceTimersByTime(200));
    expect(onFilterChange).toHaveBeenCalledExactlyOnceWith("threads", {
      query: "Archived needle",
      accountId: "",
      kind: "",
    });
    value.filters = { threads: { query: "Archived needle" } };
    await act(async () => render(true));
    expect(container.querySelectorAll(".social-row")).toHaveLength(1);
    expect(container.querySelector(".social-row")?.textContent).not.toContain("Archived needle");
    await type("Pending hidden search");
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    await act(async () => render(true));
    expect(input.value).toBe("Pending hidden search");
    await act(async () => vi.advanceTimersByTime(200));
    expect(onFilterChange).toHaveBeenLastCalledWith("threads", {
      query: "Pending hidden search",
      accountId: "",
      kind: "",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("loads selected history pages and discards a previous thread's delayed detail", async () => {
  const value = snapshot();
  value.threads = value.threads.map((item) => ({
    ...item,
    eventsPreview: true,
    eventsPage: { offset: 99, limit: 1, total: 100 },
    events: [{ ...item.events[0], text: "List preview" }],
  }));
  let finish!: (value: SocialThread) => void;
  request.mockImplementation(async (action: string, input: { id: string; offset?: number }) => {
    if (action === "policy.get") return { effective: {} };
    if (action !== "thread.page") return {};
    if (input.id === "message")
      return new Promise<SocialThread>((resolve) => {
        finish = resolve;
      });
    return {
      ...thread("comment", "comment"),
      events: [{ ...thread("comment", "comment").events[0], text: "Complete selected message" }],
      eventsPage: { offset: input.offset ?? 80, limit: 20, total: 100 },
      eventsPreview: false,
    };
  });
  await mount(value);
  expect(container.textContent).toContain("Loading conversation history");
  const row = Array.from(container.querySelectorAll<HTMLButtonElement>(".social-row")).find(
    (item) => item.textContent?.includes("comment"),
  )!;
  await act(async () => row.click());
  expect(container.textContent).toContain("Complete selected message");
  await act(async () =>
    finish({
      ...thread("message", "message"),
      events: [
        { ...thread("message", "message").events[0], text: "Delayed previous private message" },
      ],
    }),
  );
  expect(container.textContent).not.toContain("Delayed previous private message");
  const pager = container.querySelector('[aria-label="Conversation history pages"]')!;
  await act(async () =>
    Array.from(pager.querySelectorAll("button"))
      .find((item) => item.textContent === "Previous records")!
      .click(),
  );
  expect(request).toHaveBeenLastCalledWith("thread.page", { id: "comment", limit: 20, offset: 60 });
});
it("explains the unavailable browser capability next to the disabled refresh action", async () => {
  await mount(
    snapshot({
      threads: [],
      accounts: [account("account", { connection: "browser" })],
      capabilities: {
        account: [
          {
            operation: "poll",
            status: "pending",
            reason: "Reconnect the saved browser identity",
            scopes: [],
            source: "browser",
          },
        ],
      },
    }),
  );
  expect(container.textContent).toContain("Reconnect the saved browser identity");
  expect(container.textContent).toContain("Inbox access required");
  const refresh = Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === "Refresh conversations",
  )!;
  expect(refresh.disabled).toBe(true);
  expect(request.mock.calls.some((call) => call[0] === "inbox.sync")).toBe(false);
});
it("selects only filtered conversations and keeps the bulk target count explicit", async () => {
  await mount(snapshot());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Filters"]')!.click(),
  );
  const kind = Array.from(document.querySelectorAll("label"))
    .find((label) => label.textContent?.startsWith("Message type"))!
    .querySelector("select")!;
  await act(async () => {
    kind.value = "comment";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await startSelecting();
  const all = container.querySelector<HTMLInputElement>(
    'input[aria-label="Select all visible conversations"]',
  )!;
  await act(async () => all.click());
  expect(container.querySelector(".social-bulk-toolbar")?.textContent).toContain(
    "1 conversations selected",
  );
  expect(
    container.querySelector('input[aria-label="Select conversation with comment"]'),
  ).toBeTruthy();
  expect(
    container.querySelector('input[aria-label="Select conversation with message"]'),
  ).toBeNull();
  expect(request.mock.calls.some((call) => call[0].endsWith(".send"))).toBe(false);
});
it("shows refresh failures per account while preserving other accounts' success", async () => {
  const value = snapshot({
    accounts: [account("account"), account("second")],
    capabilities: { ...snapshot().capabilities, second: snapshot().capabilities.account },
  });
  request.mockImplementation(async (action: string, input: Record<string, unknown>) => {
    if (action === "policy.get") return { effective: {} };
    if (action === "inbox.sync" && input.accountId === "second")
      throw new Error("Connection interrupted");
    return {};
  });
  await mount(value);
  const refresh = Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === "Refresh conversations",
  )!;
  await act(async () => refresh.click());
  expect(container.textContent).toContain("Refreshed: ");
  expect(container.textContent).toContain("Connection interrupted");
  expect(request.mock.calls.filter((call) => call[0] === "inbox.sync")).toHaveLength(2);
});
it("does not report success when every inbox refresh failed", async () => {
  request.mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: {} };
    throw new Error("Disconnected");
  });
  await mount(snapshot());
  const refresh = Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === "Refresh conversations",
  )!;
  await act(async () => refresh.click());
  expect(runResults).toEqual([false]);
  expect(container.querySelector('.social-notice[data-kind="success"]')).toBeNull();
  expect(container.textContent).toContain("Disconnected");
});
it("keeps every failed draft result and text while reporting batch failure", async () => {
  request.mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: {} };
    throw new Error("Draft service disconnected");
  });
  await mount(snapshot());
  await startSelecting();
  const all = container.querySelector<HTMLInputElement>(
    'input[aria-label="Select all visible conversations"]',
  )!;
  await act(async () => all.click());
  const editor = container.querySelector<HTMLElement>(
    '.social-editor[aria-label="Prepare replies to selected conversations"]',
  )!;
  const text = editor.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      text,
      "Answer text",
    );
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    editor
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(runResults).toEqual([false]);
  expect(editor.textContent).toContain("Answer text");
  expect(editor.textContent).toContain("2 failed");
  expect(editor.querySelector('.social-notice[data-kind="success"]')).toBeNull();
  expect(editor.textContent).toContain("Retry only the 2 failed drafts");
  const firstIds = request.mock.calls
    .filter((call) => call[0] === "replies.draft")
    .map((call) => call[2]);
  const edit = Array.from(editor.querySelectorAll("button")).find(
    (button) => button.textContent === "Edit content",
  )!;
  await act(async () => edit.click());
  const amended = editor.querySelector("textarea")!;
  expect(amended.value).toBe("Answer text");
  expect(amended.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      amended,
      "Amended answer",
    );
    amended.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    editor
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const nextIds = request.mock.calls
    .filter((call) => call[0] === "replies.draft")
    .slice(2)
    .map((call) => call[2]);
  expect(nextIds).toHaveLength(2);
  expect(nextIds.some((id) => firstIds.includes(id))).toBe(false);
  expect(editor.textContent).toContain("Amended answer");
});

it("marks results from an earlier selection and prepares only the new recipients without removing completed drafts", async () => {
  let drafts = 0;
  request.mockImplementation(async (action: string, input: Record<string, unknown>) => {
    if (action === "policy.get") return { effective: {} };
    if (action === "replies.draft")
      return {
        id: `draft-${++drafts}`,
        accountId: "account",
        projectId: "project",
        kind: "reply",
        threadId: input.threadId,
        contactId: input.threadId,
        text: input.text,
        factIds: [],
        createdAt: 1,
      };
    return {};
  });
  await mount(snapshot());
  await startSelecting();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Select all visible conversations"]')!
      .click(),
  );
  const editor = container.querySelector<HTMLElement>(
    '.social-editor[aria-label="Prepare replies to selected conversations"]',
  )!;
  const text = editor.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      text,
      "Retained answer",
    );
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    editor
      .querySelector("form.social-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const initialRequests = request.mock.calls.filter((call) => call[0] === "replies.draft");
  expect(initialRequests).toHaveLength(2);
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Select conversation with comment"]')!
      .click(),
  );
  expect(editor.textContent).toContain("Recipient selection changed.");
  expect(editor.textContent).toContain("These results belong to the previous preparation.");
  const fresh = Array.from(editor.querySelectorAll("button")).find(
    (button) => button.textContent === "Prepare for the new selection",
  )!;
  await act(async () => fresh.click());
  expect(editor.querySelector("textarea")!.value).toBe("Retained answer");
  expect(editor.textContent).toContain("Previous preparation · 2 recipients · 2 drafts");
  expect(editor.querySelector("form.social-form")?.textContent).toContain(
    "1 conversation selected",
  );
  await act(async () =>
    editor
      .querySelector("form.social-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const allRequests = request.mock.calls.filter((call) => call[0] === "replies.draft");
  expect(allRequests).toHaveLength(3);
  expect(allRequests[2][1].threadId).toBe("message");
  expect(initialRequests.some((call) => call[2] === allRequests[2][2])).toBe(false);
  expect(editor.querySelectorAll(".social-preview")).toHaveLength(3);
  expect(
    request.mock.calls.some((call) => call[0] === "drafts.approve" || call[0].endsWith(".send")),
  ).toBe(false);
});
