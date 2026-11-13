import { expect, it, vi } from "vitest";
import { useAutomationDraftStart } from "./useAutomationDraftStart";
import type { AutomationTemplate } from "../model/automationTemplates";

const routing = vi.hoisted(() => ({ supported: true }));
vi.mock("./useAutomationRoutingHost", () => ({ useAutomationRoutingHost: () => routing }));
vi.mock("../../sessions/model/models", () => ({
  defaultSessionChoice: () => ({ harness: "codex", model: "codex:fallback" }),
  firstEnabledHarness: () => "codex",
  modelsFor: () => [],
  preferredModelId: () => "codex:fallback",
}));

it.each([true, false])(
  "new blank/template drafts follow the role only on a capable Host (%s)",
  (supported) => {
    routing.supported = supported;
    const setDraft = vi.fn();
    const start = useAutomationDraftStart({
      cwd: "/repo",
      recents: [],
      selected: null,
      savingRef: { current: false },
      setPickerOpen: vi.fn(),
      setCompactListOpen: vi.fn(),
      setDraft,
    });
    start.beginBlank();
    expect(setDraft.mock.lastCall?.[0]).toMatchObject({
      harness: "codex",
      model: "codex:fallback",
    });
    expect(setDraft.mock.lastCall?.[0].modelChoice).toEqual(
      supported ? { kind: "default" } : undefined,
    );
    start.beginFromTemplate({
      name: "Audit",
      prompt: "Audit",
      trigger: { kind: "time", event: "daily" },
    } as AutomationTemplate);
    expect(setDraft.mock.lastCall?.[0].modelChoice).toEqual(
      supported ? { kind: "default" } : undefined,
    );
  },
);
