// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRecoveryDialog } from "./WorkspaceRecoveryDialog";

const state = vi.hoisted(() => ({ chatPending: false }));
vi.mock("../../shell/SessionRecoveryPanel", () => ({
  SessionRecoveryPanel: ({
    renderContainer,
  }: {
    renderContainer: (content: ReactNode, pending: boolean) => ReactNode;
  }) => renderContainer("Recovered conversations", state.chatPending),
}));
vi.mock("./EditorDraftRecoverySection", () => ({
  EditorDraftRecoverySection: () => "Retained file drafts",
}));
vi.mock("./BufferRecoveryReports", () => ({ BufferRecoveryReports: () => "Earlier reports" }));

type Props = ComponentProps<typeof WorkspaceRecoveryDialog>;
let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.chatPending = false;
  onClose.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = (pending: boolean, reports = false) =>
  act(async () =>
    root.render(
      createElement(WorkspaceRecoveryDialog, {
        sessions: [],
        remoteSessions: [],
        recovery: null,
        onClose,
        onOpen: async () => {},
        onRemove: async () => {},
        canInspectLegacyReports: () => reports,
        getLegacyReportPrivacySnapshot: reports ? () => "visible" : undefined,
        // Only the recovery-shell boundary is exercised; file storage/actions stay mocked.
        editorDraftRecovery: {
          available: true,
          pendingKeys: new Set(pending ? ["draft"] : []),
        } as unknown as NonNullable<Props["editorDraftRecovery"]>,
      }),
    ),
  );

it.each(["file", "conversation"])(
  "disables Close while %s recovery is pending and restores it afterwards",
  async (kind) => {
    state.chatPending = kind === "conversation";
    await render(kind === "file");
    const close = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close().disabled).toBe(true);
    await act(async () => close().click());
    expect(onClose).not.toHaveBeenCalled();
    state.chatPending = false;
    await render(false);
    expect(close().disabled).toBe(false);
    await act(async () => close().click());
    expect(onClose).toHaveBeenCalledOnce();
  },
);

it("names the sole recovery section without referencing an absent tab", async () => {
  await render(false);
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  const section = document.getElementById("workspace-recovery-panel-files")!;
  expect(section.getAttribute("aria-labelledby")).toBeNull();
  expect(section.getAttribute("role")).toBe("region");
  expect(section.getAttribute("aria-label")).toBe("File drafts");
  expect(section.textContent).toContain("Retained file drafts");
});

it("preserves tab and panel naming when multiple recovery kinds are available", async () => {
  await render(false, true);
  const panel = document.querySelector('[role="tabpanel"]')!;
  const label = document.getElementById(panel.getAttribute("aria-labelledby")!);
  expect(label?.getAttribute("role")).toBe("tab");
  expect(label?.textContent).toBe("File drafts0");
  expect(label?.getAttribute("aria-controls")).toBe(panel.id);
  expect(panel.hasAttribute("aria-label")).toBe(false);
});
