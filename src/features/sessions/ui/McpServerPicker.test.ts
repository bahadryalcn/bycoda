// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { McpServerPicker } from "./McpServerPicker";
import type { McpConnection } from "../../settings/public/mcp";

const connections: McpConnection[] = [
  {
    provider: "claude",
    name: "docs",
    scope: "user",
    configPath: "/claude",
    transport: "stdio",
  },
  {
    provider: "claude",
    name: "needs-login",
    scope: "project",
    configPath: "/repo/.mcp.json",
    transport: "http",
  },
];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("shows localized scope labels and keeps only attention states on picker rows", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(McpServerPicker, {
        connections,
        harness: "claude",
        claudeStatus: new Map([["needs-login", "Needs authentication"]]),
        loading: false,
        error: "",
        onPick: () => undefined,
        onManage: () => undefined,
        onDismiss: () => undefined,
      }),
    );
  });

  const text = container.textContent ?? "";
  expect(text).toContain("Claude Code · Global");
  expect(text).toContain("Claude Code · Project");
  expect(text).not.toContain("· user");
  expect(text).not.toContain("· project");
  expect(text).toContain("Needs authentication");
  expect(text).not.toContain("Available");
});

it("closes from the shared picker close control and bounds the list to the standard height", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onDismiss = vi.fn();
  await act(async () => {
    root!.render(
      createElement(McpServerPicker, {
        connections,
        harness: "claude",
        claudeStatus: new Map(),
        loading: false,
        error: "",
        onPick: () => undefined,
        onManage: () => undefined,
        onDismiss,
      }),
    );
  });

  expect(container.querySelector('[data-list-height="standard"]')).not.toBeNull();
  const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close MCP picker"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(onDismiss).toHaveBeenCalledWith("escape");
});
