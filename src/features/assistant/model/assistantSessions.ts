import { useCallback, useEffect, useRef, useState } from "react";
import type { HostSession } from "../../connections/model/protocol";
import { captureAssistantHostRead, type AssistantHostRead } from "./assistantHostRead";
export type AssistantSessionRecord = HostSession & { environmentId: string };

export async function readAssistantSession(
  sessionId: string,
  projectId: string | readonly string[],
  owner?: AssistantHostRead,
): Promise<AssistantSessionRecord> {
  const reader = owner ?? (await captureAssistantHostRead());
  const result = await reader.session(sessionId);
  if (!result?.session || result.session.id !== sessionId)
    throw new Error("The Host returned no matching session state.");
  if (!(typeof projectId === "string" ? [projectId] : projectId).includes(result.projectId))
    throw new Error("The session project no longer matches this job.");
  if (
    !["idle", "running", "interrupted"].includes(result.status) ||
    !Number.isFinite(result.updatedAt) ||
    result.updatedAt < 0
  )
    throw new Error("The Host returned invalid session status.");
  return { ...result, environmentId: reader.environmentId };
}

/** Each stable row owns a read, never a supervisor mutation. Failed refreshes
 * retain the old record for identity but the UI marks its measurement unavailable. */
export function useAssistantSession(
  sessionId: string,
  projectId: string | readonly string[],
  environmentId?: string,
) {
  const scopeKey = JSON.stringify(typeof projectId === "string" ? [projectId] : projectId);
  const bindingKey = JSON.stringify([sessionId, scopeKey, environmentId]);
  const [state, setState] = useState<{
    key: string;
    record: AssistantSessionRecord | null;
    loading: boolean;
    error: string;
  }>({ key: bindingKey, record: null, loading: true, error: "" });
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const binding = useRef<{ key: string; owner: AssistantHostRead } | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const request = ++epoch.current;
    inFlight.current = true;
    setState((current) => ({ ...current, loading: true }));
    try {
      const owner =
        binding.current?.key === bindingKey
          ? binding.current.owner
          : await captureAssistantHostRead(environmentId);
      if (epoch.current !== request) return;
      binding.current = { key: bindingKey, owner };
      const record = await readAssistantSession(sessionId, JSON.parse(scopeKey) as string[], owner);
      if (epoch.current === request)
        setState({ key: bindingKey, record, loading: false, error: "" });
    } catch (cause) {
      if (epoch.current === request)
        setState((current) => ({
          ...current,
          key: bindingKey,
          record: current.key === bindingKey ? current.record : null,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        }));
    } finally {
      if (epoch.current === request) inFlight.current = false;
    }
  }, [sessionId, scopeKey, environmentId, bindingKey]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 15000);
    return () => {
      epoch.current++;
      inFlight.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  return state.key === bindingKey
    ? { ...state, refresh }
    : { key: bindingKey, record: null, loading: true, error: "", refresh };
}
