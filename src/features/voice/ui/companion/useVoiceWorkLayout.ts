import { useEffect, useRef, useState } from "react";
import {
  requestVoiceWorkLayout,
  type VoiceWorkLayout,
  type VoiceWorkLayoutContext,
  type VoiceWorkLayoutFacts,
} from "../../model/voiceWorkLayout";

type LayoutRequest = { key: string; controller: AbortController };
type LayoutState = {
  loading: LayoutRequest | null;
  errorKey: string | null;
  suggestion: { scope: string; plan: VoiceWorkLayout } | null;
};

export function useVoiceWorkLayout(
  context: VoiceWorkLayoutContext | undefined,
  facts: VoiceWorkLayoutFacts,
) {
  const scope = context
    ? JSON.stringify([context.scopeId, context.projectPath, context.expectedEnvironmentId])
    : null;
  const key = scope ? JSON.stringify([scope, facts]) : null;
  const [state, setState] = useState<LayoutState>({
    loading: null,
    errorKey: null,
    suggestion: null,
  });
  const pending = useRef<LayoutRequest | null>(null);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Cancel waiting for a Host decision when its evidence or owner changes.
  useEffect(
    () => () => {
      if (pending.current?.key !== key) return;
      pending.current.controller.abort();
      pending.current = null;
    },
    [key],
  );

  const generate = async () => {
    if (!context || !scope || !key || pending.current?.key === key) return;
    pending.current?.controller.abort();
    const request = { key, controller: new AbortController() };
    pending.current = request;
    setState((current) => ({ ...current, loading: request, errorKey: null }));
    try {
      const plan = await requestVoiceWorkLayout(context, facts, request.controller.signal);
      if (pending.current !== request) return;
      setState((current) => ({
        loading: null,
        errorKey: plan ? null : key,
        suggestion: plan ? { scope, plan } : current.suggestion,
      }));
    } catch {
      if (pending.current !== request) return;
      setState((current) => ({ ...current, loading: null, errorKey: key }));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  };

  const stopWaiting = () => {
    pending.current?.controller.abort();
    pending.current = null;
    setState((current) => ({ ...current, loading: null }));
  };

  const useDefault = () => {
    stopWaiting();
    setState({ loading: null, errorKey: null, suggestion: null });
  };

  const loading = Boolean(
    state.loading && state.loading.key === key && !state.loading.controller.signal.aborted,
  );
  return {
    plan: state.suggestion?.scope === scope ? state.suggestion.plan : null,
    error: Boolean(state.errorKey && state.errorKey === key),
    loading,
    generate,
    stopWaiting,
    useDefault,
  };
}
