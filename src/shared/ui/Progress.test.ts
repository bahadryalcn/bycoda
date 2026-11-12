// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Progress } from "./Progress";
import { Meter } from "./Meter";
import { UsageMeter } from "./UsageMeter";
import { Badge } from "./Badge";
import { Badge as ArcBadge } from "./arc/badge/badge";
import { StatusDot } from "./StatusDot";
import { PaneHeader } from "./PaneHeader";
import { PanelHeader } from "./PanelHeader";
import { SectionLabel } from "./SectionLabel";
import { Disclosure } from "./Disclosure";

function render(node: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(node);
  return container;
}

describe("measure jobs", () => {
  it("keeps operation progress distinct from bounded measurement", () => {
    const progress = render(createElement(Progress, { value: 150, max: 100, label: "Upload" }));
    expect(progress.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "100",
    );
    const unknown = render(createElement(Progress, { label: "Upload" }));
    expect(unknown.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(
      false,
    );
    const meter = render(
      createElement(Meter, { value: 150, max: 100, danger: 90, "aria-label": "Memory" }),
    );
    expect(meter.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("100");
    expect(meter.querySelector('[role="meter"]')?.getAttribute("aria-label")).toBe("Memory");
    expect(meter.querySelector('[role="meter"]')?.getAttribute("data-tone")).toBe("danger");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    "never announces an unknown measurement as zero (%s)",
    (value) => {
      expect(
        render(createElement(Meter, { value, label: "Memory" })).querySelector('[role="meter"]'),
      ).toBeNull();
    },
  );

  it("keeps over-quota amounts in spoken text while clamping the bounded value", () => {
    const quota = render(
      createElement(UsageMeter, {
        label: "Budget",
        compact: true,
        showLegend: false,
        limit: 100,
        segments: [{ id: "used", label: "Used", value: 120 }],
        valueText: "120 of 100 tokens",
      }),
    );
    const bar = quota.querySelector('[role="meter"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-valuetext")).toBe("120 of 100 tokens");
    expect(quota.querySelector('[data-status="over"]')).not.toBeNull();
    const unknown = render(
      createElement(UsageMeter, {
        label: "Budget",
        compact: true,
        showLegend: false,
        limit: 100,
        unknown: true,
        segments: [{ id: "used", label: "Used", value: 120 }],
      }),
    );
    expect(unknown.querySelector('[role="meter"]')).toBeNull();
  });
});

describe("shared title and status renderers", () => {
  it("uses the same dot inside badges and beside rows", () => {
    const dot = render(createElement(StatusDot, { tone: "success" })).firstElementChild!;
    for (const Control of [Badge, ArcBadge]) {
      const badge = render(
        createElement(Control, { variant: "dot", tone: "success", label: "Online" }),
      );
      const mark = badge.querySelector('[data-tone="success"][aria-hidden="true"]')!;
      expect(mark.className).toBe(dot.className);
      expect(mark.getAttribute("data-size")).toBe("sm");
      expect(badge.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Online");
    }
  });

  it("caps primitive and adapter counts identically", () => {
    for (const Control of [Badge, ArcBadge]) {
      const count = render(createElement(Control, { variant: "count" }, 154));
      expect(count.textContent).toBe("99+");
      expect(count.firstElementChild?.getAttribute("aria-label")).toBe("154");
      expect(count.firstElementChild?.getAttribute("data-tone")).toBe("accent");
    }
  });

  it("keeps pane title semantics while sharing item typography", () => {
    const pane = render(
      createElement(PaneHeader, { title: "Files", titleAs: "div", titleId: "files" }),
    );
    expect(pane.querySelector("#files")?.tagName).toBe("DIV");
    expect(pane.querySelector("#files")?.getAttribute("data-size")).toBe("item");
    const panel = render(createElement(PanelHeader, { title: "Settings", titleId: "settings" }));
    expect(panel.querySelector("#settings")?.tagName).toBe("H2");
    expect(panel.querySelector("#settings")?.getAttribute("data-size")).toBe("page");
  });

  it("uses the shared capped count in section structure", () => {
    const nodes = [
      createElement(SectionLabel, { count: 154, countLabel: "154 items", children: "Items" }),
      createElement(Disclosure, {
        count: 154,
        countLabel: "154 items",
        summary: "Items",
        children: "Detail",
      }),
    ];
    for (const node of nodes) {
      const count = render(node);
      expect(count.querySelector('[data-variant="count"]')?.textContent).toBe("99+");
      expect(count.querySelector('[data-variant="count"]')?.getAttribute("aria-label")).toBe(
        "154 items",
      );
    }
  });
});
