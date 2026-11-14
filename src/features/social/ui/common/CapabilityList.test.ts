// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Capability } from "../../model/social";
import { CapabilityList } from "./CapabilityList";
import { capabilityReasonText, needsConnection } from "./capabilityText";

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

type Row = Pick<Capability, "operation" | "status" | "reasonCode">;

it("states a shared connection reason once for grouped operations", () => {
  act(() =>
    root.render(
      createElement(CapabilityList, {
        grouped: true,
        capabilities: [
          { operation: "publish", status: "expired", reasonCode: "browser.reconnect" },
          { operation: "reply", status: "expired", reasonCode: "browser.reconnect" },
        ],
      }),
    ),
  );
  act(() => element.querySelector("button")?.click());
  expect(element.querySelectorAll("li")).toHaveLength(2);
  expect(element.querySelector("ul")?.textContent).not.toContain("Connection needed");
  expect(element.textContent).toContain("Publishing");
  expect(element.textContent).toContain("Replies");
});

it.each<[Row, string]>([
  [{ operation: "publish", status: "available", reasonCode: "api.ready" }, "Ready"],
  [
    { operation: "message.start", status: "unsupported", reasonCode: "unsupported.platform" },
    "Not available on this platform",
  ],
  [
    { operation: "message.start", status: "expired", reasonCode: "browser.reconnect" },
    "Connection needed",
  ],
  [
    { operation: "message.start", status: "expired", reasonCode: "browser.session_expired" },
    "Connection needed",
  ],
  [
    { operation: "publish", status: "expired", reasonCode: "api.token_expired" },
    "Connection needed",
  ],
  [
    { operation: "publish", status: "unsupported", reasonCode: "unsupported.not_yet" },
    "Not available yet",
  ],
  [
    { operation: "media", status: "unsupported", reasonCode: "browser.no_recipe" },
    "Not available in the browser yet",
  ],
  [
    { operation: "publish", status: "unsupported", reasonCode: "api.account_type_unsupported" },
    "Not available for this account type",
  ],
  [
    { operation: "webhook", status: "pending", reasonCode: "x.webhook.external_setup" },
    "Finish setup on the platform",
  ],
  [
    { operation: "reply", status: "unsupported", reasonCode: "instagram.reply.api_required" },
    "Connection needed",
  ],
  [{ operation: "reply", status: "pending", reasonCode: "some.new.code" }, "Checking…"],
])("maps reason code %s to plain text", (row, text) => {
  expect(capabilityReasonText(row)).toBe(text);
});

it("never shows the raw reason code", () => {
  act(() =>
    root.render(
      createElement(CapabilityList, {
        capabilities: [
          { operation: "message.start", status: "unsupported", reasonCode: "unsupported.platform" },
        ],
      }),
    ),
  );
  expect(element.textContent).not.toContain("unsupported.platform");
  expect(element.textContent).toContain("Direct messages");
});

it("marks available rows with a check and unavailable rows with the reason and Connect", () => {
  const onConnect = vi.fn();
  act(() =>
    root.render(
      createElement(CapabilityList, {
        onConnect,
        capabilities: [
          { operation: "publish", status: "available", reasonCode: "api.ready" },
          { operation: "message.start", status: "expired", reasonCode: "browser.reconnect" },
        ],
      }),
    ),
  );
  const rows = element.querySelectorAll("li");
  expect(rows[0]?.getAttribute("data-available")).toBe("true");
  expect(rows[0]?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Available");
  expect(rows[0]?.querySelector("button")).toBeNull();
  expect(rows[1]?.getAttribute("data-available")).toBe("false");
  expect(rows[1]?.textContent).toContain("Connection needed");
  const connect = rows[1]?.querySelector("button");
  expect(connect?.textContent?.trim()).toBe("Connect");
  act(() => connect?.click());
  expect(onConnect).toHaveBeenCalledTimes(1);
});

it("offers Connect only for connection fixes", () => {
  expect(needsConnection({ status: "unsupported", reasonCode: "unsupported.platform" })).toBe(
    false,
  );
  expect(needsConnection({ status: "expired", reasonCode: "api.token_expired" })).toBe(true);
});
