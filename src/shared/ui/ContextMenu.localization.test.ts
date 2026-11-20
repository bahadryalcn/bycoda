// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getLanguagePreference, setLanguagePreference } from "../i18n";
import { ContextMenu } from "./ContextMenu";

it("uses a translated generic accessible name by default", async () => {
  const previousLanguage = getLanguagePreference();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => setLanguagePreference("tr"));
    await act(async () =>
      root.render(
        createElement(ContextMenu, {
          x: 20,
          y: 20,
          items: [{ kind: "item", id: "open", label: "Open" }],
          onPick: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Eylemler");
  } finally {
    await act(async () => root.unmount());
    await act(async () => setLanguagePreference(previousLanguage));
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  ["terminal/ui/ProjectTerminalDock.tsx", ["Terminal actions", "Terminal profiles"]],
  ["source-control/ui/GitActionsMenu.tsx", ["Branch actions"]],
])("localizes menu labels at the %s call sites", (file, labels) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../../features", file), "utf8");
  for (const label of labels) {
    expect(source).toContain(`ariaLabel={t("${label}")}`);
    expect(source).not.toContain(`ariaLabel="${label}"`);
  }
});
