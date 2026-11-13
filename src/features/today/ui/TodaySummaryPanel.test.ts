// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SummaryPanel } from "./TodaySummaryPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../model/todayProvider", () => ({
  dailyNoteApi: {},
  summaryProvider: () => ({ model: "test", run: vi.fn() }),
}));
vi.mock("../model/todaySummary", () => ({
  buildSummaryPrompt: () => "preview",
  estimateSummaryCost: () => ({ cost: null, inputTokens: 1 }),
  generateSummary: async () => "summary",
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
