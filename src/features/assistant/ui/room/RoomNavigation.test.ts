// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoomNavigation } from "./RoomNavigation";

vi.mock("../../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  t: (key: string) => key,
}));

it("shows every Room destination in one strip and keeps a deep link selected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(RoomNavigation, { view: "History", onChange: change, activeJobs: 2 }),
      ),
    );
    const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs().map((item) => item.textContent?.replace(/\d+$/, ""))).toEqual([
      "Today",
      "Jobs",
      "Sessions",
      "Conversations",
      "Notes",
      "Memory",
      "History",
    ]);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(tabs().find((item) => item.getAttribute("aria-selected") === "true")?.textContent).toBe(
      "History",
    );
    await act(async () =>
      tabs()
        .find((item) => item.textContent === "Memory")!
        .click(),
    );
    expect(change).toHaveBeenCalledWith("Memory");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
