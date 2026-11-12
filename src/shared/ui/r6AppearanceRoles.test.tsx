// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Text } from "./Text";
import { LiveText } from "./LiveText";
import { NativeSelect } from "./Select";
import { ScrollArea, scrollAreaAttributes } from "./ScrollArea";
import { Motion } from "./Motion";
import { Heading } from "./Heading";
import { FieldLabel } from "./Field";
import { Code } from "./Code";
import { ClampText } from "./ClampText";
import { Switch } from "./Switch";
import { RadioGroup } from "./RadioGroup";
import { EmptyState } from "./EmptyState";
import { ShortcutKbd } from "./ShortcutKbd";
import { SectionLabel } from "./SectionLabel";
import { TextField } from "./TextField";
import { InlineError } from "./InlineError";
import { Sheet } from "./Sheet";
import { Modal } from "./Modal";
import { ContinuousList } from "./ContinuousList";

const cases: [string, ReactNode, string, string, string][] = [
  [
    "ContinuousList gutter",
    <ContinuousList
      items={[]}
      itemKey={(item: string) => item}
      renderItem={(item) => item}
      stateKey="r6-list"
      gutter="stable"
    />,
    "[data-continuous-list]",
    "data-gutter",
    "stable",
  ],
  ["Button textSize", <Button textSize="body">Open</Button>, "button", "data-size", "body"],
  [
    "Button textTone",
    <Button textTone="secondary">Open</Button>,
    "button",
    "data-tone",
    "secondary",
  ],
  ["Button weight", <Button weight="medium">Open</Button>, "button", "data-weight", "medium"],
  ["Button lines", <Button lines={2}>Open</Button>, "button", "data-lines", "2"],
  ["LiveText lines", <LiveText text="Sending" lines={2} />, '[role="status"]', "data-lines", "2"],
  ["NativeSelect truncate", <NativeSelect truncate />, "select", "data-truncate", "true"],
  ["Text lines", <Text lines={2}>Copy</Text>, "span", "data-lines", "2"],
  ["Text as kbd", <Text as="kbd">Esc</Text>, "kbd", "data-size", "caption"],
  ["Text on-solid ink", <Text tone="on-solid">Copy</Text>, "span", "data-tone", "on-solid"],
  [
    "Text accent-on-solid ink",
    <Text tone="accent-on-solid">Copy</Text>,
    "span",
    "data-tone",
    "accent-on-solid",
  ],
  ["Text normal tracking", <Text tracking="normal">Copy</Text>, "span", "data-tracking", "normal"],
  ["Motion linear", <Motion easing="linear" />, "div", "data-easing", "linear"],
  ["ScrollArea form", <ScrollArea as="form" gutter="stable" />, "form", "data-gutter", "stable"],
  ["ScrollArea aside", <ScrollArea as="aside" />, "aside", "data-axis", "y"],
  [
    "Switch labelText",
    <Switch label="Enabled" labelText={{ size: "secondary", tone: "primary" }} />,
    "span[data-size]",
    "data-size",
    "secondary",
  ],
  [
    "RadioGroup legendText",
    <RadioGroup label="Choice" options={[]} legendText={{ size: "body" }} />,
    "legend",
    "data-size",
    "body",
  ],
  [
    "RadioGroup descriptionText",
    <RadioGroup
      label="Choice"
      options={[{ value: "one", label: "One", description: "Help" }]}
      descriptionText={{ tone: "muted" }}
    />,
    "small",
    "data-tone",
    "muted",
  ],
  [
    "EmptyState descriptionText block",
    <EmptyState description="Empty" descriptionText={{ size: "caption" }} />,
    "p",
    "data-size",
    "caption",
  ],
  [
    "EmptyState descriptionText inline",
    <EmptyState size="inline" description="Empty" descriptionText={{ size: "caption" }} />,
    "span[data-size]",
    "data-size",
    "caption",
  ],
  [
    "ShortcutKbd tone",
    <ShortcutKbd tone="primary">Esc</ShortcutKbd>,
    "kbd",
    "data-tone",
    "primary",
  ],
  [
    "FieldLabel weight",
    <FieldLabel weight="regular">Name</FieldLabel>,
    "label",
    "data-weight",
    "regular",
  ],
  [
    "FieldLabel leading",
    <FieldLabel leading="normal">Name</FieldLabel>,
    "label",
    "data-leading",
    "normal",
  ],
  ["Code weight", <Code weight="medium">1234</Code>, "code", "data-weight", "medium"],
  ["Code tracking", <Code tracking="wider">1234</Code>, "code", "data-tracking", "wider"],
  ["Heading leading", <Heading leading="normal">Title</Heading>, "h2", "data-leading", "normal"],
  ["Heading size", <Heading size="heading">Title</Heading>, "h1", "data-size", "heading"],
  [
    "SectionLabel tone",
    <SectionLabel tone="muted">Group</SectionLabel>,
    "span[data-tone]",
    "data-tone",
    "muted",
  ],
  [
    "TextField weight",
    <TextField label="Title" weight="medium" />,
    "input",
    "data-weight",
    "medium",
  ],
  [
    "InlineError text",
    <InlineError text={{ tone: "secondary", leading: "snug" }}>Failed</InlineError>,
    "span[data-tone]",
    "data-tone",
    "secondary",
  ],
  [
    "ClampText expandable roles",
    <ClampText size="secondary" leading="normal">
      Copy
    </ClampText>,
    "div[data-size]",
    "data-size",
    "secondary",
  ],
  [
    "Sheet bodyText",
    <Sheet
      modal={false}
      anchor="container"
      title="Detail"
      onClose={() => {}}
      bodyText={{ size: "body" }}
    >
      Copy
    </Sheet>,
    "div[data-size]",
    "data-size",
    "body",
  ],
  [
    "Modal bodyText",
    <Modal title="Detail" onClose={() => {}} bodyText={{ size: "secondary" }}>
      Copy
    </Modal>,
    "[data-modal-scroll]",
    "data-size",
    "secondary",
  ],
];

describe("R6 shared appearance roles", () => {
  for (const [name, node, selector, attribute, expected] of cases) {
    it(name, async () => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(node));
        expect(document.body.querySelector(selector)?.getAttribute(attribute)).toBe(expected);
      } finally {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
      }
    });
  }
  it("keeps plain controls free of optional type roles and truncation free of inherited leading", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <>
            <Button>Plain</Button>
            <Button truncate>Cut</Button>
            <NativeSelect />
            <LiveText text="Ready" />
            <FieldLabel>Label</FieldLabel>
            <Switch label="On" />
            <RadioGroup label="Choice" options={[]} />
          </>,
        ),
      );
      expect(host.querySelector("button")?.hasAttribute("data-size")).toBe(false);
      expect(host.querySelector("[data-truncate]")?.hasAttribute("data-leading")).toBe(false);
      expect(host.querySelector("select")?.hasAttribute("data-truncate")).toBe(false);
      expect(host.querySelector('[role="status"]')?.hasAttribute("data-lines")).toBe(false);
      expect(host.querySelector("label")?.hasAttribute("data-size")).toBe(false);
      expect(host.querySelector("legend")?.hasAttribute("data-size")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it("preserves virtualizer overflow and removes an optional clamp without losing inline layout", async () => {
    expect(scrollAreaAttributes({ gutter: "stable" }, "list")).toMatchObject({
      "data-axis": undefined,
      "data-gutter": "stable",
    });
    expect(scrollAreaAttributes({ scrollbar: "hidden" })).toMatchObject({
      "data-scrollbar": "hidden",
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <Text lines={2} style={{ maxWidth: 100 }}>
            Full text
          </Text>,
        ),
      );
      expect(host.firstElementChild?.getAttribute("style")).toContain("--clamp-lines: 2");
      await act(async () => root.render(<Text style={{ maxWidth: 100 }}>Full text</Text>));
      expect(host.firstElementChild?.hasAttribute("data-lines")).toBe(false);
      expect(host.textContent).toBe("Full text");
      expect(host.firstElementChild?.getAttribute("style")).toContain("max-width: 100px");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
