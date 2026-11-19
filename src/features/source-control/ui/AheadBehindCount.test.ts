// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../../shared/i18n/git";
import { AheadBehindCount } from "./AheadBehindCount";

let host: HTMLDivElement;
let root: Root;

function render(props: Parameters<typeof AheadBehindCount>[0]) {
  act(() => {
    root.render(createElement(AheadBehindCount, props));
  });
  return host;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AheadBehindCount", () => {
  it("names both counts with one localized accessible label and hides the decorative arrows", () => {
    render({ ahead: 2, behind: 1 });
    const img = host.querySelector('[role="img"]');
    expect(img?.getAttribute("aria-label")).toBe(
      `${t("Outgoing commits")}: 2 · ${t("Incoming commits")}: 1`,
    );
    expect(img?.textContent).toBe("↑2↓1");
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("drops zero sides in collapsed headers while the label keeps both counts", () => {
    render({ ahead: 3, behind: 0, hideZero: true });
    const img = host.querySelector('[role="img"]');
    expect(img?.textContent).toBe("↑3");
    expect(img?.getAttribute("aria-label")).toBe(
      `${t("Outgoing commits")}: 3 · ${t("Incoming commits")}: 0`,
    );
  });

  it("renders nothing for collapsed headers with no ahead or behind commits", () => {
    render({ ahead: 0, behind: 0, hideZero: true });
    expect(host.querySelector('[role="img"]')).toBeNull();
  });
});
