import { expect, it, vi } from "vitest";
vi.mock("../../connections/public/useReloadOnReconnect", () => ({
  useReloadOnMachineReconnect: vi.fn(),
}));
vi.mock("../data/composerDraftStore", () => ({
  composerDraftsLoaded: () => false,
  flushComposerDrafts: vi.fn(),
  subscribeComposerDraftLoadState: vi.fn(),
}));
vi.mock("../model/draftCache", () => ({
  hasUnsentComposerDraft: vi.fn(),
  subscribeComposerDrafts: vi.fn(),
}));
import { draftPresenceChanged } from "./useDraftPresenceReporter";
it("sends initial empty snapshot and changes, ignores order and duplicates", () => {
  expect(draftPresenceChanged(undefined, [])).toBe(true);
  expect(draftPresenceChanged([], [])).toBe(false);
  expect(draftPresenceChanged(["a", "b"], ["b", "a", "a"])).toBe(false);
  expect(draftPresenceChanged(["a"], [])).toBe(true);
  expect(draftPresenceChanged([], ["a"])).toBe(true);
});
