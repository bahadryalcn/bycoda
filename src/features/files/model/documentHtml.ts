import DOMPurify from "dompurify";

const ALLOWED_LINK = /^(https?:|mailto:)/i;

/**
 * Make converted Word HTML safe to inject. The input is attacker-controlled
 * (any .docx can be opened), so on top of DOMPurify's defaults this removes
 * styles and form controls, keeps only embedded `data:image/` pictures, and
 * turns links into inert text that shows its target as a tooltip: a click
 * would otherwise navigate the app's own webview away from the viewer.
 */
export function sanitizeDocumentHtml(html: string): string {
  const body = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["style", "class", "id", "name"],
    RETURN_DOM: true,
  }) as HTMLElement;
  for (const image of Array.from(body.querySelectorAll("img"))) {
    if (!/^data:image\//i.test(image.getAttribute("src") ?? "")) image.remove();
  }
  for (const link of Array.from(body.querySelectorAll("a"))) {
    const href = link.getAttribute("href") ?? "";
    link.removeAttribute("href");
    link.removeAttribute("target");
    if (ALLOWED_LINK.test(href)) link.setAttribute("title", href);
  }
  return body.innerHTML;
}
