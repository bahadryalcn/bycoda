// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProvidersSection } from "./ProvidersSection";

vi.mock("./ProvidersPageGate", () => ({
  ProvidersPageGate: () => {
    const [draft, setDraft] = useState("Account draft");
    return createElement("input", {
      "aria-label": "Fixture account draft",
      value: draft,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    });
  },
}));
vi.mock("./UsageSettingsPage", () => ({
  UsageSettingsPage: () => createElement("div", null, "Usage fixture"),
}));

it("retains provider drafts and mounted operation owners across Usage navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ProvidersSection)));
    const draft = container.querySelector("input")!;
    expect(container.querySelector('[role="tab"]')).toBeNull();
    await act(async () => root.render(createElement(ProvidersSection, { activePage: "usage" })));
    expect(container.contains(draft)).toBe(true);
    expect(draft.closest("[hidden]")).not.toBeNull();
    expect(container.textContent).toContain("Usage fixture");
    await act(async () =>
      root.render(createElement(ProvidersSection, { activePage: "providers" })),
    );
    expect(container.querySelector("input")).toBe(draft);
    expect(draft.closest("[hidden]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
