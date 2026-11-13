// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AssistantCostFields } from "./AssistantCostFields";
import { ProfileRowsProvider } from "./SettingsProfileRow";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";

it("keeps raw context-limit drafts mounted while technical sections are collapsed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  let draft: AssistantProfilePatch = {
    chiefWakeLimit: 20,
    nudgeLimit: 2,
    summaryRefreshMessages: 20,
    perWakeTokenCap: 800000,
    chiefSoftContext: 150000,
    chiefHardContext: 2000000,
  };
  function Form() {
    const [value, setValue] = useState(draft);
    return createElement(
      ProfileRowsProvider,
      { value: true },
      createElement(AssistantCostFields, {
        value,
        onChange: (patch) => {
          draft = { ...value, ...patch };
          setValue(draft);
        },
      }),
    );
  }
  try {
    await act(async () => root.render(createElement(Form)));
    const header = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Supervisor limits",
    )!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    await act(async () => header.click());
    const input = host.querySelector<HTMLInputElement>('input[min="1000"][max="1000000"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Number.isNaN(draft.perWakeTokenCap)).toBe(true);
    await act(async () => header.click());
    expect(input.isConnected).toBe(true);
    expect(input.closest('[data-settings-part="advanced-content"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    await act(async () => header.click());
    expect(host.querySelector('input[min="1000"][max="1000000"]')).toBe(input);
    expect(input.value).toBe("");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
