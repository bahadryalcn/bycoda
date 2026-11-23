import { expect, it, vi } from "vitest";
import { useAutomationDraftStart } from "./useAutomationDraftStart";

const routing = vi.hoisted(() => ({ supported: true }));
vi.mock("./useAutomationRoutingHost", () => ({ useAutomationRoutingHost: () => routing }));
vi.mock("../../sessions/model/models", () => ({
  defaultSessionChoice: () => ({ harness: "codex", model: "codex:fallback" }),
  firstEnabledHarness: () => "codex",
  modelsFor: () => [],
  preferredModelId: () => "codex:fallback",
}));

it.each([true, false])(
  "new blank drafts follow the role only on a capable Host (%s)",
  (supported) => {
    routing.supported = supported;
    const setDraft = vi.fn();
    const start = useAutomationDraftStart({
      cwd: "/repo",
      recents: [],
      selected: null,
      savingRef: { current: false },
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
    expect(setDraft.mock.lastCall?.[0].hostCreateId).toEqual(expect.any(String));
    start.beginBlank();
    const blankId = setDraft.mock.lastCall?.[0].hostCreateId;
    start.beginBlank();
    expect(setDraft.mock.lastCall?.[0].hostCreateId).not.toBe(blankId);
  },
);
