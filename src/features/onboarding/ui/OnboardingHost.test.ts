// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingHost } from "./OnboardingHost";
import { OPEN_USAGE_GUIDE_EVENT } from "../model/usageGuide";
import { configureFileAccess } from "../../../platform/tauri/fileAccess";
import { OPEN_ONBOARDING_EVENT, shouldShowOnboarding } from "../model/onboarding";

vi.mock("./OnboardingDialog", () => ({
  default: ({ onFinish, onStartGuide }: { onFinish: () => void; onStartGuide: () => void }) =>
    createElement(
      "div",
      null,
      createElement("button", { onClick: onFinish }, "Finish setup"),
      createElement("button", { onClick: onStartGuide }, "Start guide"),
    ),
}));
vi.mock("../../../platform/tauri/fileAccess", () => ({
  configureFileAccess: vi.fn().mockResolvedValue("all-files"),
}));
vi.mock("./UsageGuideDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) =>
    createElement("button", { onClick: onClose }, "Close tour"),
}));
vi.mock("./GuideHub", () => ({
  default: ({ onClose, onStartTour }: { onClose: () => void; onStartTour: () => void }) =>
    createElement(
      "div",
      null,
      createElement("button", { onClick: onClose }, "Close guide"),
      createElement("button", { onClick: onStartTour }, "Quick tour"),
    ),
}));
const fresh = { projects: 0, sessions: 0, restored: false, transferred: false };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.mocked(configureFileAccess).mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(projects = 0) {
  await act(async () =>
    root.render(
      createElement(OnboardingHost, {
        context: { ...fresh, projects },
        onImported: vi.fn(),
        onOpenProject: vi.fn(),
        projectCwd: "~",
      }),
    ),
  );
}
it("finishes fresh setup directly and allows reopening from Settings", async () => {
  await render();
  expect(container.textContent).toContain("Finish setup");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("");
  expect(shouldShowOnboarding(fresh)).toBe(false);
  await act(async () => window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT)));
  expect(container.textContent).toContain("Finish setup");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("");
});
it("starts the spotlight tour from the guide and closes it independently", async () => {
  await render(1);
  await act(async () => window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT)));
  await act(async () => container.querySelectorAll("button")[1].click());
  expect(container.textContent).toBe("Close tour");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("");
});
it("records an existing installation and doesn't show setup after its projects are cleared", async () => {
  await render(1);
  expect(configureFileAccess).toHaveBeenCalledOnce();
  expect(configureFileAccess).toHaveBeenCalledWith();
  expect(container.textContent).toBe("");
  expect(shouldShowOnboarding(fresh)).toBe(false);
  await render();
  expect(container.textContent).toBe("");
});
it("opens the guide on demand for existing users and can reopen it after closing", async () => {
  await render(1);
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT)));
    expect(container.textContent).toContain("Close guide");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toBe("");
  }
});
it("offers the guide after setup without overlapping the setup dialog", async () => {
  await render();
  await act(async () => container.querySelectorAll("button")[1].click());
  expect(container.textContent).toBe("Close guideQuick tour");
  expect(shouldShowOnboarding(fresh)).toBe(false);
});

it("broadcasts a guide request after setup so the shell can reveal its targets", async () => {
  const revealWorkspace = vi.fn();
  window.addEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
  try {
    await render();
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(revealWorkspace).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
  }
});

it("replaces an open guide with setup and keeps dismissal independent", async () => {
  await render(1);
  await act(async () => window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT)));
  expect(container.textContent).toContain("Close guide");
  await act(async () => window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT)));
  expect(container.textContent).toContain("Finish setup");
  expect(container.textContent).not.toContain("Close guide");
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("");
});

it("removes both request listeners when the host unmounts", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  try {
    await render(1);
    await act(async () => root.render(null));
    for (const name of [OPEN_ONBOARDING_EVENT, OPEN_USAGE_GUIDE_EVENT]) {
      const registration = add.mock.calls.find(([event]) => event === name);
      expect(registration).toBeDefined();
      expect(remove).toHaveBeenCalledWith(name, registration![1]);
    }
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
});
