// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderBinaryControl } from "./ProviderBinarySettings";
import { loadProviderBinaryPath } from "../../providers/model/providerBinaryPaths";

const mock = vi.hoisted(() => ({ inspect: vi.fn(), pick: vi.fn() }));
vi.mock("../../../integrations/harness/core/child", () => ({ inspectHarnessBinary: mock.inspect }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mock.pick }));
vi.mock("../../../platform/tauri/fs", () => ({ revealPath: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const saved = vi.fn();
const cancelled = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  localStorage.clear();
  mock.inspect.mockResolvedValue({ path: "D:/custom/codex.exe", version: "codex-cli 1.0.0" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(inline = true) {
  await act(async () =>
    root.render(
      createElement(ProviderBinaryControl, {
        provider: "codex",
        inline,
        onPathSaved: saved,
        onCancel: cancelled,
      }),
    ),
  );
}
async function fill(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="CLI path"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.includes(label),
  )!;
  await act(async () => button.click());
}

it("validates the chosen executable before adding it and keeps picker cancellation harmless", async () => {
  await render();
  expect(
    [...container.querySelectorAll("button")].find((node) => node.textContent === "Add provider")!
      .disabled,
  ).toBe(true);
  mock.pick.mockResolvedValueOnce(null).mockResolvedValueOnce("D:/custom/codex.exe");
  await click("Choose executable");
  expect(saved).not.toHaveBeenCalled();
  expect(mock.inspect).not.toHaveBeenCalled();
  await click("Choose executable");
  await click("Add provider");
  expect(mock.inspect).toHaveBeenCalledWith("codex", "D:/custom/codex.exe");
  expect(loadProviderBinaryPath("codex")).toBe("D:/custom/codex.exe");
  expect(saved).toHaveBeenCalledOnce();
});

it("retains the path and inline error when validation fails", async () => {
  await render();
  await fill("D:/wrong.exe");
  mock.inspect.mockResolvedValue({ path: "D:/wrong.exe", error: "Choose a Codex executable" });
  await click("Add provider");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Choose a Codex executable");
  expect(loadProviderBinaryPath("codex")).toBeNull();
  expect(saved).not.toHaveBeenCalled();
});

it("does not save a late validation result after the add dialog is dismissed", async () => {
  let complete!: (value: unknown) => void;
  mock.inspect.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await render();
  await fill("D:/custom/codex.exe");
  await click("Add provider");
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.getAttribute("aria-busy")).toBe("true");
  expect([...document.querySelectorAll('button[aria-busy="true"]')]).toHaveLength(1);
  await act(async () => submit.click());
  expect(mock.inspect).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => complete({ path: "D:/custom/codex.exe", version: "codex-cli 1.0.0" }));
  expect(loadProviderBinaryPath("codex")).toBeNull();
  expect(saved).not.toHaveBeenCalled();
});

it("preserves the existing settings popover save flow", async () => {
  await render(false);
  await click("Show Codex CLI details");
  await click("Edit Codex CLI path");
  await fill("D:/custom/codex.exe");
  await click("Save path");
  expect(loadProviderBinaryPath("codex")).toBe("D:/custom/codex.exe");
  expect(saved).toHaveBeenCalledOnce();
});
