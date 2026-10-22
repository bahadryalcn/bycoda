// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { JobHistory, SocialHistory } from "./SocialHistory";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function openFilters() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
}
it("filters visible results and offers retries only for confirmed failures", async () => {
  const snapshot: SocialSnapshot = {
    executorId: "host",
    hostOnline: true,
    stopped: false,
    sendingEnabled: true,
    pollingEnabled: false,
    accounts: [],
    campaigns: [],
    threads: [],
    contacts: [],
    segments: [],
    rules: [],
    drafts: [],
    profiles: [],
    capabilities: {},
    jobs: ["queued", "failed", "review", "succeeded", "cancelled"].map((status, index) => ({
      id: String(index),
      operationId: `operation-${index}`,
      dedupeKey: `key-${index}`,
      actorId: "owner",
      accountId: "a",
      projectIds: ["p"],
      provider: "owner",
      kind: "publish",
      payload: { text: `<img src=x onerror=alert(1)> ${index}`, media: [] },
      status: status as SocialSnapshot["jobs"][number]["status"],
      createdAt: index + 1,
      scheduledAt: index + 1,
      attempts: 1,
      url: index === 3 ? "javascript:alert(1)" : undefined,
    })),
  };
  const request = vi.fn().mockResolvedValue({});
  const run = vi.fn(async (work: () => Promise<unknown>) => {
    await work();
    return true;
  });
  await act(async () =>
    root.render(
      createElement(SocialHistory, {
        snapshot,
        client: { request } as unknown as SocialClient,
        projects: [],
        run,
      }),
    ),
  );
  expect(container.querySelectorAll(".social-history-record")).toHaveLength(5);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  const uncertain = container.querySelector('[data-status="review"].social-history-record')!;
  expect(uncertain.textContent).toContain("aynı içeriği yeniden göndermeyin");
  expect(uncertain.querySelector("button")).toBeNull();
  await openFilters();
  const status = Array.from(document.querySelectorAll(".social-filter-panel label"))
    .find((label) => label.firstChild?.textContent === "Gönderim durumu")!
    .querySelector("select")!;
  await act(async () => {
    status.value = "failed";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll(".social-history-record")).toHaveLength(1);
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".social-history-record button")!.click(),
  );
  expect(request).toHaveBeenCalledExactlyOnceWith("jobs.retry", { id: "1" });
  expect(
    container.querySelector(".social-status-badge[data-status=failed]")?.getAttribute("data-kind"),
  ).toBe("error");
});

it("clears a host date filter when the retained history controls are reset", async () => {
  vi.useFakeTimers();
  const snapshot: SocialSnapshot = {
    executorId: "host",
    hostOnline: true,
    stopped: false,
    sendingEnabled: true,
    pollingEnabled: false,
    accounts: [],
    campaigns: [],
    threads: [],
    contacts: [],
    segments: [],
    rules: [],
    drafts: [],
    profiles: [],
    jobs: [],
    capabilities: {},
    pages: { jobs: { offset: 0, limit: 50, total: 0 } },
  };
  const onFilterChange = vi.fn();
  const render = () =>
    root.render(
      createElement(SocialHistory, {
        snapshot,
        client: { request: vi.fn() } as unknown as SocialClient,
        projects: [],
        run: async () => true,
        onFilterChange,
      }),
    );
  try {
    await act(async () => render());
    await openFilters();
    const input = document.querySelector<HTMLInputElement>(
      '.social-filter-panel input[type="date"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "2026-10-12",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    await act(async () => vi.advanceTimersByTime(200));
    expect(onFilterChange).toHaveBeenCalledWith(
      "jobs",
      expect.objectContaining({ since: new Date("2026-10-12T00:00:00").getTime() }),
    );
    snapshot.filters = { jobs: onFilterChange.mock.calls[0][1] };
    await act(async () => render());
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Filtreleri temizle")!
        .click(),
    );
    await act(async () => vi.advanceTimersByTime(200));
    expect(onFilterChange).toHaveBeenLastCalledWith("jobs", {
      query: "",
      status: "",
      accountId: "",
      kind: "",
    });
    expect(input.value).toBe("");
  } finally {
    vi.useRealTimers();
  }
});

it("keeps embedded job counts and local pages scoped to the selected conversation", async () => {
  const jobs: SocialSnapshot["jobs"] = Array.from({ length: 35 }, (_, index) => ({
    id: `conversation-job-${index}`,
    operationId: `operation-${index}`,
    dedupeKey: `key-${index}`,
    actorId: "owner",
    accountId: "a",
    projectIds: ["p"],
    provider: "owner",
    kind: "reply",
    payload: { text: `Conversation reply ${index}`, media: [] },
    status: "failed",
    createdAt: index + 1,
    scheduledAt: index + 1,
    attempts: 1,
  }));
  const snapshot: SocialSnapshot = {
    executorId: "host",
    hostOnline: true,
    stopped: false,
    sendingEnabled: true,
    pollingEnabled: false,
    accounts: [],
    campaigns: [],
    threads: [],
    contacts: [],
    segments: [],
    rules: [],
    drafts: [],
    profiles: [],
    jobs: [],
    capabilities: {},
    pages: { jobs: { offset: 0, limit: 50, total: 200 } },
    jobCounts: { failed: 100, succeeded: 100 },
  };
  await act(async () =>
    root.render(
      createElement(JobHistory, {
        snapshot,
        jobs,
        client: { request: vi.fn() } as unknown as SocialClient,
        run: async () => true,
      }),
    ),
  );
  await openFilters();
  const select = document.querySelector<HTMLSelectElement>(".social-filter-panel select")!;
  expect(select.querySelector('option[value=""]')?.textContent).toBe("Tüm işler · 35");
  expect(select.querySelector('option[value="failed"]')?.textContent).toContain("35");
  expect(select.querySelector('option[value="succeeded"]')?.textContent).toContain("0");
  expect(container.querySelectorAll(".social-history-record")).toHaveLength(30);
  await act(async () =>
    Array.from(container.querySelectorAll(".social-pagination button"))
      .find((button) => button.textContent === "Sonraki")!
      .click(),
  );
  expect(container.querySelectorAll(".social-history-record")).toHaveLength(5);
  expect(container.querySelector(".social-pagination")?.textContent).toContain("2 / 2");
});
