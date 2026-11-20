import { QueryClientContext } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import { effectiveProjectKinds } from "../../features/projects/model/projectKinds";
import { subscribeProjectPathsChanged } from "../../features/projects/model/recents";
import {
  createProjectKindsSender,
  syncProjectKinds,
} from "../../features/model-routing/public/settings";

const SETTLE_MS = 800;
const STARTUP_MS = 4000;

/**
 * Sends the effective personal/work map to this computer's Host after a tag, a group tag or a
 * group assignment changes, and once shortly after startup. A send that fails (the Host may still
 * be starting) is retried with a bounded backoff and by the next change; it is never marked sent
 * until the Host confirms it. The Host reads it at run start.
 */
export function useProjectKindsSync(): void {
  // The app always has a client; a bare shell (a test fixture) has none and sends nothing.
  const client = useContext(QueryClientContext);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the project-store listener and startup timer attached while the shell is mounted
  useEffect(() => {
    if (!client) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sender = createProjectKindsSender({
      current: effectiveProjectKinds,
      sync: (kinds) => syncProjectKinds(undefined, kinds, client),
    });
    const schedule = (force: boolean, delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => sender.send(force), delay);
    };
    schedule(true, STARTUP_MS);
    const stop = subscribeProjectPathsChanged(() => schedule(false, SETTLE_MS));
    return () => {
      clearTimeout(timer);
      sender.dispose();
      stop();
    };
  }, [client]);
}
