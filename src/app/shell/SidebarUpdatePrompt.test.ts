// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openErrorDetails } from "../../features/sessions/ui/errorDetails.fixture";
import type { UpdaterSnapshot } from "../model/updater";
import { SidebarUpdateFooter } from "./SidebarUpdate";

const mocks = vi.hoisted(() => ({
  snapshot: {} as UpdaterSnapshot,
  snooze: vi.fn(),
}));
vi.mock("../model/useAppUpdater", () => ({
  claimStartupUpdatePrompt: () => false,
  installAppUpdate: vi.fn(),
  useAppUpdater: () => ({ snapshot: mocks.snapshot, setSnapshot: vi.fn() }),
}));
vi.mock("../model/updatePrompt", () => ({ snoozeUpdatePrompt: mocks.snooze }));
vi.mock("./GithubStarPrompt", () => ({ GithubStarPrompt: () => null }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The Details popover measures its anchor; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.snooze.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openPrompt(snapshot: UpdaterSnapshot) {
  mocks.snapshot = snapshot;
  await act(async () => root.render(createElement(SidebarUpdateFooter)));
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(trigger).not.toBeNull();
  await act(async () => trigger?.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!;
}

function dialogButton(dialog: HTMLElement, label: string) {
  const button = Array.from(dialog.querySelectorAll("button")).find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  return button!;
}

it("snoozes an available update only when the reminder action is selected", async () => {
  const snapshot = {
    phase: "available",
    currentVersion: "1.0.0",
    availableVersion: "1.0.1",
  } satisfies UpdaterSnapshot;

  const firstDialog = await openPrompt(snapshot);
  await act(async () => dialogButton(firstDialog, "Close").click());
  expect(mocks.snooze).not.toHaveBeenCalled();

  const secondDialog = await openPrompt(snapshot);
  await act(async () => dialogButton(secondDialog, "Remind me tomorrow").click());
  expect(mocks.snooze).toHaveBeenCalledOnce();
});

it("shows a versionless failure and lets the user close it without snoozing", async () => {
  const dialog = await openPrompt({
    phase: "error",
    currentVersion: "1.0.0",
    error: "Update service unavailable",
  });

  expect(dialog.querySelector("h2")?.textContent).toBe("Update failed");
  expect(dialog.textContent).toContain("Could not update the app");
  expect(openErrorDetails(dialog)).toContain("Update service unavailable");
  expect(dialog.textContent).not.toContain("Remind me tomorrow");
  const close = Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Close",
  );
  expect(close).toBeDefined();
  await act(async () => close?.click());
  expect(mocks.snooze).not.toHaveBeenCalled();
});
