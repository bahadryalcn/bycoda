// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ModelLabel } from "./ModelLabel";
import { resetHarnessModelOverlays, setHarnessModels } from "../model/models";

it("shows the provider icon and the readable name, never the raw id", () => {
  const html = renderToStaticMarkup(createElement(ModelLabel, { model: "claude-opus-5-5" }));
  expect(html).toContain("<img");
  expect(html).toContain("Claude Opus 5.5");
  expect(html).not.toContain("claude-opus-5-5");
});

it("derives a name for an id the catalog does not know", () => {
  const html = renderToStaticMarkup(
    createElement(ModelLabel, { model: "claude-haiku-9-1-20290101", harness: "claude" }),
  );
  expect(html).toContain("Claude Haiku 9.1");
  expect(html).not.toContain("20290101");
});

it("renders only the icon for a select option", () => {
  const html = renderToStaticMarkup(
    createElement(ModelLabel, { model: "gpt-5.4", harness: "codex", iconOnly: true }),
  );
  expect(html).toContain("<img");
  expect(html).not.toContain("GPT-5.4");
});

it("exposes a full long identity in expanded details while keeping compact callers unchanged", () => {
  const name = "Uzun model adı / مساحة العمل 👩🏽‍💻 " + "long-model-name".repeat(16);
  const compact = renderToStaticMarkup(
    createElement(ModelLabel, { model: "gpt-5.4", harness: "codex", name }),
  );
  const expanded = renderToStaticMarkup(
    createElement(ModelLabel, { model: "gpt-5.4", harness: "codex", name, wrap: true }),
  );
  expect(compact).toContain('data-truncate="true"');
  expect(expanded).not.toContain('data-truncate="true"');
  expect(expanded).toContain('data-wrap="anywhere"');
  expect(expanded).toContain(name);
  expect(expanded).toContain("<img");
});

it("falls back to a generic icon when the provider is unknown", () => {
  const html = renderToStaticMarkup(createElement(ModelLabel, { model: "mystery-model-2" }));
  expect(html).not.toContain("<img");
  expect(html).toContain("Mystery Model 2");
});

it("refreshes both readable name and provider when the live catalog changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ModelLabel, { model: "custom-model" })));
    expect(container.querySelector("img")).toBeNull();
    await act(async () =>
      setHarnessModels("codex", [{ id: "custom-model", name: "Live model", harness: "codex" }]),
    );
    expect(container.textContent).toBe("Live model");
    expect(container.querySelector("img")).not.toBeNull();
    await act(async () =>
      setHarnessModels("codex", [{ id: "custom-model", name: "Renamed model", harness: "codex" }]),
    );
    expect(container.textContent).toBe("Renamed model");
  } finally {
    await act(async () => root.unmount());
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  }
});
