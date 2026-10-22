// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CheckRepairForm } from "./CheckRepairForm";
const { fetchCheckDetails } = vi.hoisted(() => ({
  fetchCheckDetails: vi.fn(),
}));
vi.mock("../model/prChecks", () => ({ fetchCheckDetails }));
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
}));
it("Hesap değişirken bekleyen eski günlükten repair başlatmaz", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (value: unknown) => void;
  fetchCheckDetails.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const host = document.createElement("div");
  const root = createRoot(host);
  const start = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(CheckRepairForm, {
          anchor: null,
          cwd: "/repo",
          repo: "g/r",
          headOid: "head",
          checks: [
            {
              provider: "gitlab",
              instance: "https://a.example",
              detailsRef: { project: "1", jobId: "2" },
              name: "tests",
              workflow: "CI",
              state: "fail",
              url: null,
              startedAt: null,
              completedAt: null,
            },
          ],
          repair: {
            provider: "gitlab",
            instance: "https://a.example",
            number: 1,
            sessions: [],
            onStart: start,
          },
          onClose() {},
        }),
      ),
    );
    const button = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Start fix"),
    );
    act(() => button!.click());
    act(() => window.dispatchEvent(new Event("bycoda:gitlab-change")));
    await act(async () => resolve({ steps: [], annotations: [], log: "old account evidence" }));
    expect(start).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Account changed");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
