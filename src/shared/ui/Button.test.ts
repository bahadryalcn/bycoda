// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Button, type ButtonProps } from "./Button";
import { ButtonGroup, ButtonGroupSelection } from "./ButtonGroup";

it("swaps confirmed success in place, gives pending priority and resets when edited", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (success: boolean, loading = false) =>
    createElement(
      Button,
      {
        success,
        successLabel: "Saved",
        loading,
        loadingLabel: "Saving…",
        motion: "none",
        "aria-label": "Save profile settings",
      },
      "Save",
    );
  try {
    await act(async () => root.render(render(false)));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Save");
    await act(async () => root.render(render(true)));
    expect(container.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("Saved");
    expect(button.getAttribute("aria-label")).toBe("Saved");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved");
    expect(container.querySelector('[role="status"]')?.className).toBe("sr-only");
    await act(async () => root.render(render(true, true)));
    expect(button.textContent).toBe("Save");
    expect(button.getAttribute("aria-label")).toBe("Saving…");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    await act(async () => root.render(render(false)));
    expect(button.textContent).toBe("Save");
    expect(button.getAttribute("aria-label")).toBe("Save profile settings");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("preserves legacy danger and error aliases while letting explicit intent win", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    const cases: [ButtonProps, string, string][] = [
      [{ variant: "primary" }, "primary", "neutral"],
      [{ variant: "danger" }, "secondary", "danger"],
      [{ variant: "danger", tone: "info" }, "secondary", "info"],
      [{ variant: "danger", tone: "warning" }, "secondary", "warning"],
      [{ variant: "ghost", tone: "error" }, "ghost", "danger"],
      [{ variant: "tab", tone: "warning", selected: true }, "tab", "warning"],
    ];
    for (const [props, hierarchy, tone] of cases) {
      await act(async () =>
        root.render(createElement(Button, { ...props, motion: "none" }, "Action")),
      );
      const button = container.querySelector("button")!;
      expect(button.dataset.buttonHierarchy).toBe(hierarchy);
      expect(button.dataset.buttonTone).toBe(tone);
      expect(button.hasAttribute("tone")).toBe(false);
    }
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps a toned submit action focusable and prevents duplicate submissions until its owner clears pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  const submit = vi.fn((event: Event) => event.preventDefault());
  const render = (loading: boolean) =>
    createElement(
      "form",
      { onSubmit: submit },
      createElement(
        Button,
        {
          ref,
          type: "submit",
          variant: "primary",
          tone: "danger",
          motion: "none",
          loading,
          loadingLabel: "Deleting connection",
          onClick: click,
        },
        "Delete connection",
      ),
    );
  try {
    await act(async () => root.render(render(true)));
    ref.current!.focus();
    await act(async () => {
      ref.current!.click();
      ref.current!.click();
    });
    expect(click).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ref.current);
    expect(ref.current!.getAttribute("aria-label")).toBe("Deleting connection");
    await act(async () => root.render(render(false)));
    await act(async () => ref.current!.click());
    expect(click).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(ref.current);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each(["auto", "none"] as const)(
  "retains focus and blocks duplicate actions when disabled and loading overlap (%s)",
  async (motion) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const click = vi.fn();
    const render = (loading: boolean, disabled: boolean) =>
      createElement(Button, { motion, loading, disabled, onClick: click }, "Refresh");
    try {
      await act(async () => root.render(render(false, false)));
      const button = container.querySelector("button")!;
      button.focus();
      await act(async () => root.render(render(true, true)));
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(button);
      await act(async () => button.click());
      expect(click).not.toHaveBeenCalled();
      await act(async () => root.render(render(false, true)));
      expect(button.disabled).toBe(true);
      await act(async () => root.render(render(false, false)));
      await act(async () => button.click());
      expect(click).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  ["tab", "start"],
  ["tab", "end"],
  ["tab", "center"],
  ["item", "end"],
  ["item", "center"],
  ["secondary", "start"],
] as const)("exposes explicit %s alignment %s to the stylesheet", async (variant, align) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Button, { variant, align }, "Action")));
    expect(container.querySelector("button")!.dataset.buttonAlign).toBe(align);
    await act(async () => root.render(createElement(Button, { variant }, "Action")));
    expect(container.querySelector("button")!.hasAttribute("data-button-align")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

// jsdom does not resolve selector specificity, so the cascade contract is checked on the
// parsed stylesheet: a structural alignment default may never reach an explicitly aligned
// control, and explicit alignment rules must follow the structural defaults they override.
it("keeps explicit alignment authoritative over structural item and tab defaults", () => {
  const source = readFileSync(join(process.cwd(), "src/shared/ui/Button.module.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");
  // Innermost blocks only: at-rule wrappers (@layer, @media) never match a declaration body.
  const rules = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match, index) => ({
    selector: match[1].trim(),
    props: match[2].split(";").flatMap((decl) => decl.split(":")[0].trim() || []),
    order: index,
  }));
  const structural = rules.filter(
    (rule) =>
      rule.props.includes("justify-content") &&
      /\.(tab|item)/.test(rule.selector) &&
      !rule.selector.includes("data-button-align="),
  );
  expect(structural.length).toBeGreaterThan(0);
  for (const rule of structural) expect(rule.selector).toContain(":not([data-button-align");
  const explicit = rules.filter((rule) =>
    /^\.control\[data-button-align="\w+"\]$/.test(rule.selector),
  );
  expect(explicit.map((rule) => rule.selector)).toEqual([
    '.control[data-button-align="center"]',
    '.control[data-button-align="start"]',
    '.control[data-button-align="end"]',
  ]);
  const lastStructural = Math.max(
    ...rules
      .filter((rule) => /\.(tab|item)/.test(rule.selector) && rule.props.includes("text-align"))
      .map((rule) => rule.order),
  );
  for (const rule of explicit) expect(rule.order).toBeGreaterThan(lastStructural);
  // The migrated `text-left` utility also outranks a tab's centering.
  expect(structural.some((rule) => rule.selector.includes("text-left"))).toBe(true);
});

it("renders ButtonGroup as one labelled joined group of ordinary Buttons", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const first = vi.fn();
  const second = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(
          ButtonGroup,
          { "aria-label": "Review actions" },
          createElement(Button, { onClick: first, motion: "none" }, "Approve"),
          createElement(Button, { disabled: true, onClick: second, motion: "none" }, "Request"),
          createElement(Button, { loading: true, motion: "none" }, "Merge"),
        ),
      ),
    );
    const group = container.querySelector<HTMLElement>('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Review actions");
    expect(group.dataset.buttonGroup).toBe("joined");
    expect(group.getAttribute("role")).not.toBe("radiogroup");
    const [approve, request, merge] = Array.from(group.querySelectorAll("button"));
    await act(async () => {
      approve.click();
      request.click();
      merge.click();
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(request.disabled).toBe(true);
    // Loading keeps focus and announces busy without disabling its neighbours.
    expect(merge.getAttribute("aria-busy")).toBe("true");
    expect(approve.getAttribute("aria-busy")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("moves the one ButtonGroup selection plate to the selected segment", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const group = (selected: string) =>
    createElement(
      ButtonGroup,
      { "aria-label": "Tools", selection: "plate" },
      ...["Servers", "Inbox"].map((name) =>
        createElement(
          Button,
          { key: name, selected: name === selected, motion: "none" },
          name === selected ? createElement(ButtonGroupSelection) : null,
          name,
        ),
      ),
    );
  const plateOwner = () => {
    const plates = container.querySelectorAll("[data-button-group-selection]");
    expect(plates).toHaveLength(1);
    return plates[0].closest("button")?.textContent;
  };
  try {
    await act(async () => root.render(group("Servers")));
    expect(container.querySelector<HTMLElement>('[role="group"]')!.dataset.selection).toBe("plate");
    expect(plateOwner()).toBe("Servers");
    await act(async () => root.render(group("Inbox")));
    expect(plateOwner()).toBe("Inbox");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("reserves a progress slot only for a start icon and keeps an icon-less label's name", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (loading: boolean, icon: boolean) =>
    createElement(
      Button,
      {
        motion: "none",
        loading,
        startIcon: icon ? createElement("svg", { "data-icon": "" }) : undefined,
      },
      "Delete",
    );
  try {
    // No icon, not loading: no empty slot before the label.
    await act(async () => root.render(render(false, false)));
    let button = container.querySelector("button")!;
    expect(button.querySelector("[data-pending], [aria-hidden='true'] > span:empty")).toBeNull();
    expect(button.firstElementChild?.firstElementChild?.textContent).toBe("Delete");
    // No icon, loading: the label stays in place and named; a spinner overlays it.
    await act(async () => root.render(render(true, false)));
    button = container.querySelector("button")!;
    expect(button.textContent).toContain("Delete");
    expect(button.getAttribute("aria-busy")).toBe("true");
    // Start icon: the icon and the spinner share one slot.
    await act(async () => root.render(render(false, true)));
    button = container.querySelector("button")!;
    const slot = button.querySelector("[data-icon]")!.closest("[aria-hidden='true']")!;
    expect(slot.hasAttribute("data-pending")).toBe(false);
    await act(async () => root.render(render(true, true)));
    expect(slot.hasAttribute("data-pending")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
