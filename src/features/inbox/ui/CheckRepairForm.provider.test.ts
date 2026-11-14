// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CheckRepairForm } from "./CheckRepairForm";
const { fetchCheckDetails } = vi.hoisted(() => ({
  fetchCheckDetails: vi.fn(),
}));
vi.mock("../model/prChecks", () => ({ fetchCheckDetails }));
vi.mock("../../../shared/ui/Popover", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/ui/Popover")>(
    "../../../shared/ui/Popover",
  )),
  Popover: ({ children }: { children: ReactNode }) => children,
}));
it("does not start a repair from a stale pending log while the account changes", async () => {
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
    expect(
      [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Start fix"))!
        .disabled,
    ).toBe(true);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(["gitlab", "azuredevops"] as const)(
  "keeps the account-change warning when a %s repair settles late",
  async (provider) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchCheckDetails.mockResolvedValue({ steps: [], annotations: [] });
    let finish!: () => void;
    const onStart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(CheckRepairForm, {
            anchor: null,
            cwd: "/repo",
            repo: "g/r",
            headOid: "head",
            checks: [],
            repair: { provider, instance: "https://a.example", number: 1, sessions: [], onStart },
            onClose,
          }),
        ),
      );
      await act(async () => {
        [...host.querySelectorAll("button")]
          .find((node) => node.textContent?.includes("Start fix"))!
          .click();
      });
      expect(onStart).toHaveBeenCalledOnce();
      act(() => window.dispatchEvent(new Event(`bycoda:${provider}-change`)));
      await act(async () => finish());
      expect(onClose).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Account changed");
      expect(
        [...host.querySelectorAll("button")].find((node) =>
          node.textContent?.includes("Start fix"),
        )!.disabled,
      ).toBe(true);
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
