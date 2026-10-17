// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer, Empty, Notice, StatusBadge, closeComposer } from "./socialShared";
import { SocialFeedbackContext } from "./socialContext";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["failed", "danger", "Başarısız"],
  ["partial", "warning", "Kısmen gönderildi"],
  ["running", "info", "Gönderiliyor"],
  ["approved", "success", "Onaylı"],
  ["paused", "neutral", "Durduruldu"],
])("retains domain status %s and maps its shared semantic tone", async (status, tone, label) => {
  await act(async () => root.render(createElement(StatusBadge, { status })));
  const badge = container.querySelector(".social-status-badge")!;
  expect(badge.textContent).toBe(label);
  expect(badge.getAttribute("data-status")).toBe(status);
  expect(badge.className).toContain(tone);
  expect(badge.classList.contains("bycoda-arc")).toBe(true);
});

it("keeps explicit status labels and unknown status values", async () => {
  await act(async () =>
    root.render(createElement(StatusBadge, { status: "custom", label: "Özel durum" })),
  );
  expect(container.textContent).toBe("Özel durum");
  await act(async () => root.render(createElement(StatusBadge, { status: "custom" })));
  expect(container.textContent).toContain("custom");
});

it("announces error and loading while keeping recovery callbacks and optional titles", async () => {
  const retry = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        Notice,
        { kind: "error" },
        createElement("button", { onClick: retry }, "Yeniden dene"),
      ),
    ),
  );
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector("strong")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(retry).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(createElement(Notice, { kind: "loading", title: "İşlem sürüyor…" })),
  );
  expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  expect(container.textContent).toContain("İşlem sürüyor…");
});

it("keeps empty-state child content and optional icon/title contracts", async () => {
  const click = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        Empty,
        { title: "Kayıt yok" },
        createElement("a", { href: "#new", onClick: click }, "Yeni kayıt"),
      ),
    ),
  );
  expect(container.querySelector("h3")!.textContent).toBe("Kayıt yok");
  expect(container.querySelector("svg")).toBeNull();
  expect(container.querySelector(".social-empty")!.getAttribute("data-placeholder")).toBe("true");
  await act(async () => container.querySelector("a")!.click());
  expect(click).toHaveBeenCalledOnce();
});

it("preserves caller live-region semantics and delegates controlled dismiss to the shared action", async () => {
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(Alert, {
        tone: "danger",
        title: "Connection lost",
        role: "status",
        open: true,
        onDismiss: dismiss,
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  const button = container.querySelector("button")!;
  expect(button.getAttribute("data-button-variant")).toBe("ghost");
  expect(button.getAttribute("aria-label")).toBe("Dismiss: Connection lost");
  await act(async () => button.click());
  expect(dismiss).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it("keeps the empty-state action mounted and operable when content updates", async () => {
  const action = createElement("input", {
    defaultValue: "Draft action",
    "aria-label": "Draft action",
  });
  await act(async () =>
    root.render(
      createElement(EmptyState, {
        title: "No results",
        description: "Clear a filter",
        action,
        label: "Search results",
      }),
    ),
  );
  const input = container.querySelector("input")!;
  input.value = "Pending draft";
  input.focus();
  await act(async () =>
    root.render(
      createElement(EmptyState, {
        title: "No projects",
        description: "Create a project",
        action,
        label: "Search results",
      }),
    ),
  );
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("Pending draft");
  expect(document.activeElement).toBe(input);
  expect(container.querySelector('section[aria-label="Search results"]')).not.toBeNull();
});

it("preserves the native composer draft and summary focus after closing", async () => {
  await act(async () =>
    root.render(
      createElement(
        SocialFeedbackContext.Provider,
        { value: { busy: false, error: "", notice: "" } },
        createElement(
          Composer,
          { title: "Düzenle" },
          createElement("form", null, createElement("input", { defaultValue: "Taslak" })),
        ),
      ),
    ),
  );
  const details = container.querySelector("details")!;
  const form = container.querySelector("form")!;
  const input = container.querySelector("input")!;
  input.value = "Saklanan taslak";
  details.open = true;
  await act(async () => closeComposer(form));
  expect(details.open).toBe(false);
  expect(input.value).toBe("Saklanan taslak");
  expect(document.activeElement).toBe(container.querySelector("summary"));
});
