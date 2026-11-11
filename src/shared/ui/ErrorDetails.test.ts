// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { DetailedInlineError, ErrorDetails } from "./ErrorDetails";

let root: Root;
let host: HTMLDivElement;
const writeText = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const inDialog = (text: string) =>
  [...dialog()!.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text))!;

it("keeps the raw text out of the layout until Details is opened", async () => {
  await act(async () =>
    root.render(
      createElement(ErrorDetails, {
        title: "Can’t reach Server",
        detail: "ssh: timed out",
      }),
    ),
  );
  expect(host.textContent).toBe("Details");
  expect(trigger().getAttribute("aria-label")).toBe("Details: Can’t reach Server");
  expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(dialog()).toBeNull();

  await act(async () => trigger().click());
  expect(dialog()?.getAttribute("aria-label")).toBe("Details: Can’t reach Server");
  expect(dialog()?.querySelector("pre")?.textContent).toBe("ssh: timed out");
  expect(trigger().getAttribute("aria-controls")).toBe(dialog()?.id);

  await act(async () => trigger().click());
  expect(dialog()).toBeNull();
});

it("copies the complete text and confirms it", async () => {
  const detail = `line one\n${"x".repeat(9000)}`;
  await act(async () => root.render(createElement(ErrorDetails, { detail })));
  await act(async () => trigger().click());
  await act(async () => inDialog("Copy details").click());
  expect(writeText).toHaveBeenCalledWith(detail);
  expect(inDialog("Copied")).toBeTruthy();
});

it("reports a failed copy instead of claiming success", async () => {
  writeText.mockRejectedValue(new Error("Clipboard blocked"));
  await act(async () => root.render(createElement(ErrorDetails, { detail: "boom" })));
  await act(async () => trigger().click());
  await act(async () => inDialog("Copy details").click());
  expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("Clipboard blocked");
});

it("lets a recovery action close the popover before it opens another surface", async () => {
  const onEdit = vi.fn();
  await act(async () =>
    root.render(
      createElement(ErrorDetails, {
        detail: "boom",
        actions: (close: () => void) =>
          createElement(
            Button,
            {
              onClick: () => {
                close();
                onEdit();
              },
            },
            "Edit address…",
          ),
      }),
    ),
  );
  await act(async () => trigger().click());
  await act(async () => inDialog("Edit address…").click());
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});

it("shows a short single-line raw error as written, without a Details link", async () => {
  await act(async () => root.render(createElement(DetailedInlineError, { error: "Port in use" })));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Port in use");
  expect(host.querySelector("button")).toBeNull();
});

it("shows only the first line of long raw output and keeps the rest behind Details", async () => {
  const error = `fatal: ${"a".repeat(300)}
hint: second line`;
  await act(async () => root.render(createElement(DetailedInlineError, { error })));
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).not.toContain("hint: second line");
  expect(alert.textContent!.length).toBeLessThan(140);
  await act(async () => trigger().click());
  expect(dialog()?.querySelector("pre")?.textContent).toBe(error);
});

it("prefers the plain summary and still offers the raw text", async () => {
  await act(async () =>
    root.render(
      createElement(DetailedInlineError, {
        summary: "Could not load.",
        error: "ECONNRESET",
      }),
    ),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not load. Details");
  await act(async () => trigger().click());
  expect(dialog()?.querySelector("pre")?.textContent).toBe("ECONNRESET");
});
