import { Cdp, cdpPage, type BrowserSession } from "../social-browser";

/** A selected page supplies the browser context; it is never navigated or closed. */
export async function attachExistingChrome(
  cdp: Cdp,
  selectedTarget: string,
  allowedHosts: readonly string[],
): Promise<BrowserSession> {
  const { targetInfos } = await cdp.send<{
    targetInfos: { targetId: string; type: string; url: string; browserContextId?: string }[];
  }>("Target.getTargets");
  const selected = targetInfos.find(
    (target) => target.targetId === selectedTarget && target.type === "page",
  );
  let url: URL;
  try {
    url = new URL(selected?.url ?? "");
  } catch {
    throw new Error("The selected Chrome tab is unavailable.");
  }
  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname))
    throw new Error("The selected Chrome tab is not a supported platform page.");
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
    ...(selected?.browserContextId ? { browserContextId: selected.browserContextId } : {}),
    background: true,
  });
  let sessionId: string | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await cdp.send("Target.closeTarget", { targetId });
    } finally {
      cdp.close();
    }
  };
  try {
    ({ sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    }));
    const attached = sessionId;
    const send = <T = any>(method: string, params?: Record<string, unknown>) =>
      cdp.send<T>(method, params, attached);
    await send("Page.enable");
    await send("Network.enable");
    const disconnected = new Promise<void>((resolve) => {
      void cdp.closed.then(resolve).catch(resolve);
      cdp.on((method, params) => {
        if (
          (method === "Target.detachedFromTarget" && params.sessionId === attached) ||
          (method === "Target.targetDestroyed" && params.targetId === targetId)
        )
          resolve();
      });
    });
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    return { page: cdpPage(cdp, attached, send), closed: disconnected, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
