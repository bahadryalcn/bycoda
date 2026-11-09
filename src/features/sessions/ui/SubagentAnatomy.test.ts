// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentStep, Block } from "../model/session";
import { SubagentStateLine } from "./SubagentAnatomy";

it("keeps only the latest lifecycle and counters with independent failure tones", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (status: string, busy: boolean, count = 47, failures = 2) => {
    const steps: AgentStep[] = Array.from({ length: count }, (_, index) => ({
      id: `step-${index}`,
      kind: "tool",
      text: "Inspect source",
      status: index < failures ? "failed" : "completed",
    }));
    const block: Block = {
      id: "agent",
      role: "tool",
      text: "Reviewer",
      tool: { kind: "agent", status },
      agentRun: { name: "Reviewer", steps },
    };
    await act(async () => root.render(createElement(SubagentStateLine, { block, busy, steps })));
  };
  const lifecycle = () => container.querySelector("[data-subagent-state] > [data-tone]")!;
  const check = (label: string, tone: string) => {
    expect(lifecycle().textContent).toBe(label);
    expect(lifecycle().getAttribute("data-tone")).toBe(tone);
  };
  try {
    await render("in_progress", true);
    check("Running", "accent");
    expect(container.textContent).toBe("Running47 steps, 2 failed");
    expect(container.querySelector('[data-tone="danger"]')?.textContent).toBe("2 failed");

    await render("in_progress", false);
    check("Interrupted", "warning");
    expect(container.textContent).toBe("Interrupted47 steps, 2 failed");

    await render("completed", false, 59, 4);
    check("Done", "success");
    expect(container.textContent).toBe("Done59 steps, 4 failed");
    expect(container.querySelector('[data-tone="danger"]')?.textContent).toBe("4 failed");

    await render("failed", false);
    check("Failed", "danger");
    expect(container.textContent).toBe("Failed");

    await render("stopped", false);
    check("Stopped by you", "warning");
    expect(container.textContent).toBe("Stopped by you");

    await render("interrupted", false);
    check("Interrupted", "warning");
    expect(container.textContent).not.toContain("Stopped by you");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
