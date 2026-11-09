// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem, InboxListResult, InboxQuery } from "../model/githubTasks";
import { useInboxCollection } from "./useInboxCollection";

const { listInboxItems, peekInboxList, inboxListFetchedAt } = vi.hoisted(() => ({
  listInboxItems: vi.fn(),
  peekInboxList: vi.fn(),
  inboxListFetchedAt: vi.fn(),
}));
vi.mock("../model/githubTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/githubTasks")>()),
  listInboxItems,
  peekInboxList,
  inboxListFetchedAt,
}));

type Collection = ReturnType<typeof useInboxCollection>;

function item(number: number, title: string, projectPath: string): InboxItem {
  return {
    provider: "github",
    kind: "pr",
    repo: "acme/app",
    number,
    title,
    url: `https://github.com/acme/app/pull/${number}`,
    state: "open",
    updatedAt: "2026-09-13T12:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    projectPath,
  };
}

const projectsA = [{ path: "/a" }];
const projectsB = [{ path: "/b" }];
const fetchQuery: InboxQuery = { assignedToMe: false, state: "open", search: "" };

type Scope = { projects: readonly { path: string }[]; refresh?: number };
const keyOf = (projects: readonly { path: string }[]) =>
  ["inbox", "list", projects, fetchQuery] as const;

describe("useInboxCollection scope-bound item updates", () => {
  let client: QueryClient;
  let host: HTMLElement;
  let root: Root;
  let view: Collection;
  let settled: ReturnType<typeof vi.fn>;
  let results: Map<string, () => Promise<InboxListResult>>;

  function Consumer({ projects, refresh = 0 }: Scope) {
    view = useInboxCollection({
      projects,
      fetchQuery,
      enabled: true,
      automaticRefresh: false,
      refresh,
      onRefreshSettled: settled,
    });
    return null;
  }
  const render = (scope: Scope) =>
    act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Consumer, scope)));
    });
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const update = (next: InboxItem, updateItem = view.updateItem) =>
    act(async () => updateItem(next));
  const cached = (projects: readonly { path: string }[]) =>
    client.getQueryData<InboxListResult>(keyOf(projects))?.items.map((entry) => entry.title);
  const shown = () => view.items.map((entry) => entry.title);

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Complete observer notifications inside async act.
    notifyManager.setScheduler(queueMicrotask);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    settled = vi.fn();
    results = new Map();
    peekInboxList.mockReturnValue(null);
    inboxListFetchedAt.mockReturnValue(0);
    listInboxItems.mockImplementation(async (projects: readonly { path: string }[]) => {
      const read = results.get(projects[0]!.path);
      if (!read) throw new Error(`no result for ${projects[0]!.path}`);
      return read();
    });
    results.set("/a", async () => ({
      items: [item(1, "A shared", "/a"), item(2, "A only", "/a")],
      errors: { jira: "A jira down" },
    }));
    results.set("/b", async () => ({
      items: [item(1, "B shared", "/b"), item(3, "B only", "/b")],
      errors: {},
    }));
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("derives items, errors and loading from the scope's query entry", async () => {
    await render({ projects: projectsA });
    await flush();
    expect(view.loading).toBe(false);
    expect(shown()).toEqual(["A shared", "A only"]);
    expect(view.providerErrors).toEqual({ jira: "A jira down" });
  });

  it("does not show the previous scope's items while the new scope is loading", async () => {
    await render({ projects: projectsA });
    await flush();
    let resolveB!: (value: InboxListResult) => void;
    results.set(
      "/b",
      () =>
        new Promise<InboxListResult>((resolve) => {
          resolveB = resolve;
        }),
    );
    await render({ projects: projectsB });
    expect(view.loading).toBe(true);
    expect(view.items).toEqual([]);
    expect(view.providerErrors).toEqual({});
    await act(async () => resolveB({ items: [item(3, "B only", "/b")], errors: {} }));
    expect(view.loading).toBe(false);
    expect(shown()).toEqual(["B only"]);
  });

  it("patches the originating scope for a stale A-render callback after switching to B", async () => {
    await render({ projects: projectsA });
    await flush();
    const updateFromA = view.updateItem;
    await render({ projects: projectsB });
    await flush();
    expect(shown()).toEqual(["B shared", "B only"]);

    // An async detail action that started in scope A finishes while B is shown.
    await update(item(2, "A only (edited)", "/a"), updateFromA);
    expect(cached(projectsA)).toEqual(["A shared", "A only (edited)"]);
    // B does not contain that item identity, so its contents are unchanged.
    expect(cached(projectsB)).toEqual(["B shared", "B only"]);
    expect(shown()).toEqual(["B shared", "B only"]);
  });

  it("also patches the current scope when it holds the same item identity", async () => {
    await render({ projects: projectsA });
    await flush();
    const updateFromA = view.updateItem;
    await render({ projects: projectsB });
    await flush();

    await update(item(1, "shared (edited in A)", "/a"), updateFromA);
    expect(cached(projectsA)).toEqual(["shared (edited in A)", "A only"]);
    expect(cached(projectsB)).toEqual(["shared (edited in A)", "B only"]);
    expect(shown()).toEqual(["shared (edited in A)", "B only"]);
  });

  it("never patches the mount-time scope from a B-render update", async () => {
    await render({ projects: projectsA });
    await flush();
    await render({ projects: projectsB });
    await flush();

    await update(item(1, "shared (edited in B)", "/b"));
    expect(cached(projectsB)).toEqual(["shared (edited in B)", "B only"]);
    expect(cached(projectsA)).toEqual(["A shared", "A only"]);
    expect(shown()).toEqual(["shared (edited in B)", "B only"]);
  });

  it("keeps patches scope-local across switches and a refresh refetch replaces them", async () => {
    await render({ projects: projectsA });
    await flush();
    await render({ projects: projectsB });
    await flush();
    await update(item(3, "B only (edited)", "/b"));
    expect(shown()).toEqual(["B shared", "B only (edited)"]);

    await render({ projects: projectsA });
    await flush();
    expect(shown()).toEqual(["A shared", "A only"]);

    await render({ projects: projectsB });
    await flush();
    expect(shown()).toEqual(["B shared", "B only (edited)"]);

    // A refresh bump reads B again; the fresh answer wins over the patched snapshot.
    results.set("/b", async () => ({ items: [item(3, "B only (server)", "/b")], errors: {} }));
    await render({ projects: projectsB, refresh: 1 });
    await flush();
    expect(shown()).toEqual(["B only (server)"]);
    expect(cached(projectsA)).toEqual(["A shared", "A only"]);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("does not create cache entries for scopes that have no data", async () => {
    await render({ projects: projectsA });
    await flush();
    const updateFromA = view.updateItem;
    results.set("/b", async () => ({ items: [], errors: {} }));
    await render({ projects: projectsB });
    await flush();
    await update(item(1, "x", "/a"), updateFromA);
    expect(cached(projectsB)).toEqual([]);
    expect(client.getQueryData(keyOf([{ path: "/never" }]))).toBeUndefined();
  });
});
