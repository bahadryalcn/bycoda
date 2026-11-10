/** Text and element reading for the shared browser, so a model without vision can use it.
 * Page content is untrusted data. Refs are opaque, bound to one page load and resolved to
 * Playwright locators; nothing here evaluates model-supplied code or touches credentials. */

export const BROWSER_READ_DEFAULT_CHARS = 20_000;
export const BROWSER_READ_MAX_CHARS = 40_000;
export const BROWSER_READ_MAX_ELEMENTS = 200;
const STALE_REF = "The page changed; call browser.read again.";

export type BrowserElementInfo = {
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
};
type PageSnapshot = {
  title: string;
  text: string;
  elements: (BrowserElementInfo & { selector: string })[];
};
type ReadArg = { selector?: string; maxElements: number };
type ReadResult = PageSnapshot | { element: BrowserElementInfo | null };

/** Self-contained Playwright evaluate callback; it reads only, never dispatches events. */
export function readBrowserPage(arg: ReadArg): ReadResult {
  const clip = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
  };
  const roleOf = (el: Element) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      return "textbox";
    }
    return "generic";
  };
  const nameOf = (el: Element) => {
    const label = el.getAttribute("aria-label");
    if (label) return clip(label, 120);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (clip(text, 120)) return clip(text, 120);
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) return clip(Array.from(labels, (l) => l.textContent ?? "").join(" "), 120);
    const own = clip((el as HTMLElement).innerText ?? el.textContent ?? "", 120);
    if (own) return own;
    return clip(
      el.getAttribute("alt") ??
        el.getAttribute("title") ??
        el.getAttribute("placeholder") ??
        (el.tagName === "INPUT" ? (el.getAttribute("value") ?? "") : ""),
      120,
    );
  };
  const info = (el: Element): BrowserElementInfo => {
    const out: BrowserElementInfo = { role: roleOf(el), name: nameOf(el) };
    const input = el as HTMLInputElement;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) &&
      type !== "password" &&
      !["button", "submit", "reset", "image"].includes(type)
    ) {
      if (type === "checkbox" || type === "radio") out.value = input.checked ? "checked" : "";
      else out.value = clip(input.value ?? "", 200);
    }
    if (input.disabled || el.getAttribute("aria-disabled") === "true") out.disabled = true;
    return out;
  };
  const pathOf = (el: Element) => {
    const parts: string[] = [];
    for (let node: Element | null = el; node && node !== document.documentElement;) {
      const parent: Element | null = node.parentElement;
      if (!parent) return "";
      parts.unshift(`:nth-child(${Array.prototype.indexOf.call(parent.children, node) + 1})`);
      node = parent;
    }
    return `html > body${parts
      .slice(1)
      .map((part) => ` > *${part}`)
      .join("")}`;
  };
  if (arg.selector !== undefined) {
    let el: Element | null = null;
    try {
      el = document.querySelector(arg.selector);
    } catch {
      el = null;
    }
    return { element: el && visible(el) ? info(el) : null };
  }
  const interactive =
    'a[href],button,summary,select,textarea,input:not([type="hidden"]),[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="tab"],[role="switch"],[role="textbox"],[role="combobox"],[contenteditable=""],[contenteditable="true"]';
  const elements: PageSnapshot["elements"] = [];
  for (const el of Array.from(document.querySelectorAll(interactive))) {
    if (elements.length >= arg.maxElements) break;
    if (!visible(el)) continue;
    const selector = pathOf(el);
    if (selector) elements.push({ ...info(el), selector });
  }
  return {
    title: clip(document.title, 300),
    text: (document.body?.innerText ?? "").slice(0, 400_000),
    elements,
  };
}

type RefPage = {
  url(): string;
  title?(): Promise<string>;
  evaluate?: <T, A>(callback: (arg: A) => T, arg: A) => Promise<T>;
  locator?: (selector: string) => unknown;
};
type RefLocator = {
  click(options: { timeout: number }): Promise<void>;
  fill(text: string, options: { timeout: number }): Promise<void>;
};

/** Refs of the latest read, valid for one page load (identified by `key`). */
export class BrowserRefs {
  private state?: { key: string; refs: Map<string, BrowserElementInfo & { selector: string }> };

  async read(page: RefPage | undefined, current: () => string, params: Record<string, unknown>) {
    if (!page) throw new Error("Open a shared browser first");
    if (!page.evaluate) throw new Error("Page reading is unavailable on this host browser.");
    const cursor = params.cursor === undefined ? 0 : params.cursor;
    const maxChars = params.maxChars === undefined ? BROWSER_READ_DEFAULT_CHARS : params.maxChars;
    if (!Number.isInteger(cursor) || (cursor as number) < 0) throw new Error("Invalid read cursor");
    if (
      !Number.isInteger(maxChars) ||
      (maxChars as number) < 1 ||
      (maxChars as number) > BROWSER_READ_MAX_CHARS
    )
      throw new Error(`maxChars must be an integer from 1 to ${BROWSER_READ_MAX_CHARS}.`);
    const key = current();
    const snapshot = (await page.evaluate(readBrowserPage, {
      maxElements: BROWSER_READ_MAX_ELEMENTS,
    })) as PageSnapshot;
    if (current() !== key)
      throw new Error("The page changed during read; call browser.read again.");
    const start = cursor as number;
    const end = start + (maxChars as number);
    const first = start === 0;
    if (first || this.state?.key !== key) {
      const refs = new Map<string, BrowserElementInfo & { selector: string }>();
      snapshot.elements.forEach((el, index) => refs.set(`e${index + 1}`, el));
      this.state = { key, refs };
    }
    return {
      url: page.url(),
      title: snapshot.title,
      text: snapshot.text.slice(start, end),
      elements: first
        ? [...this.state!.refs].map(([ref, { selector: _selector, ...el }]) => ({ ref, ...el }))
        : [],
      nextCursor: end < snapshot.text.length ? end : null,
    };
  }

  /** Acts on a ref after proving it still names the element that read returned. */
  async act(page: RefPage, current: () => string, params: Record<string, unknown>) {
    const { ref, kind } = params;
    if (kind !== "click" && kind !== "text")
      throw new Error("Element refs support only click and text input.");
    if (params.x !== undefined || params.y !== undefined)
      throw new Error("Use either ref or x/y, not both.");
    const key = current();
    const entry =
      typeof ref === "string" && this.state?.key === key ? this.state.refs.get(ref) : undefined;
    if (!entry || !page.evaluate || !page.locator) throw new Error(STALE_REF);
    if (kind === "text") {
      if (
        typeof params.text !== "string" ||
        params.text.length > 4096 ||
        params.text.includes("\0")
      )
        throw new Error("Invalid browser text");
    }
    const now = (await page.evaluate(readBrowserPage, {
      selector: entry.selector,
      maxElements: 1,
    })) as { element: BrowserElementInfo | null };
    if (!now.element || now.element.role !== entry.role || now.element.name !== entry.name)
      throw new Error(STALE_REF);
    if (now.element.disabled) throw new Error("The element is disabled.");
    if (current() !== key) throw new Error(STALE_REF);
    const locator = page.locator(entry.selector) as RefLocator;
    if (kind === "click") await locator.click({ timeout: 5_000 });
    else await locator.fill(params.text as string, { timeout: 5_000 });
  }
}
