// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiAction } from "../../model/autonomy";
import type { SocialAccount, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ActivityHistory } from "./ActivityHistory";

// Covers what the flat History tab tested that still exists in the Accounts activity card:
// scoped reads, safe rendering of stored text, review reasons, no resend, undo rules and recovery.
// The old status/date filters, counts and retry-this-target action have no counterpart here.

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

const accounts = [{ id: "a1", name: "Studio" }] as unknown as SocialAccount[];
const job = (patch: Partial<SocialJob>) =>
  ({
    id: "j1",
    accountId: "a1",
    kind: "publish",
    status: "succeeded",
    createdAt: Date.UTC(2026, 10, 7),
    payload: { text: "Launch day", media: [] },
    ...patch,
  }) as SocialJob;
const action = (patch: Partial<AiAction>): AiAction => ({
  id: "x1",
  at: Date.UTC(2026, 10, 7),
  actor: "owner",
  action: "lists.addMembers",
  summary: "Added people to a list",
  status: "done",
  undo: { action: "lists.removeMembers", input: {} },
  ...patch,
});

type Options = {
  jobs?: SocialJob[];
  actions?: AiAction[];
  snapshot?: () => Promise<unknown>;
  list?: () => Promise<unknown>;
  undo?: () => Promise<unknown>;
  projectId?: string;
};

function fakeClient(options: Options = {}) {
  const sectionSnapshot = vi.fn(
    options.snapshot ?? (async () => ({ snapshot: { jobs: options.jobs ?? [] } })),
  );
  const ai = {
    actions: vi.fn(options.list ?? (async () => ({ items: options.actions ?? [] }))),
    undo: vi.fn(options.undo ?? (async () => ({}))),
  };
  return { client: { sectionSnapshot, ai } as unknown as SocialClient, sectionSnapshot, ai };
}

async function mount(options: Options = {}) {
  const fake = fakeClient(options);
  act(() =>
    root.render(
      createElement(ActivityHistory, {
        client: fake.client,
        accounts,
        ...(options.projectId ? { projectId: options.projectId } : {}),
      }),
    ),
  );
  await act(async () => undefined);
  return fake;
}

const button = (text: string) =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const rows = () => [...element.querySelectorAll<HTMLElement>(".social-activity-row")];

it("reads only the selected project's history, 20 jobs at most", async () => {
  const { sectionSnapshot } = await mount({ projectId: "p1" });
  expect(sectionSnapshot).toHaveBeenCalledExactlyOnceWith({
    section: "history",
    limit: 20,
    projectId: "p1",
  });
});

it("reads every project's history when no project is selected", async () => {
  const { sectionSnapshot } = await mount();
  expect(sectionSnapshot).toHaveBeenCalledExactlyOnceWith({ section: "history", limit: 20 });
});

it("shows at most 20 jobs even when the Host sends more", async () => {
  const jobs = Array.from({ length: 25 }, (_, index) => job({ id: `j${index}` }));
  await mount({ jobs });
  expect(rows()).toHaveLength(20);
});

it("says nothing was sent only after a successful empty read", async () => {
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  act(() =>
    root.render(
      createElement(ActivityHistory, {
        client: {
          sectionSnapshot: vi.fn(() => pending),
          ai: { actions: vi.fn(async () => ({ items: [] })) },
        } as unknown as SocialClient,
        accounts,
      }),
    ),
  );
  expect(element.textContent).toContain("Loading…");
  expect(element.textContent).not.toContain("Nothing has been sent or changed yet.");
  await act(async () => release({ snapshot: { jobs: [] } }));
  expect(element.textContent).not.toContain("Loading…");
  expect(element.textContent).toContain("Nothing has been sent or changed yet.");
});

it("names a failed read instead of saying nothing was sent, and re-reads on Try again", async () => {
  const snapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error("Host unreachable"))
    .mockResolvedValueOnce({ snapshot: { jobs: [job({})] } });
  const { sectionSnapshot } = await mount({ snapshot });
  expect(element.textContent).toContain("The activity could not be read. Try again.");
  expect(element.textContent).not.toContain("Nothing has been sent or changed yet.");
  expect(rows()).toHaveLength(0);
  await act(async () => button("Try again")?.click());
  await act(async () => undefined);
  expect(sectionSnapshot).toHaveBeenCalledTimes(2);
  expect(element.textContent).not.toContain("The activity could not be read.");
  expect(rows()).toHaveLength(1);
});

it("renders stored message text as text and never as markup or a link", async () => {
  await mount({
    jobs: [
      job({
        status: "failed",
        url: "javascript:alert(1)",
        payload: { text: "<img src=x onerror=alert(1)> hello", media: [] },
      }),
    ],
  });
  await act(async () => button("Details")?.click());
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector("a")).toBeNull();
  expect(element.textContent).toContain("<img src=x onerror=alert(1)> hello");
});

it("shortens long message text to 160 characters and hides the Host error behind Technical details", async () => {
  await mount({
    jobs: [
      job({
        status: "failed",
        payload: { text: "a".repeat(300), media: [] },
        error: "Rate limited",
      }),
    ],
  });
  expect(element.textContent).not.toContain("Rate limited");
  await act(async () => button("Details")?.click());
  expect(element.textContent).toContain(`${"a".repeat(159)}…`);
  expect(element.textContent).not.toContain("a".repeat(160));
  expect(element.textContent).not.toContain("Rate limited");
  await act(async () => button("Technical details")?.click());
  expect(element.textContent).toContain("Rate limited");
});

it.each<[string | undefined, string]>([
  ["awaiting_approval", "Waiting for your approval"],
  ["retry_exhausted", "Stopped after repeated attempts"],
  ["needs_human", "Waiting for you"],
  ["unexpected_screen", "Needs review"],
  [undefined, "Needs review"],
])("explains a held job with reason %s as %s", async (reviewReason, text) => {
  await mount({ jobs: [job({ status: "review", reviewReason })] });
  expect(element.querySelector(".social-history-held-reason")?.textContent).toContain(text);
});

it("never offers to send a held, failed or uncertain job again", async () => {
  await mount({
    jobs: ["review", "failed", "queued", "cancelled"].map((status, index) =>
      job({ id: `j${index}`, status: status as SocialJob["status"], reviewReason: "needs_human" }),
    ),
    // An AI action without an inverse: the Host recorded no undo, so no Undo button is rendered.
    actions: [{ ...action({ id: "x-no-inverse", status: "failed" }), undo: undefined }],
  });
  const labels = [...element.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
  expect(labels.filter((label) => /retry|resend|send again/i.test(label))).toEqual([]);
  // Jobs never carry an Undo; the no-inverse action has none either.
  expect(labels.filter((label) => label === "Undo")).toEqual([]);
  // The reason for the missing Undo sits under Details, which is closed until the owner opens it.
  expect(element.textContent).not.toContain("This action cannot be undone.");
  const actionRow = rows()[rows().length - 1];
  const details = [...(actionRow?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === "Details",
  );
  await act(async () => details?.click());
  expect(element.textContent).toContain("This action cannot be undone.");
});

it("undoes a finished AI action once and reads the history again", async () => {
  const { ai, sectionSnapshot } = await mount({ actions: [action({})] });
  expect(button("Undo")?.disabled).toBe(false);
  await act(async () => button("Undo")?.click());
  await act(async () => undefined);
  expect(ai.undo).toHaveBeenCalledExactlyOnceWith("x1");
  expect(sectionSnapshot).toHaveBeenCalledTimes(2);
  expect(ai.actions).toHaveBeenCalledTimes(2);
});

it.each<[AiAction["status"], string]>([
  ["undone", "Already undone."],
  ["queued", "Only finished actions can be undone."],
  ["failed", "Only finished actions can be undone."],
  ["blocked", "Only finished actions can be undone."],
])("keeps Undo disabled for a %s action and says why", async (status, reason) => {
  const { ai } = await mount({ actions: [action({ status })] });
  // The shared Button keeps Undo focusable (aria-disabled) and exposes the reason as its description.
  expect(button("Undo")?.getAttribute("aria-disabled")).toBe("true");
  expect(button("Undo")?.getAttribute("aria-description")).toBe(reason);
  await act(async () => button("Undo")?.click());
  expect(ai.undo).not.toHaveBeenCalled();
});

it("shows the Host's reason when an undo is refused and does not re-read as if it worked", async () => {
  const { ai, sectionSnapshot } = await mount({
    actions: [action({})],
    undo: async () => {
      throw new Error("The list no longer exists.");
    },
  });
  await act(async () => button("Undo")?.click());
  await act(async () => undefined);
  expect(ai.undo).toHaveBeenCalledTimes(1);
  expect(element.textContent).toContain("The list no longer exists.");
  expect(sectionSnapshot).toHaveBeenCalledTimes(1);
});

it("falls back to a plain message when an undo fails without a reason", async () => {
  await mount({
    actions: [action({})],
    undo: async () => {
      throw new Error("");
    },
  });
  await act(async () => button("Undo")?.click());
  await act(async () => undefined);
  expect(element.textContent).toContain("The action could not be undone. Try again.");
});

it("shows technical action names and reasons only behind Technical details", async () => {
  await mount({ actions: [action({ status: "failed", reason: "Account paused." })] });
  expect(element.textContent).not.toContain("lists.addMembers");
  await act(async () => button("Details")?.click());
  expect(element.textContent).not.toContain("lists.addMembers");
  await act(async () => button("Technical details")?.click());
  expect(element.textContent).toContain("lists.addMembers");
  expect(element.textContent).toContain("Account paused.");
});
