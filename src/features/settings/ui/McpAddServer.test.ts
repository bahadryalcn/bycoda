// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddServerModal } from "./McpAddServer";

vi.mock("../../sessions", () => import("../../sessions/ui/HarnessIcon"));
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: (...args: unknown[]) => invoke(...args),
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onAdded = vi.fn(async () => {});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  onClose.mockClear();
  onAdded.mockClear();
  onAdded.mockResolvedValue(undefined);
});

it("retries discovery without adding the server again after a confirmed write", async () => {
  invoke.mockResolvedValue(undefined);
  onAdded.mockRejectedValueOnce(new Error("Discovery unavailable"));
  await render();
  const config = dialog().querySelector<HTMLTextAreaElement>("textarea")!;
  const value = '{"mcpServers":{"docs":{"command":"docs"}}}';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      config,
      value,
    );
    config.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () =>
    dialog()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await act(async () => {
    submit();
  });
  expect(dialog().textContent).toContain("Server added. Refresh failed. Retry to check status.");
  expect(config.disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    submit();
  });
  expect(invoke).toHaveBeenCalledOnce();
  expect(onAdded).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(
      createElement(AddServerModal, {
        cwd: "/selected-project",
        initialProvider: "claude",
        onClose,
        onAdded,
      }),
    );
  });
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

it("keeps global context concise and reveals project identity only for project scope", async () => {
  await render();
  expect(dialog().textContent).not.toContain("/selected-project");
  expect(dialog().textContent).not.toContain("Advanced: configuration requirements");
  const scope = dialog().querySelector<HTMLButtonElement>('[aria-label="Scope: Global"]')!;
  await act(async () => scope.click());
  const project = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (option) => option.textContent === "Project",
  )!;
  await act(async () => project.click());
  expect(dialog().textContent).toContain("/selected-project");
});

it("retains JSON draft and exact provider/scope identity after a rejected save", async () => {
  invoke.mockRejectedValueOnce(new Error("Configuration changed; reload before saving"));
  await render();
  const config = dialog().querySelector<HTMLTextAreaElement>("textarea")!;
  const value = '{"mcpServers":{"docs":{"command":"npx","args":["docs"]}}}';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      config,
      value,
    );
    config.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    dialog()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(invoke).toHaveBeenCalledWith("mcp_add", {
    cwd: "/selected-project",
    provider: "claude",
    scope: "user",
    name: "",
    config: value,
  });
  expect(config.value).toBe(value);
  expect(dialog().textContent).toContain("Configuration changed; reload before saving");
  expect(onClose).not.toHaveBeenCalled();
  expect(onAdded).not.toHaveBeenCalled();
});
