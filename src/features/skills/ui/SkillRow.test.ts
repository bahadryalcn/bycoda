// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../shared/i18n";
import type { SkillEntry } from "../model/skillLibrary";
import { SkillRow } from "./SkillRow";

const entry = {
  key: "user\nagents\npersonal guide",
  name: "Personal guide",
  scope: "user",
  primary: {
    skill: {
      name: "Personal guide",
      description: "",
      path: "C:/Users/test/.agents/skills/guide/SKILL.md",
      scope: "user",
      source: "agents",
    },
    machine: null,
  },
  copies: [],
} as SkillEntry;

const mounted: { root: Root; container: HTMLElement }[] = [];

function renderRow(state: { modified?: boolean; off?: boolean }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(SkillRow, {
        entry,
        selected: false,
        modified: state.modified ?? false,
        off: state.off ?? false,
        busy: false,
        cells: null,
        previewId: "preview",
        previewOpen: false,
        disabled: false,
        actionsOpen: false,
        nameRef: () => {},
        onOpen: () => {},
        onActions: () => {},
        copy: {
          transferable: false,
          blocked: null,
          loading: false,
          disabled: false,
          onCopy: () => {},
        },
      }),
    );
  });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("SkillRow accessible state", () => {
  it("announces the draft and off marks in the row's name button", () => {
    const plain = renderRow({});
    const button = plain.querySelector("[data-action-primary]");
    expect(button?.getAttribute("aria-label")).toBe("Personal guide");

    const draft = renderRow({ modified: true });
    expect(draft.querySelector("[data-action-primary]")?.getAttribute("aria-label")).toBe(
      `Personal guide, ${t("Draft")}`,
    );

    const off = renderRow({ off: true });
    expect(off.querySelector("[data-action-primary]")?.getAttribute("aria-label")).toBe(
      `Personal guide, ${t("Off")}`,
    );
  });

  it("hides the visual Off label so the name button is the only announcement", () => {
    const container = renderRow({ off: true });
    const offLabel = Array.from(container.querySelectorAll("*")).find(
      (element) => element.textContent === t("Off") && !element.closest("[data-action-primary]"),
    );
    expect(offLabel?.getAttribute("aria-hidden")).toBe("true");
  });
});
