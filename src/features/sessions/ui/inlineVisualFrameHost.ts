/**
 * The one element that holds an inline visual's preview. The card mounts its HtmlPreview into
 * this element once and moves the element between the inline, panel and full-view slots, so the
 * preview token and the sandboxed frame are never recreated by a view change.
 */
export function createInlineVisualFrameHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "h-full min-h-0";
  host.setAttribute("data-inline-visual-host", "");
  return host;
}

type StateKeepingParent = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/**
 * Puts `host` into `slot`. `moveBefore` is the state-preserving move: an iframe keeps its
 * document, scripts and focus. Where it is missing or refuses the move (another document, a
 * detached slot) the host is reparented with `appendChild`, which reloads the frame's document
 * from the same live preview token; the token and the sandbox are the same either way.
 */
export function moveInlineVisualFrameHost(host: HTMLElement, slot: HTMLElement) {
  if (host.parentNode === slot) return;
  const parent: StateKeepingParent = slot;
  let moved = false;
  if (host.isConnected && slot.isConnected && typeof parent.moveBefore === "function") {
    try {
      parent.moveBefore(host, null);
      moved = true;
    } catch {
      moved = false;
    }
  }
  if (!moved) slot.appendChild(host);
}
