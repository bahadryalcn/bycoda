// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingHost } from "./OnboardingHost";
import { configureFileAccess } from "../../../platform/tauri/fileAccess";

vi.mock("../../../platform/tauri/fileAccess", () => ({
  configureFileAccess: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.mocked(configureFileAccess).mockReset();
});

// Raw error text sits behind the Details popover; open it and read the dialog it shows.
async function detailsText() {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label^="Details"]');
  if (!trigger) return "";
  await act(async () => trigger.click());
  return [...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent ?? "";
}

it("shows a readable file-access failure without the Error prefix", async () => {
  vi.mocked(configureFileAccess).mockRejectedValue(new Error("Consent dialog was dismissed"));
  await act(async () =>
    root.render(
      createElement(OnboardingHost, {
        context: { projects: 1, sessions: 0, restored: false, transferred: false },
        onImported: vi.fn(),
        onOpenProject: vi.fn(),
        projectCwd: "~",
      }),
    ),
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain("Could not set up file access.");
  expect(text).not.toContain("Error:");
  expect(await detailsText()).toContain("Consent dialog was dismissed");
});
