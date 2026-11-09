// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { SendingSettings } from "./SendingSettings";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const snapshot = (patch: Partial<SocialSnapshot> = {}) =>
  ({ sendingEnabled: false, stopped: false, hostOnline: true, ...patch }) as SocialSnapshot;

function render(props: {
  snapshot: SocialSnapshot;
  hostOnline: boolean;
  request?: ReturnType<typeof vi.fn>;
}) {
  const request = props.request ?? vi.fn(async () => ({}));
  const client = { request } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(SendingSettings, {
        client,
        snapshot: props.snapshot,
        hostOnline: props.hostOnline,
        onChanged: vi.fn(),
      }),
    ),
  );
  return request;
}

it("shows the sending copy the owner approved", () => {
  render({ snapshot: snapshot(), hostOnline: true });
  expect(element.textContent).toContain(
    "Approved posts, active rules, automatic programs and autonomous AI can send.",
  );
});

it("says why the controls are disabled when the Host is offline", () => {
  render({ snapshot: snapshot({ sendingEnabled: true }), hostOnline: false });
  const reasons = [...element.querySelectorAll(".social-disabled-reason-text")].map(
    (node) => node.textContent,
  );
  expect(reasons).toContain("Connect to this computer to change sending.");
  const stop = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Stop all sending"),
  );
  expect(stop?.disabled).toBe(true);
});

it("enables approved sends only after the owner ticks the box, with the explicit confirmation", async () => {
  const request = render({ snapshot: snapshot(), hostOnline: true });
  const enable = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Enable approved sends"),
  );
  expect(enable?.disabled).toBe(true);
  const box = element.querySelector<HTMLInputElement>("input[type=checkbox]");
  act(() => {
    box?.click();
  });
  const enabled = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Enable approved sends"),
  );
  expect(enabled?.disabled).toBe(false);
  await act(async () => enabled?.click());
  expect(request).toHaveBeenCalledWith("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
});

function buttonOf(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
}

function renderWith(props: {
  snapshot: SocialSnapshot;
  request?: ReturnType<typeof vi.fn>;
  onChanged?: () => void;
}) {
  const request = props.request ?? vi.fn(async () => ({}));
  const onChanged = props.onChanged ?? vi.fn();
  const client = { request } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(SendingSettings, {
        client,
        snapshot: props.snapshot,
        hostOnline: true,
        onChanged,
      }),
    ),
  );
  return { request, onChanged };
}

it("starts with sending off and sends nothing until the owner enables it", () => {
  const { request } = renderWith({ snapshot: snapshot() });
  expect(element.textContent).toContain("Sending off");
  expect(element.querySelector('[data-status="off"]')).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("keeps the confirmation box from sending by itself", () => {
  const { request } = renderWith({ snapshot: snapshot() });
  act(() => {
    element.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
  });
  expect(request).not.toHaveBeenCalled();
});

it("explains the missing tick as the reason the enable button is disabled", () => {
  renderWith({ snapshot: snapshot() });
  const reasons = [...element.querySelectorAll(".social-disabled-reason-text")].map(
    (node) => node.textContent,
  );
  expect(reasons).toContain("Tick the box above to allow sending.");
});

it("offers no enable control once approved sends are on, and shows that state", () => {
  renderWith({ snapshot: snapshot({ sendingEnabled: true }) });
  expect(buttonOf("Enable approved sends")).toBeUndefined();
  expect(element.querySelector("input[type=checkbox]")).toBeNull();
  expect(element.textContent).toContain("Approved sends on");
});

it("stops all sending and refreshes the screen", async () => {
  const { request, onChanged } = renderWith({ snapshot: snapshot({ sendingEnabled: true }) });
  await act(async () => buttonOf("Stop all sending")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("execution.stop", { stopped: true });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("shows a stopped Host as paused, keeps its pending jobs and resumes through the same action", async () => {
  const { request } = renderWith({ snapshot: snapshot({ sendingEnabled: true, stopped: true }) });
  expect(element.querySelector('[data-status="paused"]')).not.toBeNull();
  expect(element.textContent).toContain("Pending jobs are kept");
  await act(async () => buttonOf("Resume sending")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("execution.stop", { stopped: false });
});

it("shows the failure and does not refresh when the Host refuses to enable sending", async () => {
  const request = vi.fn(async () => {
    throw new Error("Sending is blocked on this computer.");
  });
  const { onChanged } = renderWith({ snapshot: snapshot(), request });
  act(() => {
    element.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
  });
  await act(async () => buttonOf("Enable approved sends")?.click());
  expect(element.textContent).toContain("Sending is blocked on this computer.");
  expect(onChanged).not.toHaveBeenCalled();
});
