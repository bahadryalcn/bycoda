// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  isConnectionErrorShownCentrally,
  setConnectionErrorGate,
  useConnectionErrorShownCentrally,
} from "./connectionErrorGate";
import { FailureState } from "./FailureState";
import { InlineError } from "./InlineError";

const DOWN = "Could not reach the machine";
const isDown = (error: unknown) => String(error).includes(DOWN);

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  setConnectionErrorGate(null);
  vi.unstubAllGlobals();
});

async function mount(node: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    done: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

it("hides nothing without a gate and never hides an empty error", () => {
  expect(isConnectionErrorShownCentrally(DOWN)).toBe(false);
  setConnectionErrorGate(() => true);
  expect(isConnectionErrorShownCentrally(DOWN)).toBe(true);
  for (const empty of [undefined, null, ""])
    expect(isConnectionErrorShownCentrally(empty)).toBe(false);
});

it("hides only errors the gate matches", () => {
  setConnectionErrorGate(isDown);
  expect(isConnectionErrorShownCentrally(new Error(DOWN))).toBe(true);
  expect(isConnectionErrorShownCentrally("Disk is full")).toBe(false);
});

it("rerenders hook users when the gate is installed and removed", async () => {
  function Probe() {
    return createElement("p", null, useConnectionErrorShownCentrally(DOWN) ? "central" : "inline");
  }
  const { container, done } = await mount(createElement(Probe));
  try {
    expect(container.textContent).toBe("inline");
    await act(async () => setConnectionErrorGate(isDown));
    expect(container.textContent).toBe("central");
    await act(async () => setConnectionErrorGate(null));
    expect(container.textContent).toBe("inline");
  } finally {
    done();
  }
});

it("makes InlineError and FailureState render nothing while the gate matches, then return", async () => {
  const { container, done } = await mount(
    createElement(
      "div",
      null,
      createElement(InlineError, { details: DOWN }),
      createElement(InlineError, { details: "Disk is full" }),
      createElement(FailureState, {
        size: "inline",
        title: "Failed",
        description: "Retry it",
        error: new Error(DOWN),
      }),
    ),
  );
  try {
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(3);
    await act(async () => setConnectionErrorGate(isDown));
    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain("Disk is full");
    await act(async () => setConnectionErrorGate(null));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(3);
  } finally {
    done();
  }
});

it("does not gate a plain-copy InlineError without an error, nor a full-screen FailureState", async () => {
  setConnectionErrorGate(() => true);
  const { container, done } = await mount(
    createElement(
      "div",
      null,
      createElement(InlineError, { children: undefined, details: "" }),
      createElement(FailureState, {
        fullScreen: true,
        title: "Boot failed",
        description: "Restart",
        error: new Error(DOWN),
      }),
    ),
  );
  try {
    expect(container.querySelector("h1")?.textContent).toBe("Boot failed");
  } finally {
    done();
  }
});
