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

it("highlights scoped crews, members and notes in the textarea overlay without rewriting the draft", () => {
  const text =
    "Ask @crews:audit-source-fixes and @crews:backend-engineer about @notes:plan. @crews:";
  act(() =>
    root.render(
      createElement(ComposerHighlight, {
        text,
        mode: null,
        names: new Set<string>(),
        skillParts: (text) => [{ text }],
        mentions: new Map(),
        mcpTags: [],
        attachments: [],
        citations: 0,
      }),
    ),
  );
  expect(host.textContent).toBe(text);
  expect(
    [...host.querySelectorAll("[data-scoped-mention]")].map((node) => node.textContent),
  ).toEqual(["@crews:audit-source-fixes", "@crews:backend-engineer", "@notes:plan"]);
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
