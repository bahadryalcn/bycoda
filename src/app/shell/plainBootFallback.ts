/**
 * Last-resort startup failure screen. Plain DOM and no imports on purpose: it must work
 * when React, i18n, CSS or any other chunk failed to load. English only for that reason.
 */
export function renderPlainBootFallback(doc: Document, error: unknown, reload: () => void): void {
  doc.getElementById("boot-splash")?.remove();
  const host = doc.getElementById("root") ?? doc.body;
  const surface = doc.createElement("div");
  surface.dataset.plainBootFallback = "true";
  surface.setAttribute("role", "alert");
  surface.style.cssText =
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:100vh;padding:24px;text-align:center;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText";
  const title = doc.createElement("h1");
  title.textContent = "Couldn’t start the app";
  title.style.cssText = "margin:0;font-size:18px";
  const detail = doc.createElement("p");
  detail.textContent = error instanceof Error && error.message ? error.message : String(error);
  detail.style.cssText = "margin:0;max-width:520px;opacity:0.75;overflow-wrap:anywhere";
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Reload app";
  button.addEventListener("click", reload);
  surface.append(title, detail, button);
  host.replaceChildren(surface);
}
