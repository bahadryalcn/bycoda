// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoomNavigation } from "./RoomNavigation";

vi.mock("../../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  t: (key: string) => key,
}));

it("keeps a deep-linked record selected and exposes each record destination", async () => {
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
    const selected = [...container.querySelectorAll('[role="tab"][aria-selected="true"]')];
    expect(selected.map((item) => item.textContent)).toEqual(["Records", "What I did"]);
    const memory = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (item) => item.textContent === "Memory",
    );
    await act(async () => memory!.click());
    expect(change).toHaveBeenCalledWith("Memory");
    await act(async () =>
      root.render(
        createElement(RoomNavigation, { view: "Sessions", onChange: change, activeJobs: 2 }),
      ),
    );
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "Work",
    );
    expect(
      [...container.querySelectorAll('[role="tab"]')].some(
        (item) => item.textContent === "Sessions",
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
