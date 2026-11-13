// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, notifyManager, useQuery } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useJiraListContinuation } from "./useJiraListContinuation";
import type { InboxListResult, InboxItem } from "../model/githubTasks";
const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));
vi.mock("../model/jiraInboxPage", () => ({ fetchJiraInboxPage: fetchPage }));
const key = ["inbox", "continuation-test"];
const initial: InboxListResult = {
  items: [],
  errors: {},
  jiraPage: { token: "second", total: 42 },
  limited: ["jira"],
};

async function setup(snapshot = initial) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notifyManager.setScheduler(queueMicrotask);
  fetchPage.mockReset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, snapshot);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let view!: ReturnType<typeof useJiraListContinuation>;
  function View() {
    const query = useQuery({ queryKey: key, queryFn: async () => snapshot, enabled: false });
    view = useJiraListContinuation(
      key,
      [],
      { assignedToMe: false, state: "open", search: "" },
      query.data,
      true,
    );
    return null;
  }
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(View))),
  );
  return {
    client,
    get view() {
      return view;
    },
    close: async () => {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("coalesces scroll requests, preserves known total and completes the cursor", async () => {
  const state = await setup();
  let finish!: (page: unknown) => void;
  fetchPage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  try {
    const firstRequest = state.view.loadMore;
    await act(async () => {
      state.view.loadMore();
      state.view.loadMore();
    });
    expect(fetchPage).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ items: [], jiraPage: { token: null } });
    });
    expect(state.client.getQueryData<InboxListResult>(key)?.jiraPage).toEqual({
      token: null,
      total: 42,
      cursors: ["second"],
    });
    expect(state.client.getQueryData<InboxListResult>(key)?.limited).toEqual([]);
    await act(async () => firstRequest());
    expect(fetchPage).toHaveBeenCalledOnce();
  } finally {
    await state.close();
  }
});

it("rejects a late page after refresh replaces its query snapshot", async () => {
  const state = await setup();
  let finish!: (page: unknown) => void;
  fetchPage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  try {
    await act(async () => state.view.loadMore());
    const refreshed: InboxListResult = { ...initial, jiraPage: { token: "new-scope" } };
    await act(async () => {
      state.client.setQueryData(key, refreshed);
    });
    await act(async () => {
      finish({ items: [], jiraPage: { token: null } });
    });
    expect(state.client.getQueryData<InboxListResult>(key)?.jiraPage?.token).toBe("new-scope");
  } finally {
    await state.close();
  }
});

it("retains rows and cursor on failure for explicit retry", async () => {
  const state = await setup();
  fetchPage.mockRejectedValue(new Error("Jira unavailable"));
  try {
    await act(async () => state.view.loadMore());
    expect(state.client.getQueryData<InboxListResult>(key)?.jiraPage?.token).toBe("second");
    expect(state.view.error).toBe("Jira unavailable");
  } finally {
    await state.close();
  }
});

it("deduplicates pages without replacing edited rows or reordering equal timestamps", async () => {
  const item = (number: number, title: string): InboxItem => ({
    provider: "jira",
    kind: "jira",
    id: String(number),
    identifier: `ENG-${number}`,
    number,
    title,
    repo: "ENG",
    projectPath: "",
    url: "https://example.test",
    state: "open",
    updatedAt: "2026-11-13T00:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
  });
  const state = await setup({ ...initial, items: [item(1, "Edited title")] });
  fetchPage.mockResolvedValue({
    items: [item(1, "Old title"), item(2, "Next issue")],
    jiraPage: { token: null },
  });
  try {
    await act(async () => state.view.loadMore());
    expect(
      state.client.getQueryData<InboxListResult>(key)?.items.map((entry) => entry.title),
    ).toEqual(["Edited title", "Next issue"]);
  } finally {
    await state.close();
  }
});
