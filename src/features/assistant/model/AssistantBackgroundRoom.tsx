import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { assistantRequest, useAssistantSnapshot } from "./assistantClient";
import { useAssistantControlSource } from "./useAssistantControlSource";

/** Keeps the real global Room registered to the owner window while Assistant is enabled. */
export function AssistantBackgroundRoom() {
  const { snapshot, environmentId, error } = useAssistantSnapshot();
  const [room, setRoom] = useState<{ threadId: string; environmentId: string }>();
  let primary = false;
  try { primary = getCurrentWindow().label === "main"; } catch { /* Native owner window unavailable. */ }
  const enabled = primary && !!environmentId && !error && snapshot?.profile.enabled === true && snapshot.profile.setupComplete === true;
  useEffect(() => {
    if (!enabled || !environmentId) { setRoom(undefined); return; }
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setRoom(undefined);
    const open = () => {
      void assistantRequest({ op: "threads.open" }, environmentId).then(result => {
        if (!result.thread || result.thread.projectId) throw new Error("Global Room source unavailable.");
        if (active) setRoom({ threadId: result.thread.id, environmentId });
      }).catch(() => { if (active) { setRoom(undefined); retry = setTimeout(open, 15_000); } });
    };
    open();
    return () => { active = false; if (retry) clearTimeout(retry); };
  }, [enabled, environmentId]);
  useAssistantControlSource(enabled && room?.environmentId === environmentId ? room.threadId : undefined, enabled ? environmentId ?? undefined : undefined, "background");
  return null;
}
