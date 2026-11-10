/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { SharedBrowser, type BrowserLoader } from "./shared-browser";
import { readBrowserPage } from "./browser-read";

type Item = { selector: string; role: string; name: string; value?: string; disabled?: boolean };
type Listener = (frame: { parentFrame(): null }) => void;

function fixture(text = "hello world", items: Item[] = []) {
  const state = { text, items, url: "http://localhost:3000/", acted: [] as string[] };
  const listeners: Listener[] = [];
  const page = {
    goto: vi.fn(async (url: string) => {
      state.url = url;
      for (const listener of listeners) listener({ parentFrame: () => null });
    }),
    url: () => state.url,
    screenshot: vi.fn(async () => Buffer.from("frame")),
    on: (_event: string, listener: Listener) => listeners.push(listener),
    off: vi.fn(),
    evaluate: vi.fn(async (_fn: unknown, arg: { selector?: string; maxElements: number }) => {
      if (arg.selector !== undefined) {
        const found = state.items.find((item) => item.selector === arg.selector);
        return { element: found ? { role: found.role, name: found.name } : null };
      }
      return {
        title: "Title",
        text: state.text,
        elements: state.items.slice(0, arg.maxElements).map((item) => ({ ...item })),
      };
    }),
    locator: (selector: string) => ({
      click: vi.fn(async () => void state.acted.push(`click:${selector}`)),
      fill: vi.fn(async (value: string) => void state.acted.push(`fill:${selector}:${value}`)),
    }),
    mouse: { click: vi.fn(), wheel: vi.fn() },
    keyboard: { type: vi.fn(), press: vi.fn() },
  };
  const loader = (async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: vi.fn(),
      }),
    },
  })) as unknown as BrowserLoader;
  return { state, page, browser: new SharedBrowser(loader) };
}
const context = { projectId: "p", sessionId: "s" };
type PageRead = {
  text: string;
  nextCursor: number | null;
  elements: { ref: string; role: string; name: string }[];
};
const read = async (f: ReturnType<typeof fixture>, params: object, caller = "agent") =>
  (await f.browser.dispatchForSession(
    "browser.read",
    params as never,
    caller,
  )) as unknown as PageRead;
async function open(f: ReturnType<typeof fixture>) {
  const claim = await f.browser.dispatchForSession("browser.claim", context, "agent");
  const params = { ...context, leaseId: claim.leaseId };
  await f.browser.dispatchForSession("browser.open", { ...params, url: f.state.url }, "agent");
  return params;
}
afterEach(() => vi.restoreAllMocks());

it("reads bounded, paged text and elements with refs", async () => {
  const items = Array.from({ length: 3 }, (_, i) => ({
    selector: `html > body > *:nth-child(${i + 1})`,
    role: "button",
    name: `Item ${i}`,
  }));
  const f = fixture("a".repeat(50_000), items);
  const params = await open(f);
  const first = await read(f, params);
  expect(first.text).toHaveLength(20_000);
  expect(first.nextCursor).toBe(20_000);
  expect(first.elements.map(({ ref, role, name }) => ({ ref, role, name }))).toEqual([
    { ref: "e1", role: "button", name: "Item 0" },
    { ref: "e2", role: "button", name: "Item 1" },
    { ref: "e3", role: "button", name: "Item 2" },
  ]);
  expect(first).toMatchObject({ url: "http://localhost:3000/", title: "Title" });
  expect(f.page.evaluate).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ maxElements: 200 }),
  );
  const next = await read(f, { ...params, cursor: 20_000, maxChars: 40_000 });
  expect(next.text).toHaveLength(30_000);
  expect(next.nextCursor).toBeNull();
  expect(next.elements).toEqual([]);
  await expect(
    f.browser.dispatchForSession("browser.read", { ...params, maxChars: 40_001 }, "agent"),
  ).rejects.toThrow("maxChars");
});

it("reads without a lease but only for the owning session", async () => {
  const f = fixture();
  await open(f);
  expect(await f.browser.dispatchForSession("browser.read", context, "other")).toMatchObject({
    text: "hello world",
  });
  await expect(
    f.browser.dispatchForSession("browser.read", { ...context, sessionId: "x" }, "agent"),
  ).rejects.toThrow("Open a browser for this session");
});

it("acts on the element a ref names and requires the lease", async () => {
  const f = fixture("t", [
    { selector: "S1", role: "button", name: "Save" },
    { selector: "S2", role: "textbox", name: "Email" },
  ]);
  const params = await open(f);
  await f.browser.dispatchForSession("browser.read", params, "agent");
  const input = (extra: Record<string, unknown>) =>
    f.browser.dispatchForSession("browser.input", { ...params, ...extra }, "agent");
  await input({ kind: "click", ref: "e1" });
  await input({ kind: "text", ref: "e2", text: "a@b.c" });
  expect(f.state.acted).toEqual(["click:S1", "fill:S2:a@b.c"]);
  expect(f.page.mouse.click).not.toHaveBeenCalled();
  await expect(input({ leaseId: "wrong", kind: "click", ref: "e1" })).rejects.toThrow("Claim");
  await expect(input({ kind: "key", ref: "e1", key: "Tab" })).rejects.toThrow(
    "only click and text",
  );
});

it("rejects stale refs after navigation or a changed element", async () => {
  const f = fixture("t", [{ selector: "S1", role: "button", name: "Save" }]);
  const params = await open(f);
  await f.browser.dispatchForSession("browser.read", params, "agent");
  const input = (extra: Record<string, unknown>) =>
    f.browser.dispatchForSession(
      "browser.input",
      { ...params, kind: "click", ref: "e1", ...extra },
      "agent",
    );
  const stale = "The page changed; call browser.read again.";
  f.state.items[0].name = "Delete";
  await expect(input({})).rejects.toThrow(stale);
  f.state.items[0].name = "Save";
  await input({});
  await f.page.goto("http://localhost:3000/next");
  await expect(input({})).rejects.toThrow(stale);
  await expect(input({ ref: "e99" })).rejects.toThrow(stale);
});

it("describes visible interactive elements without exposing passwords", () => {
  document.body.innerHTML =
    '<button>Go</button><input aria-label="Email" value="a@b.c"><input type="password" aria-label="Secret" value="hunter2">';
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 10,
    height: 10,
  } as DOMRect);
  const result = readBrowserPage({ maxElements: 200 }) as {
    elements: { selector: string; role: string; name: string; value?: string }[];
  };
  expect(result.elements.map(({ role, name, value }) => ({ role, name, value }))).toEqual([
    { role: "button", name: "Go", value: undefined },
    { role: "textbox", name: "Email", value: "a@b.c" },
    { role: "textbox", name: "Secret", value: undefined },
  ]);
  const again = readBrowserPage({ selector: result.elements[0].selector, maxElements: 1 });
  expect(again).toEqual({ element: { role: "button", name: "Go" } });
});
