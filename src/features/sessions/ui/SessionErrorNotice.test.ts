// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionErrorNotice } from "./SessionErrorNotice";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps protocol output behind an accessible native details button", async () => {
  const raw =
    'HTTP 503 {"error":{"message":"Provider temporarily unavailable"},"request_id":"request_42"}';
  await act(async () => root.render(createElement(SessionErrorNotice, { text: raw })));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Provider temporarily unavailable",
  );
  expect(host.textContent).not.toContain("HTTP 503");
  const button = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  expect(button.tagName).toBe("BUTTON");
  expect(button.getAttribute("aria-label")).toBe(
    "Technical details: Provider temporarily unavailable",
  );
  button.focus();
  expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(raw);
});

it("shows an unknown plain error exactly without generic replacement or hidden detail", async () => {
  const text = "Workspace policy changed. Select a working copy before sending.";
  await act(async () => root.render(createElement(SessionErrorNotice, { text })));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(text);
  expect(host.querySelector("button")).toBeNull();
});

it("keeps long raw diagnostics complete while the summary stays short", async () => {
  const raw = JSON.stringify({
    message: "The selected model is unavailable",
    diagnostic: "Aleksandra Wiśniewska-Kowalczyk / çalışma alanı / الحساب 👩🏽‍💻\n".repeat(80),
  });
  await act(async () => root.render(createElement(SessionErrorNotice, { text: raw })));
  expect(host.textContent).not.toContain("diagnostic");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(raw);
});
