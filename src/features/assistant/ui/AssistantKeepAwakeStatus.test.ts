// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../../shared/i18n", () => ({
  t: (value: string) => value,
  useT: () => (value: string) => value,
}));
import { AssistantKeepAwakeStatus, keepAwakeLabel } from "./AssistantKeepAwakeStatus";
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
    expect(container.querySelector('[data-assistant-keep-awake="requested"]')).not.toBeNull();
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

it("says what will happen from the drafted switches instead of reporting off beside enabled ones", () => {
  const idle = { supported: true, requested: false, active: false };
  expect(keepAwakeLabel(idle)).toBe("Sleep prevention is off");
  expect(keepAwakeLabel(idle, { working: false, away: false })).toBe("Sleep prevention is off");
  expect(keepAwakeLabel(idle, { working: false, away: true })).toBe(
    "Will keep this computer awake once you are away",
  );
  expect(keepAwakeLabel(idle, { working: true, away: false })).toBe(
    "Will keep this computer awake while jobs run",
  );
  expect(keepAwakeLabel(idle, { working: true, away: true })).toBe(
    "Will keep this computer awake while jobs run or you are away",
  );
  expect(keepAwakeLabel({ ...idle, active: true }, { working: false, away: true })).toBe(
    "Keeping this computer awake",
  );
});
