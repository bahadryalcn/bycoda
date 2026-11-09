import type { BrowserPage, BrowserSession } from "../social-browser";
import { liveViews } from "./live-view";
import type { BrowserVisibility, LayeredBrowserDriver, LayerStep } from "./types";

/**
 * Optional browser-layer hooks given to the browser session classes. An empty object means recipes run
 * directly, exactly as before the layers existed (tests and standalone use).
 */
export type BrowserWiring = {
  layers?: LayeredBrowserDriver;
  tracker?: BrowserTracker;
  /** Visibility of one account's browser. Hidden when not provided. */
  visibility?: (accountId: string) => Promise<BrowserVisibility>;
};

/** Live page of each account's open browser, and its live-view attachment while it is open. */
export class BrowserTracker {
  private readonly open = new Map<string, { page: BrowserPage; token: object }>();

  /** Registers an open session. The returned release must run before the session is closed. */
  track(accountId: string, session: Pick<BrowserSession, "page" | "screencast">): () => void {
    const token = {};
    this.open.set(accountId, { page: session.page, token });
    const detach = session.screencast ? liveViews.attach(accountId, session.screencast) : undefined;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      detach?.();
      if (this.open.get(accountId)?.token === token) this.open.delete(accountId);
    };
  }

  page(accountId: string): BrowserPage | undefined {
    return this.open.get(accountId)?.page;
  }
}

/** Runs one recipe step through the layered driver when it is wired; otherwise runs the recipe directly. */
export function runLayered<T>(
  wiring: BrowserWiring,
  accountId: string,
  step: LayerStep<T>,
): Promise<T> {
  return wiring.layers ? wiring.layers.run(accountId, step) : step.recipe();
}

export async function visibilityOf(
  wiring: BrowserWiring,
  accountId: string,
): Promise<BrowserVisibility> {
  return (await wiring.visibility?.(accountId)) ?? "hidden";
}
