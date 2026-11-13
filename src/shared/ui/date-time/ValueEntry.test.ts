// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../i18n";
import { ValueEntry } from "./ValueEntry";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguagePreference("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setLanguagePreference("en");
  vi.unstubAllGlobals();
});
const input = () => host.querySelector("input")!;
const commit = async () =>
  act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
const type = async (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

it("reformats clean entry after locale change without swapping its calendar date", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(ValueEntry, {
        label: "Date",
        mode: "date",
        value: "2026-11-12",
        onChange,
      }),
    ),
  );
  expect(input().value).toBe("11/12/2026");
  await act(async () => setLanguagePreference("tr"));
  expect(input().value).toBe("12.11.2026");
  await commit();
  expect(onChange).toHaveBeenLastCalledWith("2026-11-12");
});

it("keeps a dirty entry and parses it in the format in which it was written", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(ValueEntry, {
        label: "Date",
        mode: "date",
        value: "2026-11-12",
        onChange,
      }),
    ),
  );
  await type("11/13/2026");
  await act(async () => setLanguagePreference("tr"));
  expect(input().value).toBe("11/13/2026");
  await commit();
  expect(onChange).toHaveBeenLastCalledWith("2026-11-13");
  expect(input().value).toBe("13.11.2026");
  expect(input().getAttribute("aria-invalid")).not.toBe("true");
});
