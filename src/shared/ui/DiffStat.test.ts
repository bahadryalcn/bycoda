// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setLanguagePreference } from "../i18n";
import { DiffStat } from "./DiffStat";

it("updates grouped diff counts when the app language changes without remounting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(DiffStat, { additions: 1234, deletions: 5678 })),
    );
    const added = host.querySelector('[data-side="added"]');
    expect(added?.textContent).toBe("+1,234");
    expect(host.querySelector('[data-side="removed"]')?.textContent).toBe("−5,678");
    await act(async () => setLanguagePreference("tr"));
    expect(host.querySelector('[data-side="added"]')).toBe(added);
    expect(added?.textContent).toBe("+1.234");
    expect(host.querySelector('[data-side="removed"]')?.textContent).toBe("−5.678");
  } finally {
    act(() => root.unmount());
    await setLanguagePreference("en");
    vi.unstubAllGlobals();
  }
});
