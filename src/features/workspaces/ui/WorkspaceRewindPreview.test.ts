// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionRewindPlan } from "../model/contracts";
import { WorkspaceRewindPreview } from "./WorkspaceRewindPreview";

vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement("div", { role: "dialog", "aria-label": title }, children, footer),
  ModalActions: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("../../../shared/i18n", () => {
  const t = (text: string, params?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key] ?? key));
  return { t, useT: () => t };
});

const plan = (expiresAt: number): SessionRewindPlan => ({
  token: "plan",
  expiresAt,
  direction: "rewind",
  workspaceId: "workspace",
  sessionId: "session",
  userBlockId: "owner",
  expectedRevision: 8,
  expectedConversationRevision: 12,
  branchRef: "refs/heads/bycoda/s/work",
  currentHead: "abc",
  targetHead: "def",
  statusFingerprint: "status",
  removedUserBlockIds: ["owner"],
  affectedCommits: ["abc"],
  affectedPaths: ["src/app.ts"],
  blockers: [],
  published: false,
  merged: false,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const applyButton = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === "Rewind");

// Regression for #461: the preview used to re-render every second only to notice expiry.
it("arms one timer for the expiry instead of ticking every second", async () => {
  const onApply = vi.fn(async () => undefined);
  await act(async () =>
    root.render(
      createElement(WorkspaceRewindPreview, {
        plan: plan(Date.now() + 90_000),
        onApply,
        onClose: vi.fn(),
      }),
    ),
  );
  expect(vi.getTimerCount()).toBe(1);
  expect(applyButton()?.disabled).toBe(false);
  expect(host.textContent).not.toContain("has expired");
  await act(async () => vi.advanceTimersByTime(89_000));
  expect(host.textContent).not.toContain("has expired");
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(host.textContent).toContain("This rewind preview has expired.");
  expect(applyButton()?.getAttribute("aria-disabled")).toBe("true");
  expect(vi.getTimerCount()).toBe(0);
  expect(onApply).not.toHaveBeenCalled();
});

it("opens already expired and never applies", async () => {
  const onApply = vi.fn(async () => undefined);
  await act(async () =>
    root.render(
      createElement(WorkspaceRewindPreview, {
        plan: plan(Date.now() - 1),
        onApply,
        onClose: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain("This rewind preview has expired.");
  expect(applyButton()?.getAttribute("aria-disabled")).toBe("true");
  expect(vi.getTimerCount()).toBe(0);
});
