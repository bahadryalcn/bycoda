// @vitest-environment happy-dom
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { activateTerminalLink } from "./terminalLinks";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}), isMac: false }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../../platform/tauri/platform", () => ({
  get IS_MAC() {
    return mocks.isMac;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.isMac = false;
});

it("opens HTTP URLs only on Ctrl + left click", () => {
  const uri = "http://localhost:3000/demo?q=test";
  activateTerminalLink(new MouseEvent("click"), uri);
  activateTerminalLink(new MouseEvent("click", { metaKey: true }), uri);
  activateTerminalLink(new MouseEvent("click", { ctrlKey: true, button: 1 }), uri);
  expect(mocks.openUrl).not.toHaveBeenCalled();
  const click = new MouseEvent("click", { ctrlKey: true, cancelable: true });
  activateTerminalLink(click, uri);
  expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith(uri);
  expect(click.defaultPrevented).toBe(true);
});

it("uses Command + click on Mac", () => {
  mocks.isMac = true;
  activateTerminalLink(new MouseEvent("click", { ctrlKey: true }), "https://example.com");
  expect(mocks.openUrl).not.toHaveBeenCalled();
  activateTerminalLink(new MouseEvent("click", { metaKey: true }), "https://example.com");
  expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com");
});

it.each(["javascript:alert(1)", "file:///C:/secret", "bycoda://action", "not a URL"])(
  "rejects unsafe or malformed explicit hyperlinks: %s",
  (uri) => {
    activateTerminalLink(new MouseEvent("click", { ctrlKey: true }), uri);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  },
);

it("handles opener failures without leaking the URL into logs", async () => {
  mocks.openUrl.mockRejectedValueOnce(new Error("failure"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    activateTerminalLink(new MouseEvent("click", { ctrlKey: true }), "https://example.com/private");
    await Promise.resolve();
    expect(warn).toHaveBeenCalledExactlyOnceWith("Could not open terminal link in the browser");
  } finally {
    warn.mockRestore();
  }
});

it.each([
  ["Local: http://localhost:3000/", "http://localhost:3000/", 80],
  ["Network: http://192.168.1.106:8888/path", "http://192.168.1.106:8888/path", 80],
  ["Visit (https://example.com/docs?q=test).", "https://example.com/docs?q=test", 80],
  ["Local: http://localhost:3000/very/long/path", "http://localhost:3000/very/long/path", 24],
])("detects a printed URL and routes activation to the native opener: %s", (text, uri, cols) => {
  let provider!: ILinkProvider;
  let char = "";
  const cell = { getChars: () => char, getWidth: () => 1 };
  const terminal = {
    buffer: {
      active: {
        getNullCell: () => cell,
        getLine: (index: number) =>
          index >= 0 && index * cols < text.length
            ? {
                isWrapped: index > 0,
                length: Math.min(cols, text.length - index * cols),
                translateToString: () => text.slice(index * cols, (index + 1) * cols),
                getCell: (column: number) => {
                  char = text[index * cols + column];
                  return cell;
                },
              }
            : undefined,
      },
    },
    registerLinkProvider: (value: ILinkProvider) => {
      provider = value;
      return { dispose() {} };
    },
  } as unknown as Terminal;
  const addon = new WebLinksAddon(activateTerminalLink);
  addon.activate(terminal);
  let links: ILink[] = [];
  provider.provideLinks(1, (result) => {
    links = result ?? [];
  });
  expect(links.map((link) => link.text)).toEqual([uri]);
  links[0].activate(new MouseEvent("click", { ctrlKey: true }), links[0].text);
  expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith(uri);
  addon.dispose();
});
