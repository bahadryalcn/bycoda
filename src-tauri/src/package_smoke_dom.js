// Injected only by the explicit, nonce-bound packaged smoke mode. No IPC mocks.
(() => {
  const request = window.__BYCODA_PACKAGE_SMOKE_REQUEST__;
  if (
    !request ||
    !window.__TAURI_INTERNALS__?.invoke ||
    window.__bycodaSmokeObserver === request.nonce
  )
    return;
  window.__bycodaSmokeObserver = request.nonce;
  let reading = false;
  const visible = (text) =>
    [...document.querySelectorAll("body *")].some(
      (element) =>
        element.children.length === 0 &&
        element.textContent?.includes(text) &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden",
    );
  const check = async () => {
    if (reading || !visible(request.title) || !visible(request.history)) return;
    reading = true;
    try {
      let session = await window.__TAURI_INTERNALS__.invoke("session_get", {
        sessionId: request.sessionId,
      });
      if (typeof session === "string") session = JSON.parse(session);
      const sessionRead =
        session?.id === request.sessionId &&
        session?.title === request.title &&
        session.blocks?.some((block) => block.text === request.history);
      await window.__TAURI_INTERNALS__.invoke("package_smoke_dom_proof", {
        nonce: request.nonce,
        sessionRead,
        titleVisible: visible(request.title),
        historyVisible: visible(request.history),
      });
      observer.disconnect();
    } catch {
      reading = false;
    }
  };
  const observer = new MutationObserver(() => {
    void check();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  void check();
})();
