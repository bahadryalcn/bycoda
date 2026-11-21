// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ComposerHighlight } from "./ComposerHighlight";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

it("highlights known tracker aliases, repeated refs and more than five tokens without changing draft text", () => {
  const tokens = [
    "@jira:PROJ-123",
    "@jr:PROJ-123",
    "@j:PROJ-1",
    "@gh:142",
    "@github:owner/repo#142",
    "@linear:ENG-42",
    "@lin:ENG-42",
    "@ln:ENG-42",
    "@gl:group/proj!57",
    "@gitlab:group/proj!57",
    "@ado:12",
    "@azure:12",
    "@az:12",
    "@jira:PROJ-123",
  ];
  const text = `${tokens.join(" ")}. @unknown:123 @jira: person@jira:ABC-1`;
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set<string>(),
        skillParts: (value: string) => [{ text: value }],
        mentions: new Map(),
        mcpTags: [],
        attachments: [],
        citations: 0,
      }),
    ),
  );
  expect(host.textContent).toBe(text);
  expect(
    [...host.querySelectorAll("[data-work-item-mention]")].map((node) => node.textContent),
  ).toEqual(tokens);
});

it("boxes each link with its source intact and marks the destination for the action layer", () => {
  const text = "https://github.com/acme/app/pull/1267 bunu incele, https://example.com.";
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set<string>(),
        skillParts: (value: string) => [{ text: value }],
        mentions: new Map(),
        mcpTags: [],
        attachments: [],
        citations: 0,
      }),
    ),
  );
  expect(host.textContent).toBe(text);
  const links = [...host.querySelectorAll("[data-composer-link-token]")];
  expect(links.map((link) => link.textContent)).toEqual([
    "https://github.com/acme/app/pull/1267",
    "https://example.com",
  ]);
  expect(host.querySelectorAll("[data-composer-link-icon] svg")).toHaveLength(2);
  expect(links[1].getAttribute("data-reference-value")).toBe("https://example.com/");
});

it("keeps the attachment and citation tokens inside Markdown emphasis", () => {
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text: "**Look at [image1] and [quote1]**",
        mode: null,
        names: new Set<string>(),
        skillParts: (text) => [{ text }],
        mentions: new Map(),
        mcpTags: [],
        attachments: [
          { id: "image", kind: "image", name: "photo.png", mimeType: "image/png", size: 1 },
        ],
        citations: 1,
      }),
    ),
  );
  const emphasis = host.querySelector('[data-draft-markdown="strong"]');
  expect(emphasis?.querySelector('[data-composer-attachment-kind="image"]')).not.toBeNull();
  expect(emphasis?.querySelector("[data-composer-citation-token]")).not.toBeNull();
  const source = emphasis!.cloneNode(true) as HTMLElement;
  source.querySelectorAll('[aria-hidden="true"]').forEach((face) => face.remove());
  expect(source.textContent).toBe("**Look at [image1] and [quote1]**");
});

it("decorates recognized skills and MCP references without changing the draft", () => {
  const text = "/frontend-design $frontend-design @browser /unknown";
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set(["frontend-design"]),
        skillParts: (value: string) =>
          value
            .split(/(\/frontend-design|\$frontend-design)/)
            .map((text) => ({ text, skill: text.endsWith("frontend-design") ? true : undefined })),
        mentions: new Map(),
        mcpTags: [
          {
            token: "@browser",
            server: {
              name: "browser",
              provider: "codex",
              scope: "user",
              configPath: "/config.toml",
              transport: "http",
            },
          },
        ],
        attachments: [],
        citations: 0,
      }),
    ),
  );
  const source = host.cloneNode(true) as HTMLElement;
  source.querySelectorAll("[data-draft-token-label]").forEach((face) => face.remove());
  expect(source.textContent).toBe(text);
  expect(host.querySelectorAll("[data-composer-skill-token]")).toHaveLength(2);
  expect(host.querySelectorAll("[data-composer-skill-token] svg")).toHaveLength(2);
  expect(host.querySelector("[data-mcp-tag] svg")).not.toBeNull();
});

it("shows the link holding the caret in full, so editing lines up with the textarea", () => {
  const text = "see https://example.com/docs now";
  const field = document.createElement("textarea");
  field.value = text;
  document.body.append(field);
  const ref = { current: field };
  const render = () =>
    act(() =>
      root.render(
        createElement(ComposerHighlight, {
          text,
          mode: null,
          names: new Set<string>(),
          skillParts: (value: string) => [{ text: value }],
          mentions: new Map(),
          mcpTags: [],
          attachments: [],
          citations: 0,
          field: ref,
        }),
      ),
    );
  render();
  act(() => {
    field.focus();
    field.setSelectionRange(10, 10);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(host.textContent).toBe(text);
  expect(host.querySelector("[data-composer-link-open]")).toBeNull();
  act(() => {
    field.setSelectionRange(text.length, text.length);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(host.querySelector("[data-composer-link-open]")).not.toBeNull();
  field.remove();
});

it("shows a link that wraps across lines in source order, so the caret after it lines up", () => {
  const text = "https://example.com/a/very/long/path?clinicId=1 then more words";
  const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    const lines = this.hasAttribute("data-composer-link-token") ? 2 : 1;
    return Array.from({ length: lines }, () => new DOMRect()) as unknown as DOMRectList;
  });
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set<string>(),
        skillParts: (value: string) => [{ text: value }],
        mentions: new Map(),
        mcpTags: [],
        attachments: [],
        citations: 0,
      }),
    ),
  );
  expect(host.textContent).toBe(text);
  expect(host.querySelector("[data-composer-link-open]")).toBeNull();
  rects.mockRestore();
});

it("re-renders on a caret move only when it enters or leaves a link", () => {
  const text = "see https://example.com/docs and https://example.org/x now";
  const field = document.createElement("textarea");
  field.value = text;
  document.body.append(field);
  const ref = { current: field };
  const skillParts = vi.fn((value: string) => [{ text: value }]);
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set<string>(),
        skillParts,
        mentions: new Map(),
        mcpTags: [],
        attachments: [],
        citations: 0,
        field: ref,
      }),
    ),
  );
  const moveCaret = (position: number) =>
    act(() => {
      field.focus();
      field.setSelectionRange(position, position);
      document.dispatchEvent(new Event("selectionchange"));
    });
  const openBadges = () => host.querySelectorAll("[data-composer-link-open]").length;

  moveCaret(1);
  const settled = skillParts.mock.calls.length;
  expect(openBadges()).toBe(2);
  // Plain text: nothing the overlay paints depends on the caret.
  moveCaret(2);
  moveCaret(30);
  expect(skillParts.mock.calls.length).toBe(settled);
  // Entering a link shows it in full; moving inside it changes nothing more.
  moveCaret(10);
  const inFirst = skillParts.mock.calls.length;
  expect(inFirst).toBeGreaterThan(settled);
  expect(openBadges()).toBe(1);
  moveCaret(12);
  expect(skillParts.mock.calls.length).toBe(inFirst);
  // Jumping to the other link swaps which one is shown in full.
  moveCaret(40);
  expect(openBadges()).toBe(1);
  const first = host.querySelector("[data-composer-link-token]");
  expect(first?.querySelector("[data-composer-link-open]")).not.toBeNull();
  // A collapsed link paints its scheme inside the badge, so only the characters (not their
  // order) match the draft; the overlay is aria-hidden and the textarea keeps the real text.
  const sorted = (value: string | null | undefined) => [...(value ?? "")].sort().join("");
  expect(sorted(host.textContent)).toBe(sorted(text));
  field.remove();
});

it("measures every link in one pass and re-measures only when the draft changes", () => {
  const reads: string[] = [];
  const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-composer-link-token")) reads.push(this.textContent ?? "");
    return [] as unknown as DOMRectList;
  });
  const props = {
    mode: null,
    names: new Set<string>(),
    skillParts: (value: string) => [{ text: value }],
    mentions: new Map(),
    mcpTags: [],
    attachments: [],
    citations: 0,
  };
  const text = "https://example.com/a and https://example.org/b and https://example.net/c";
  act(() => root.render(createElement(ComposerHighlight, { ...props, text })));
  // Three links, three reads: one pass, not a pass per link.
  expect(reads).toHaveLength(3);
  reads.length = 0;
  act(() => root.render(createElement(ComposerHighlight, { ...props, text: `${text} x` })));
  expect(reads).toHaveLength(3);
  rects.mockRestore();
});
