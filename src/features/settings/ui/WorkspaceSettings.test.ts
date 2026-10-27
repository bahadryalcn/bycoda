// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../model/exactGitRewind", () => ({
  loadExactGitRewind: mock.load,
  saveExactGitRewind: mock.save,
}));
vi.mock("./WorkspaceFeatureSettings", () => ({
  WorkspaceFeatureSettings: () => null,
  WorkspaceToolsHelp: () => null,
}));
import { WorkspacePage } from "./WorkspaceSettings";

let root: Root;
let container: HTMLDivElement;
const toggle = () =>
  container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Exact Git rewind (experimental)"]',
  )!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.load.mockReset().mockResolvedValue(false);
  mock.save.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads the disabled Host policy and blocks duplicate saves until acknowledged", async () => {
  await act(async () => root.render(createElement(WorkspacePage)));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  let resolve!: (enabled: boolean) => void;
  mock.save.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    toggle().click();
    toggle().click();
  });
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(mock.save).toHaveBeenCalledWith(true);
  expect(toggle().disabled).toBe(true);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).toContain("Saving…");
  await act(async () => resolve(true));
  expect(toggle().disabled).toBe(false);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

it("retains the previous value after a rejected save and allows another attempt", async () => {
  mock.save.mockRejectedValueOnce(new Error("Synthetic Host busy"));
  await act(async () => root.render(createElement(WorkspacePage)));
  await act(async () => toggle().click());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(toggle().disabled).toBe(false);
  expect(container.textContent).toContain("Synthetic Host busy");
  await act(async () => toggle().click());
  expect(mock.save).toHaveBeenCalledTimes(2);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

it("shows a retryable read error without allowing an unknown policy to be changed", async () => {
  mock.load.mockRejectedValueOnce(new Error("Synthetic Host offline"));
  await act(async () => root.render(createElement(WorkspacePage)));
  expect(toggle().disabled).toBe(true);
  expect(container.textContent).toContain("Synthetic Host offline");
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(mock.load).toHaveBeenCalledTimes(2);
  expect(toggle().disabled).toBe(false);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});
