// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DeviceNotices } from "./DeviceNotices";

const refreshFrame = { pending: false, disabled: false, onClick: vi.fn() };
const setupControl = { pending: false, disabled: false, onClick: vi.fn() };

function render(props: Partial<Parameters<typeof DeviceNotices>[0]>) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(DeviceNotices, { actionCompleted: false, refreshFrame, ...props }),
  );
  return host;
}

it("shows a device error above the setup banner instead of hiding it", () => {
  const host = render({
    setupControl,
    notice: { error: true, display: "Tap failed: lease invalid", onDismiss: vi.fn() },
  });
  const error = host.querySelector('[data-tone="danger"]');
  expect(error?.textContent).toContain("Tap failed: lease invalid");
  expect(host.textContent).toContain("Set up device control");
  expect(error!.compareDocumentPosition(host.lastElementChild!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("keeps the stale-frame refresh action visible next to a device error", () => {
  const host = render({
    actionCompleted: true,
    notice: { error: true, display: "Screenshot failed", onDismiss: vi.fn() },
  });
  expect(host.querySelector('[data-tone="danger"]')?.textContent).toContain("Screenshot failed");
  expect(host.querySelector('[data-tone="warning"]')?.textContent).toContain("Action completed");
  expect(host.textContent).toContain("Refresh frame");
});

it("keeps the setup banner ahead of an informational notice when there is no error", () => {
  const host = render({
    setupControl,
    notice: { error: false, display: "Screen captured", onDismiss: vi.fn() },
  });
  expect(host.textContent).toContain("Set up device control");
  expect(host.textContent).not.toContain("Screen captured");
  expect(host.querySelector('[data-tone="danger"]')).toBeNull();
});

it("renders only the toolbar reason when nothing else is pending", () => {
  const host = render({ reason: "Control is unavailable on this device" });
  expect(host.textContent).toContain("Control is unavailable on this device");
  expect(host.querySelector('[data-tone="danger"]')).toBeNull();
});
