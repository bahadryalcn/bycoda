// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewBulkModelBar } from "./CrewBulkModelBar";
import type { HostModelCatalog } from "../../connections/public/protocol";

vi.mock("../../model-routing/public/choice", () => ({ ModelChoiceField: () => null }));

it("coalesces rapid Apply clicks and exposes pending feedback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish!: () => void;
  const onApply = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(CrewBulkModelBar, {
          cwd: "/fixture",
          catalog: { models: {}, errors: {} } as HostModelCatalog,
          targetCount: 2,
          suggested: {
            id: "codex/m",
            harness: "codex",
            model: "m",
            modelSettings: {},
            capabilities: {},
          },
          onApply,
        }),
      ),
    );
    const apply = container.querySelector("button")!;
    act(() => {
      apply.click();
      apply.click();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(apply.getAttribute("aria-busy")).toBe("true");
    expect(apply.closest("fieldset")?.disabled).toBe(true);
    await act(async () => finish());
    expect(container.textContent).toContain("Model choice applied.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
