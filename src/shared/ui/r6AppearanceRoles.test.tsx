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
      key="specimen"
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
  [
    "Button textSize",
    <Button key="specimen" textSize="body">
      Open
    </Button>,
    "button",
    "data-size",
    "body",
  ],
  [
    "Button textTone",
    <Button key="specimen" textTone="secondary">
      Open
    </Button>,
    "button",
    "data-tone",
    "secondary",
  ],
  [
    "Button weight",
    <Button key="specimen" weight="medium">
      Open
    </Button>,
    "button",
    "data-weight",
    "medium",
  ],
  [
    "Button lines",
    <Button key="specimen" lines={2}>
      Open
    </Button>,
    "button",
    "data-lines",
    "2",
  ],
  [
    "LiveText lines",
    <LiveText key="specimen" text="Sending" lines={2} />,
    '[role="status"]',
    "data-lines",
    "2",
  ],
  [
    "NativeSelect truncate",
    <NativeSelect key="specimen" truncate />,
    "select",
    "data-truncate",
    "true",
  ],
  [
    "Text lines",
    <Text key="specimen" lines={2}>
      Copy
    </Text>,
    "span",
    "data-lines",
    "2",
  ],
  [
    "Text as kbd",
    <Text key="specimen" as="kbd">
      Esc
    </Text>,
    "kbd",
    "data-size",
    "caption",
  ],
  [
    "Text on-solid ink",
    <Text key="specimen" tone="on-solid">
      Copy
    </Text>,
    "span",
    "data-tone",
    "on-solid",
  ],
  [
    "Text accent-on-solid ink",
    <Text key="specimen" tone="accent-on-solid">
      Copy
    </Text>,
    "span",
    "data-tone",
    "accent-on-solid",
  ],
  [
    "Text normal tracking",
    <Text key="specimen" tracking="normal">
      Copy
    </Text>,
    "span",
    "data-tracking",
    "normal",
  ],
  ["Motion linear", <Motion key="specimen" easing="linear" />, "div", "data-easing", "linear"],
  [
    "ScrollArea form",
    <ScrollArea key="specimen" as="form" gutter="stable" />,
    "form",
    "data-gutter",
    "stable",
  ],
  ["ScrollArea aside", <ScrollArea key="specimen" as="aside" />, "aside", "data-axis", "y"],
  [
    "Switch labelText",
    <Switch key="specimen" label="Enabled" labelText={{ size: "secondary", tone: "primary" }} />,
    "span[data-size]",
    "data-size",
    "secondary",
  ],
  [
    "RadioGroup legendText",
    <RadioGroup key="specimen" label="Choice" options={[]} legendText={{ size: "body" }} />,
    "legend",
    "data-size",
    "body",
  ],
  [
    "RadioGroup descriptionText",
    <RadioGroup
      key="specimen"
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
    <EmptyState key="specimen" description="Empty" descriptionText={{ size: "caption" }} />,
    "p",
    "data-size",
    "caption",
  ],
  [
    "EmptyState descriptionText inline",
    <EmptyState
      key="specimen"
      size="inline"
      description="Empty"
      descriptionText={{ size: "caption" }}
    />,
    "span[data-size]",
    "data-size",
    "caption",
  ],
  [
    "ShortcutKbd tone",
    <ShortcutKbd key="specimen" tone="primary">
      Esc
    </ShortcutKbd>,
    "kbd",
    "data-tone",
    "primary",
  ],
  [
    "FieldLabel weight",
    <FieldLabel key="specimen" weight="regular">
      Name
    </FieldLabel>,
    "label",
    "data-weight",
    "regular",
  ],
  [
    "FieldLabel leading",
    <FieldLabel key="specimen" leading="normal">
      Name
    </FieldLabel>,
    "label",
    "data-leading",
    "normal",
  ],
  [
    "Code weight",
    <Code key="specimen" weight="medium">
      1234
    </Code>,
    "code",
    "data-weight",
    "medium",
  ],
  [
    "Code tracking",
    <Code key="specimen" tracking="wider">
      1234
    </Code>,
    "code",
    "data-tracking",
    "wider",
  ],
  [
    "Heading leading",
    <Heading key="specimen" leading="normal">
      Title
    </Heading>,
    "h2",
    "data-leading",
    "normal",
  ],
  [
    "Heading size",
    <Heading key="specimen" size="heading">
      Title
    </Heading>,
    "h1",
    "data-size",
    "heading",
  ],
  [
    "SectionLabel tone",
    <SectionLabel key="specimen" tone="muted">
      Group
    </SectionLabel>,
    "span[data-tone]",
    "data-tone",
    "muted",
  ],
  [
    "TextField weight",
    <TextField key="specimen" label="Title" weight="medium" />,
    "input",
    "data-weight",
    "medium",
  ],
  [
    "InlineError text",
    <InlineError key="specimen" text={{ tone: "secondary", leading: "snug" }}>
      Failed
    </InlineError>,
    "span[data-tone]",
    "data-tone",
    "secondary",
  ],
  [
    "ClampText expandable roles",
    <ClampText key="specimen" size="secondary" leading="normal">
      Copy
    </ClampText>,
    "div[data-size]",
    "data-size",
    "secondary",
  ],
  [
    "Sheet bodyText",
    <Sheet
      key="specimen"
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
    <Modal key="specimen" title="Detail" onClose={() => {}} bodyText={{ size: "secondary" }}>
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
