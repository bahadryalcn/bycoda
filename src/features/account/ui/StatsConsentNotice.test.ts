// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { statsDisclosure } from "../model/statsDisclosure";

vi.mock("../hooks/useAccount", () => ({ useAccountState: () => ({ phase: "signed-out" }) }));
vi.mock("../model/accountPrivacy", () => ({
  getStatsChoice: () => null,
  recordStatsPromptShown: vi.fn(),
  setStatsChoice: vi.fn(),
  shouldPromptForStats: () => true,
  subscribeAnonymousStats: () => () => undefined,
}));
vi.mock("../../../shared/ui/overlay", () => ({ hasActiveModalOverlay: () => false }));
vi.mock("../../../shared/ui/ToastRegion", () => ({
  Toast: ({ message }: { message: string }) => createElement("p", { "data-toast": "" }, message),
}));

import { StatsConsentNotice } from "./StatsConsentNotice";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shows the shared statistics disclosure instead of its own copy", async () => {
  act(() => root.render(createElement(StatsConsentNotice)));
  await act(async () => {
    vi.advanceTimersByTime(7000);
  });
  expect(container.querySelector("[data-toast]")?.textContent).toBe(statsDisclosure());
});
