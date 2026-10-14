// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ActivityThinkingRow } from "./AgentTranscript";
import { setLanguagePreference, t } from "../../../shared/i18n";

it("shows a localized generic heading when reasoning is open and restores its collapsed preview", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  await setLanguagePreference("tr");
  try {
    await act(async () => root.render(createElement(ActivityThinkingRow, { expandable: true, block: { id: "think", role: "reasoning", text: "First paragraph.\n\nMore detail." } })));
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("First paragraph.");
    await act(async () => button.click());
    expect(button.textContent).toContain(t("Thinking…"));
    expect(button.textContent).not.toContain("First paragraph.");
    expect(container.textContent?.match(/First paragraph\./g)).toHaveLength(1);
    await act(async () => button.click());
    expect(button.textContent).toContain("First paragraph.");
  } finally { await act(async () => root.unmount()); await setLanguagePreference("en"); }
});
