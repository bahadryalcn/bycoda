import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { effectiveProjectKinds } from "../../features/projects/model/projectKinds";
import { subscribeProjectPathsChanged } from "../../features/projects/model/recents";
import { syncProjectKinds } from "../../features/model-routing/public/settings";

const SETTLE_MS = 800;
const STARTUP_MS = 4000;
let lastSent = "";

/**
 * Sends the effective personal/work map to this computer's Host after a tag, a group tag or a
 * group assignment changes, and once shortly after startup (the Host may still be starting, so a
 * failed first send is simply retried by the next change). The Host reads it at run start.
 */
export function useProjectKindsSync(): void {
  const client = useQueryClient();
  // Reason: the sync listens to the project stores for the shell's lifetime and must unsubscribe.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (force: boolean) => {
      const kinds = effectiveProjectKinds();
      const signature = JSON.stringify(kinds);
      if (!force && signature === lastSent) return;
      lastSent = signature;
      void syncProjectKinds(undefined, kinds, client).catch((error: unknown) =>
        console.warn("Project tag sync failed", error),
      );
    };
    const schedule = (force: boolean, delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => send(force), delay);
    };
    schedule(true, STARTUP_MS);
    const stop = subscribeProjectPathsChanged(() => schedule(false, SETTLE_MS));
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [client]);
}
