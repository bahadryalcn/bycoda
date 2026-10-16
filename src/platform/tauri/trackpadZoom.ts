import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { IS_MAC } from "./platform";

const claims: { handler: (delta: number) => void }[] = [];
let stop: UnlistenFn | undefined;
let owner: object | undefined;
let tail = Promise.resolve();
function reconcile() {
  tail = tail.catch(() => undefined).then(async () => {
    if (claims.length && !stop) {
      const subscription = {};
      const release = await listen<number>("trackpad_magnify", event => {
        if (owner === subscription && Number.isFinite(event.payload)) claims[claims.length - 1]?.handler(event.payload);
      });
      owner = subscription;
      try { await invoke("set_trackpad_zoom_enabled", { enabled: true }); stop = release; }
      catch (error) {
        owner = undefined; release();
        await invoke("set_trackpad_zoom_enabled", { enabled: false }).catch(() => undefined);
        throw error;
      }
    }
    if (!claims.length && stop) {
      const release = stop; stop = undefined;
      owner = undefined;
      try { await invoke("set_trackpad_zoom_enabled", { enabled: false }); }
      finally { release(); }
    }
  }).catch(error => console.warn("Native image pinch is unavailable", error));
}
/** One native subscription per window; the most recent hovered/focused image owns it. */
export function claimTrackpadMagnify(handler: (delta: number) => void): () => void {
  if (!IS_MAC || !isTauri()) return () => {};
  const claim = { handler }; claims.push(claim); reconcile();
  let released = false;
  return () => {
    if (released) return; released = true;
    const at = claims.indexOf(claim); if (at >= 0) claims.splice(at, 1);
    reconcile();
  };
}
