// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SummaryPanel } from "./TodaySummaryPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ save: vi.fn(), generate: vi.fn(async () => "summary") }));
vi.mock("../model/todayProvider", () => ({
  dailyNoteApi: {},
  summaryProvider: () => ({ model: "test", run: vi.fn() }),
}));
vi.mock("../model/todaySummary", () => ({
  buildSummaryPrompt: () => "preview",
  estimateSummaryCost: () => ({ cost: null, inputTokens: 1 }),
  generateSummary: mocks.generate,
  saveDailyNote: mocks.save,
}));
it("saves once while pending, retains text on failure and retries", async () => {
  let reject!: (error: Error) => void;
  mocks.save
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === name)!;
  try {
    await act(async () =>
      root.render(
        createElement(SummaryPanel, {
          data: { projects: [] } as never,
          pricing: null,
          activeMinutes: null,
          language: "en",
        }),
      ),
    );
    await act(async () => button("Summarize").click());
    await act(async () => button("Send").click());
    const save = button("Save to daily note");
    await act(async () => {
      save.click();
      save.click();
    });
    expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("write failed")));
    expect(container.textContent).toContain("The note could not be saved.");
    await act(async () => button("Save to daily note").click());
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Saved to today's note");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps a completed result when a later request fails and context changes", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    data: { projects: [], period: "today" } as never,
    pricing: null,
    activeMinutes: null,
    language: "en",
  };
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === name)!;
  try {
    await act(async () => root.render(createElement(SummaryPanel, props)));
    await act(async () => button("Summarize").click());
    await act(async () => button("Send").click());
    mocks.generate.mockRejectedValueOnce(new Error("failed"));
    await act(async () => button("Send").click());
    await act(async () =>
      root.render(
        createElement(SummaryPanel, {
          ...props,
          data: { projects: [], period: "week" } as never,
          language: "tr",
        }),
      ),
    );
    expect(container.querySelectorAll("textarea")[1]?.value).toBe("summary");
    expect(container.textContent).toContain("Today · en");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
