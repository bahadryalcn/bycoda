// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingCrash } from "../model/diagnosticsScheduler";
import { CrashReportNotice } from "./CrashReportNotice";

type ToastProps = {
  tone: string;
  message: string;
  actions: { label: string; onClick?: () => void }[];
};

const service = vi.hoisted(() => ({
  pending: null as unknown,
  listeners: new Set<() => void>(),
  sendPendingCrash: vi.fn(),
}));

vi.mock("../model/diagnosticsService", () => ({
  getPendingCrash: () => service.pending,
  subscribeDiagnostics: (listener: () => void) => {
    service.listeners.add(listener);
    return () => service.listeners.delete(listener);
  },
  sendPendingCrash: service.sendPendingCrash,
  dismissPendingCrash: vi.fn(async () => undefined),
}));

vi.mock("../../../shared/ui/ToastRegion", async () => {
  const { createElement } = await import("react");
  return {
    Toast: (props: ToastProps) =>
      createElement(
        "div",
        { "data-tone": props.tone },
        createElement("p", null, props.message),
        ...props.actions.map((action) =>
          createElement("button", { key: action.label, onClick: action.onClick }, action.label),
        ),
      ),
  };
});

const crash = (occurredAt: string): PendingCrash => ({
  message: "boom",
  occurredAt,
  native: null,
  hostCrash: null,
  renderError: null,
});

const mounted: { unmount: () => void; container: HTMLElement }[] = [];
const mount = () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<CrashReportNotice />));
  mounted.push({ unmount: () => act(() => root.unmount()), container });
  return container;
};
const setPending = (next: PendingCrash | null) => {
  service.pending = next;
  act(() => service.listeners.forEach((listener) => listener()));
};
const clickAction = async (container: HTMLElement, label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  await act(async () => button!.click());
};

afterEach(() => {
  for (const { unmount, container } of mounted.splice(0)) {
    unmount();
    container.remove();
  }
  service.pending = null;
  service.listeners.clear();
  service.sendPendingCrash.mockReset();
});

describe("CrashReportNotice", () => {
  it("a failed send shows the failure, and the next crash starts with the question again", async () => {
    const first = crash("2026-11-18T10:00:00.000Z");
    service.pending = first;
    const container = mount();
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("info");

    service.sendPendingCrash.mockResolvedValueOnce("failed");
    await clickAction(container, "Send");
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("danger");

    setPending(crash("2026-11-18T12:00:00.000Z"));
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("info");
  });

  it("a rejected send keeps the notice open with its actions for a retry", async () => {
    service.pending = crash("2026-11-18T10:00:00.000Z");
    const container = mount();
    service.sendPendingCrash.mockRejectedValueOnce(new Error("offline"));
    await clickAction(container, "Send");
    expect(container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });
});
