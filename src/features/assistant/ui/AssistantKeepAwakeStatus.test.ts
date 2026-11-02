// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../../shared/i18n", () => ({ t: (value: string) => value }));
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
it("does not claim native activation from a requested policy and retains native errors", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AssistantKeepAwakeStatus, {
          state: { supported: true, requested: true, active: false },
        }),
      ),
    );
    expect(container.textContent).toBe("Waiting to prevent sleep");
    expect(
      container.querySelector('[data-assistant-keep-awake="requested"]'),
    ).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(AssistantKeepAwakeStatus, {
          state: {
            supported: false,
            requested: true,
            active: false,
            error: "Native helper unavailable",
          },
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Native helper unavailable",
    );
    expect(container.textContent).not.toContain("Keeping this computer awake");
    await act(async () =>
      root.render(
        createElement(AssistantKeepAwakeStatus, {
          state: { supported: true, requested: true, active: true },
        }),
      ),
    );
    expect(container.textContent).toBe("Keeping this computer awake");
    await act(async () =>
      root.render(
        createElement(AssistantKeepAwakeStatus, {
          compact: true,
          state: { supported: true, requested: false, active: false },
        }),
      ),
    );
    expect(container.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});
