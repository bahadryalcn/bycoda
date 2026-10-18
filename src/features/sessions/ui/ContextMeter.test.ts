// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextMeter } from "./ContextMeter";
import type { Block } from "../model/session";

let container: HTMLDivElement;
let root: Root;
const usage = { used: 231_000, window: 1_000_000 };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function agent(id: string, name: string, used?: number): Block {
  return {
    id,
    role: "tool",
    text: "Agent",
    tool: {
      callId: id,
      kind: "agent",
      title: "Agent",
      status: "completed",
      ...(used === undefined ? {} : { agentContext: { used } }),
    },
    agentRun: { name, steps: [] },
  };
}

it("shows each subagent's latest context across turns without counting commands or duplicates", async () => {
  const blocks: Block[] = [
    agent("a", "Review", 12_000),
    { id: "next", role: "user", text: "Continue" },
    agent("b", "Research", 0),
    agent("c", "Pending measurement"),
    { id: "command", role: "tool", text: "shell", tool: { kind: "shell", title: "shell" } },
    { ...agent("a", "Review", 24_000), id: "a-update" },
  ];
  await act(async () => root.render(createElement(ContextMeter, { usage, contextBlocks: blocks })));
  await act(async () => container.querySelector("button")!.click());
  const rows = () => [...dialog()!.querySelectorAll("li")].map((row) => row.textContent);
  expect(rows()).toEqual([
    "Review24K tokens",
    "Research0 tokens",
    "Pending measurementUnavailable",
  ]);
  expect(dialog()!.textContent).toContain("Subagents · 3");
  expect(dialog()!.querySelector('[role="meter"]')!.getAttribute("aria-valuenow")).toBe("23");
  await act(async () =>
    root.render(
      createElement(ContextMeter, { usage, contextBlocks: [agent("a", "Review", 8_000)] }),
    ),
  );
  expect(rows()).toEqual(["Review8K tokens"]);
});

it("keeps subagent readings accessible when parent usage is unknown and rejects invalid readings", async () => {
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        contextBlocks: [agent("a", "Review", 1234), agent("b", "Invalid", Number.NaN)],
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  expect(dialog()!.textContent).toContain("Review1.2K tokens");
  expect(dialog()!.textContent).toContain("InvalidUnavailable");
  expect(dialog()!.querySelector('[role="meter"]')).toBeNull();
  expect(container.querySelector("button")!.getAttribute("aria-label")).toContain("Unknown");
});

it("uses each child's reported capacity for its percentage and never the parent's capacity", async () => {
  const child = agent("a", "Review", 40_000);
  child.tool!.agentContext = { used: 40_000, window: 200_000 };
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage,
        contextBlocks: [child, agent("b", "Research", 40_000)],
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  expect([...dialog()!.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
    "Review20%40K / 200K tokens",
    "Research40K tokens",
  ]);
});

it("shows usage without a compact capability and supports click, Escape and focus return", async () => {
  await act(async () => root.render(createElement(ContextMeter, { usage })));
  const trigger = container.querySelector("button")!;
  expect(trigger.getAttribute("aria-label")).toContain("23%");
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(dialog()?.textContent).toContain("231K / 1M");
  expect(dialog()?.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("23");
  expect(dialog()?.querySelector("button")).toBeNull();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps the hover panel reachable across the portal gap and compacts once", async () => {
  vi.useFakeTimers();
  const onCompact = vi.fn();
  await act(async () => root.render(createElement(ContextMeter, { usage, onCompact })));
  const trigger = container.querySelector("button")!;
  await act(async () => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(dialog()).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    vi.advanceTimersByTime(100);
    dialog()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(250);
  });
  expect(dialog()).not.toBeNull();
  await act(async () => dialog()!.querySelector("button")!.click());
  expect(onCompact).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});

it("explains why compact is unavailable and preserves cost and API duration", async () => {
  const onCompact = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage,
        onCompact,
        compactDisabled: true,
        sessionUsage: {
          costUsd: 1.8,
          apiMs: 290_000,
          lastProcessCostUsd: 1.8,
          lastProcessApiMs: 290_000,
        },
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  expect(dialog()?.textContent).toContain("$1.80");
  expect(dialog()?.textContent).toContain("4m 50s");
  expect(dialog()?.textContent).toContain("Wait for the current operation to finish");
  const compact = dialog()!.querySelector("button")!;
  expect(compact.disabled).toBe(true);
  await act(async () => compact.click());
  expect(onCompact).not.toHaveBeenCalled();
});

it("distinguishes confirmed empty context from unknown usage", async () => {
  await act(async () => root.render(createElement(ContextMeter, { empty: true })));
  expect(container.textContent).toBe("");
  expect(container.querySelector("[aria-label]")!.getAttribute("aria-label")).toContain("0%");
  await act(async () => root.render(createElement(ContextMeter, {})));
  expect(container.textContent).toBe("");
  await act(async () => root.render(createElement(ContextMeter, { usage: { used: 123 } })));
  expect(container.textContent).toBe("");
});

it("keeps the signal icon uncluttered and exposes completed TPS, context and compact in its panel", async () => {
  const onCompact = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage,
        onCompact,
        contextBlocks: [
          {
            id: "turn",
            role: "user",
            text: "hello",
            durationMs: 4000,
            turnMetrics: { outputTokens: 200 },
          },
        ],
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.textContent).toBe("");
  expect(trigger.getAttribute("aria-label")).toContain("23%");
  expect(trigger.getAttribute("aria-label")).toContain("50.0 TPS");
  await act(async () => trigger.click());
  expect(dialog()!.textContent).toContain("50.0 TPS");
  expect(dialog()!.textContent).toContain("200 output tokens in 4.0s");
  expect(dialog()!.textContent).toContain("including tools and waiting");
  await act(async () => dialog()!.querySelector("button")!.click());
  expect(onCompact).toHaveBeenCalledTimes(1);
});
