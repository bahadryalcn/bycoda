import type { BrowserElementTarget } from "../src/shared/lib/browserAnnotation";

export type ElementInspection = {
  element?: BrowserElementTarget;
  limitation?: string;
  pageUrl: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  devicePixelRatio: number;
  masks: string[];
};

/** Self-contained Playwright evaluate callback. Never dispatches page events,
 * reads form values, copies HTML/attributes, or crosses a frame boundary. */
export function inspectBrowserElement(point: {
  x: number;
  y: number;
  full: boolean;
  opaqueHosts?: string[];
}): ElementInspection {
  const scrub = (value: string) =>
    value
      .replace(/\b(?:Bearer\s+)[\w.+/=-]+/gi, "[redacted]")
      .replace(
        /\b(?:password|passwd|token|secret|api[_-]?key|authorization|session[_-]?id)\s*[:=]\s*["']?[^\s"'<>,;]+/gi,
        "[redacted]",
      )
      .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, "[redacted]")
      .replace(/https?:\/\/[^\s"']+/gi, "[url omitted]");
  const url = new URL(location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const decodedPath = url.pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "[redacted]";
      }
    })
    .join("/");
  const safePath = decodedPath.replace(
    /((?:token|secret|password|key|auth)\/)[^/]+/gi,
    "$1[redacted]",
  );
  const pageUrl = (
    url.origin +
    safePath
      .split("/")
      .map((segment) => scrub(segment))
      .join("/")
  ).slice(0, 4096);
  const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY };
  const result: ElementInspection = { pageUrl, viewport, devicePixelRatio, masks: [] };
  const privateSelector =
    "input,textarea,select,option,[contenteditable]:not([contenteditable=false]),[data-sensitive],[data-private],iframe,frame,object,embed";
  const privateElement = (element: Element) =>
    !!element.closest(privateSelector) ||
    /password|passwd|token|secret|api[-_]?key|authorization|credit.?card|otp/i.test(
      ["name", "id", "autocomplete", "aria-label"]
        .map((key) => element.getAttribute(key) ?? "")
        .join(" "),
    ) ||
    (!/^(html|body|main|section|form)$/.test(element.localName) &&
      /\b(?:password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]/i.test(
        Array.from(element.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent ?? "")
          .join(" "),
      ));
  const opaqueAncestor = (element: Element) => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement)
      if (parent.localName.includes("-") || privateElement(parent)) return true;
    return false;
  };
  const part = (element: Element) => {
    const tag = element.localName;
    const siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter((node) => node.localName === tag)
      : [element];
    return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
  };
  const selector = (element: Element) => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node) {
      parts.unshift(part(node));
      node = node.parentElement;
      if (parts.length > 64) throw new Error("Element ancestry exceeds inspection budget");
    }
    return parts.join(" > ");
  };
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (getComputedStyle(parent).opacity === "0") return false;
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      element.getClientRects().length > 0
    );
  };
  const node = document.elementFromPoint(point.x, point.y);
  if (!node || !visible(node))
    return {
      ...result,
      limitation: "No accessible element at this position. Refresh the frame and try again.",
    };
  if (node.closest("iframe,frame,object,embed"))
    return {
      ...result,
      limitation:
        "Iframe content (including cross-origin frames) cannot be inspected. Select an element in the main page.",
    };
  if (
    node.localName.includes("-") ||
    node.shadowRoot ||
    point.opaqueHosts?.some((selector) => node.closest(selector))
  )
    return {
      ...result,
      limitation: "Shadow DOM content cannot be inspected. Select an element in the main page.",
    };
  const box = node.getBoundingClientRect();
  const bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
  const ancestry = [];
  for (let parent = node.parentElement; parent; parent = parent.parentElement)
    ancestry.unshift({ tag: parent.localName, selectorPart: part(parent) });
  const computedStyle: Record<string, string> = {};
  let text = "";
  if (point.full) {
    for (const property of [
      "display",
      "position",
      "color",
      "background-color",
      "font-size",
      "font-weight",
      "font-family",
      "line-height",
      "padding",
      "margin",
      "border",
      "border-radius",
      "width",
      "height",
      "opacity",
      "z-index",
      "flex-direction",
      "justify-content",
      "align-items",
      "gap",
      "text-align",
    ])
      computedStyle[property] = scrub(getComputedStyle(node).getPropertyValue(property)).slice(
        0,
        200,
      );
    // Scan the entire page for screenshot redaction, with a fail-closed budget.
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    const masks = new Set<string>(point.opaqueHosts ?? []);
    let current: Node | null;
    let visited = 0;
    while ((current = walker.nextNode())) {
      if (++visited > 20_000) throw new Error("Page exceeds safe inspection budget");
      const element = current instanceof Element ? current : current.parentElement;
      if (!element) continue;
      const generatedSecret =
        current instanceof Element &&
        ["::before", "::after"].some((pseudo) => {
          const content = getComputedStyle(element, pseudo).content;
          return content !== scrub(content);
        });
      const privateAlt =
        current instanceof Element &&
        element.localName === "img" &&
        scrub(element.getAttribute("alt") ?? "") !== (element.getAttribute("alt") ?? "");
      if (
        current instanceof Element &&
        (privateElement(element) ||
          element.localName.includes("-") ||
          generatedSecret ||
          privateAlt)
      ) {
        masks.add(selector(element));
        continue;
      }
      if (
        current.nodeType !== Node.TEXT_NODE ||
        !visible(element) ||
        element.closest("script,style,noscript,template")
      )
        continue;
      const value = (current.textContent ?? "").replace(/\s+/g, " ").trim();
      const safe = scrub(value);
      if (safe !== value) masks.add(selector(element));
      const isPrivate = opaqueAncestor(element);
      if (node.contains(current) && !isPrivate && text.length < 2000) text += `${safe} `;
    }
    if (masks.size > 512 || Array.from(masks).join(",").length > 65_536)
      throw new Error("Page exceeds safe redaction budget");
    result.masks = Array.from(masks);
  }
  result.element = {
    tag: node.localName,
    text: privateElement(node) ? "[form or sensitive content omitted]" : text.trim().slice(0, 2000),
    selector: selector(node),
    path: [...ancestry.map((entry) => entry.selectorPart), part(node)].join(" > "),
    bounds,
    center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ancestry,
    computedStyle,
  };
  return result;
}
