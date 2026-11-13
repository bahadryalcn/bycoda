// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderDefaultsSaveBar, type DefaultsSaveState } from "./ProviderDefaultsSaveBar";

it("confirms saved defaults in the action while retaining unsaved counts and save errors", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (pending: number, saveState: DefaultsSaveState, saving = false) => {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsSaveBar, {
          target: { kind: "global" },
          options: [],
          onTargetChange: vi.fn(),
          pending,
          saveState,
          saving,
          onSave: vi.fn(),
          onDiscard: vi.fn(),
        }),
      ),
    );
  };
  try {
    await render(0, { state: "saved", target: "Global" });
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Saved"),
    ).toBe(true);
    expect(container.querySelector(".provider-save-bar-status")).toBeNull();
    await render(2, { state: "saved", target: "Global" });
    expect(container.querySelector(".provider-save-bar-status")?.textContent).toContain(
      "2 unsaved changes",
    );
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Save"),
    ).toBe(true);
    await render(2, { state: "error", message: "Storage unavailable" });
    expect(container.querySelector(".provider-save-bar-status")?.textContent).toContain(
      "Storage unavailable",
    );
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    ).toBe(true);
    await render(2, { state: "idle" }, true);
    for (const label of ["Save", "Discard"]) {
      const button = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === label,
      )!;
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("summarizes Global and multiple targets without losing project count", async () => {
  const { defaultsTargetsSummary } = await import("./providerDefaultsTargetsPicker");
  const options = [
    { value: "global", label: "Global" },
    { value: "project:a", label: "A" },
    { value: "project:b", label: "B" },
  ];
  expect(defaultsTargetsSummary(["project:a", "project:b"], options)).toBe("All projects (2)");
  expect(defaultsTargetsSummary(["global", "project:a"], options)).toBe("Global + 1 targets");
});

it("keeps group apply details available when the draft is clean", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProviderDefaultsSaveBar, {
          target: { kind: "group", id: "team", workspace: false },
          options: [{ value: "group:team", label: "Team" }],
          pending: 0,
          saveState: { state: "idle" },
          onSave: vi.fn(),
          onDiscard: vi.fn(),
          onTargetChange: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector('[aria-label="Apply details"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows the provider scope only while changes are pending", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (pending: number, providerScope?: "all") =>
    act(async () =>
      root.render(
        createElement(ProviderDefaultsSaveBar, {
          target: { kind: "global" },
          options: [],
          onTargetChange: vi.fn(),
          pending,
          saveState: { state: "idle" },
          onSave: vi.fn(),
          onDiscard: vi.fn(),
          activeProvider: "codex",
          draft: { providers: {}, accounts: {}, ...(providerScope ? { providerScope } : {}) },
          onDraftChange: vi.fn(),
        }),
      ),
    );
  try {
    await render(0);
    expect(container.textContent).not.toContain("Apply to");
    await render(1);
    expect(container.textContent).toContain("Apply to");
    await render(0, "all");
    expect(container.textContent).toContain("Apply to");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
