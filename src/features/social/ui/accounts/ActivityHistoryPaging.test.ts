// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiAction } from "../../model/autonomy";
import type { SocialAccount, SocialJob, SocialWorkspaceQuery } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ActivityHistory } from "./ActivityHistory";

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
const job = (id: string, day: number): SocialJob =>
  ({
    id,
    accountId: "a1",
    kind: "publish",
    status: "succeeded",
    createdAt: Date.UTC(2026, 10, day),
    payload: { text: `Post ${id}`, media: [] },
  }) as SocialJob;
const action = (id: string, day: number): AiAction => ({
  id,
  at: Date.UTC(2026, 10, day),
  actor: "owner",
  action: "lists.addMembers",
  summary: `AI ${id}`,
  status: "done",
});

/** A Host holding `jobs` (newest first) in pages of `limit`, and AI actions in cursor pages. */
function host(jobs: SocialJob[], actionPages: { items: AiAction[]; next?: string }[]) {
  const sectionSnapshot = vi.fn(async (input: SocialWorkspaceQuery) => {
    const offset = input.offsets?.jobs ?? 0;
    const limit = input.limit ?? 50;
    return {
      snapshot: {
        jobs: jobs.slice(offset, offset + limit),
        pages: { jobs: { offset, limit, total: jobs.length } },
      },
    };
  });
  const actions = vi.fn(async (input: { cursor?: string }) => {
    const index = input.cursor === undefined ? 0 : Number(input.cursor);
    return actionPages[index] ?? { items: [] };
  });
  const client = {
    sectionSnapshot,
    ai: { actions, undo: vi.fn(async () => ({})) },
  } as unknown as SocialClient;
  return { client, sectionSnapshot, actions };
}

async function mount(client: SocialClient, projectId?: string) {
  act(() =>
    root.render(
      createElement(ActivityHistory, { client, accounts, ...(projectId ? { projectId } : {}) }),
    ),
  );
  await act(async () => undefined);
}

const button = (text: string) =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const titles = () =>
  [...element.querySelectorAll<HTMLElement>(".social-activity-row")].map(
    (row) => row.textContent ?? "",
  );
const order = () => titles().map((text) => /(Post|AI) (\w+)/.exec(text)?.[0]);

it("reaches jobs past the first page with Load more and keeps the project scope", async () => {
  const jobs = Array.from({ length: 45 }, (_, index) =>
    job(`j${index}`, 28 - Math.floor(index / 2)),
  );
  const { client, sectionSnapshot } = host(jobs, [{ items: [] }]);
  await mount(client, "p1");
  expect(titles()).toHaveLength(20);
  expect(element.textContent).toContain("More activity is available");
  await act(async () => button("Load more")?.click());
  await act(async () => button("Load more")?.click());
  expect(titles()).toHaveLength(45);
  expect(button("Load more")).toBeUndefined();
  expect(element.textContent).not.toContain("More activity is available");
  expect(sectionSnapshot.mock.calls.map(([input]) => input)).toEqual([
    { section: "history", limit: 20, projectId: "p1" },
    { section: "history", limit: 20, projectId: "p1", offsets: { jobs: 20 } },
    { section: "history", limit: 20, projectId: "p1", offsets: { jobs: 40 } },
  ]);
});

it("orders sent jobs and AI actions together by time and keeps them distinguishable", async () => {
  const { client } = host(
    [job("j1", 9), job("j2", 5), job("j3", 2)],
    [{ items: [action("x1", 8), action("x2", 3)] }],
  );
  await mount(client);
  expect(order()).toEqual(["Post j1", "AI x1", "Post j2", "AI x2", "Post j3"]);
  expect(titles()[0]).toContain("Publishing · Studio");
  expect(titles()[1]).not.toContain("Publishing");
});

it("holds back entries older than a source that still has rows, so a later page cannot land out of order", async () => {
  const jobs = Array.from({ length: 30 }, (_, index) => job(`j${index}`, 29 - index));
  // Job 19 is the oldest of the first page (day 10); the AI action from day 3 must wait for page two.
  const { client } = host(jobs, [{ items: [action("x1", 12), action("x2", 3)] }]);
  await mount(client);
  expect(order()).not.toContain("AI x2");
  expect(order()).toContain("AI x1");
  await act(async () => button("Load more")?.click());
  expect(order().indexOf("AI x2")).toBe(order().indexOf("Post j26") + 1);
  expect(order().filter((entry) => entry === "AI x2")).toHaveLength(1);
});

it("follows the AI action cursor and asks the Host only for sources that have more", async () => {
  const { client, sectionSnapshot, actions } = host(
    [job("j1", 20)],
    [{ items: [action("x1", 19)], next: "1" }, { items: [action("x2", 18)] }],
  );
  await mount(client);
  expect(order()).toEqual(["Post j1", "AI x1"]);
  await act(async () => button("Load more")?.click());
  expect(order()).toEqual(["Post j1", "AI x1", "AI x2"]);
  expect(actions.mock.calls.map(([input]) => input)).toEqual([{}, { cursor: "1" }]);
  expect(sectionSnapshot).toHaveBeenCalledTimes(1);
});

it("skips an AI action page the Host filtered to nothing instead of stalling", async () => {
  const { client, actions } = host(
    [job("j1", 20)],
    [{ items: [], next: "1" }, { items: [action("x1", 19)] }],
  );
  await mount(client);
  expect(order()).toEqual(["Post j1", "AI x1"]);
  expect(actions).toHaveBeenCalledTimes(2);
});

it("keeps loaded rows when a continuation fails and retries it", async () => {
  const jobs = Array.from({ length: 30 }, (_, index) => job(`j${index}`, 29 - index));
  const { client, sectionSnapshot } = host(jobs, [{ items: [] }]);
  await mount(client);
  const original = sectionSnapshot.getMockImplementation()!;
  sectionSnapshot.mockRejectedValueOnce(new Error("Host unreachable"));
  await act(async () => button("Load more")?.click());
  expect(titles()).toHaveLength(20);
  expect(element.textContent).toContain("The activity could not be read. Try again.");
  sectionSnapshot.mockImplementation(original);
  await act(async () => button("Retry")?.click());
  expect(titles()).toHaveLength(30);
  expect(element.textContent).not.toContain("The activity could not be read.");
});

it("drops a continuation that settles after the project changed", async () => {
  const jobs = Array.from({ length: 30 }, (_, index) => job(`old${index}`, 29 - index));
  const { client, sectionSnapshot } = host(jobs, [{ items: [] }]);
  await mount(client, "p1");
  let release: (value: unknown) => void = () => undefined;
  sectionSnapshot.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)) as never,
  );
  await act(async () => button("Load more")?.click());
  sectionSnapshot.mockImplementation(async () => ({
    snapshot: {
      jobs: [job("new1", 5)],
      pages: { jobs: { offset: 0, limit: 20, total: 1 } },
    },
  }));
  await mount(client, "p2");
  await act(async () =>
    release({
      snapshot: {
        jobs: [job("late", 1)],
        pages: { jobs: { offset: 20, limit: 20, total: 30 } },
      },
    }),
  );
  expect(order()).toEqual(["Post new1"]);
});
