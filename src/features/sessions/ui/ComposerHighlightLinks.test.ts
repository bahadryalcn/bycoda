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
  act(() => host.querySelectorAll<HTMLElement>("[data-composer-link-open]")[1].click());
  expect(openUrl).toHaveBeenCalledWith("https://example.com/");
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
