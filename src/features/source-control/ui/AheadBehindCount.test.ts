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
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      t("Outgoing commits: {p0} · Incoming commits: {p1}", { p0: "2", p1: "1" }),
    );
    expect(
      [...host.querySelectorAll('[aria-hidden="true"]')].map((node) => node.textContent),
    ).toEqual(["↑2", "↓1"]);
  });

  // #755: one interpolated key, not concatenated nouns, so word order can be translated.
  it("builds the label from one interpolated key", () => {
    render({ ahead: 2, behind: 1 });
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      "Outgoing commits: 2 · Incoming commits: 1",
    );
  });

  it("drops zero sides in collapsed headers while the label keeps both counts", () => {
    render({ ahead: 3, behind: 0, hideZero: true });
    expect(
      [...host.querySelectorAll('[aria-hidden="true"]')].map((node) => node.textContent),
    ).toEqual(["↑3"]);
    expect(host.querySelector(".sr-only")?.textContent).toBe(
      t("Outgoing commits: {p0} · Incoming commits: {p1}", { p0: "3", p1: "0" }),
    );
  });

  it("renders nothing for collapsed headers with no ahead or behind commits", () => {
    render({ ahead: 0, behind: 0, hideZero: true });
    expect(host.firstElementChild).toBeNull();
  });
});
