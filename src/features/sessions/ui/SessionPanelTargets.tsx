import { createContext, useContext, useLayoutEffect, useRef } from "react";

export type SessionPanelTarget = {
  sessionId: string;
  host: HTMLElement;
  visible: boolean;
  focused: boolean;
  inSplit: boolean;
};
export const SessionPanelTargetsContext = createContext<{
  sessionIds: readonly string[];
  register(target: SessionPanelTarget): () => void;
} | null>(null);

/** A workspace location for a conversation already mounted by a feature panel. */
export function SessionPanelTargetHost({
  sessionId,
  visible,
  focused,
  inSplit,
}: Omit<SessionPanelTarget, "host">) {
  const context = useContext(SessionPanelTargetsContext)!;
  const host = useRef<HTMLDivElement>(null);
  const register = context.register;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Registers this DOM host as the session portal destination and unregisters it on scope changes or unmount.
  useLayoutEffect(
    function syncPanelSessionHost() {
      if (host.current)
        return register({ sessionId, host: host.current, visible, focused, inSplit });
    },
    [sessionId, visible, focused, inSplit, register],
  );
  return <div ref={host} className="flex h-full min-h-0 min-w-0 flex-1 flex-col" />;
}
