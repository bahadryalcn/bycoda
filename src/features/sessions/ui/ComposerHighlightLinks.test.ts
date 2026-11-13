// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
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

it("boxes each link with its text intact and opens it from the end badge", () => {
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
  // The overlay may rearrange a link's own characters, never their count.
  expect(host.textContent).toHaveLength(text.length);
  const links = [...host.querySelectorAll("[data-composer-link-token]")];
  expect(links.map((link) => link.textContent)).toEqual([
    "hgithub.com/acme/app/pull/1267ttps:/",
    "hexample.comttps:/",
  ]);
  expect(host.querySelectorAll("[data-composer-link-icon] svg")).toHaveLength(2);
  act(() => host.querySelectorAll<HTMLElement>("[data-composer-link-open]")[1].click());
  expect(openUrl).toHaveBeenCalledWith("https://example.com/");
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
  expect(host.textContent).toBe(text);
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
