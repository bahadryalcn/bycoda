import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isSingleLineCommand } from "./terminalSuggestions";

export type RemoteSuggestionSource = "commands" | "paths" | "history";

export type SshShellState = {
  id: string;
  status: "ready" | "suggestions" | "unavailable";
  shell: "bash" | "zsh" | "powershell";
  user: string;
  host: string;
  promptReady?: boolean;
  source?: RemoteSuggestionSource;
  requestId?: string;
  prefix?: string;
  cursor?: number;
  suggestions?: string[];
};

/** Structured native events only. Never infer a prompt from raw terminal text. */
export function validSshShellState(value: unknown, id: string): value is SshShellState {
  if (!value || typeof value !== "object") return false;
  const state = value as SshShellState;
  if (
    state.id !== id ||
    !["bash", "zsh", "powershell"].includes(state.shell) ||
    !["ready", "suggestions", "unavailable"].includes(state.status)
  )
    return false;
  if (
    typeof state.user !== "string" ||
    typeof state.host !== "string" ||
    !state.user ||
    !state.host ||
    state.user.length > 256 ||
    state.host.length > 256
  )
    return false;
  // oxlint-disable-next-line no-control-regex -- structured native scope labels must not contain terminal controls
  if (/[\x00-\x1f\x7f-\x9f]/.test(state.user + state.host)) return false;
  if (state.promptReady !== undefined && typeof state.promptReady !== "boolean") return false;
  if (state.source !== undefined && !["commands", "paths", "history"].includes(state.source))
    return false;
  if (state.status !== "suggestions") return true;
  if (
    !state.requestId ||
    typeof state.prefix !== "string" ||
    state.prefix.length > 1024 ||
    state.cursor !== new TextEncoder().encode(state.prefix).length
  )
    return false;
  if (!Array.isArray(state.suggestions) || state.suggestions.length > 20) return false;
  return state.suggestions.every(
    (command) =>
      typeof command === "string" &&
      command.length <= 4096 &&
      isSingleLineCommand(command) &&
      command.startsWith(state.prefix!) &&
      command !== state.prefix,
  );
}

export type SshShellController = ReturnType<typeof useSshShellIntegration>;

export function useSshShellIntegration(id: string, enabled: boolean) {
  // A session explicitly launched with shell integration previews safe commands
  // by default. Never inherit a previous session's history/path source.
  const [savedPreferences, updatePreferences] = useState({
    id,
    enabled,
    revision: 0,
    automatic: enabled,
    source: "commands" as RemoteSuggestionSource,
  });
  if (savedPreferences.id !== id || savedPreferences.enabled !== enabled) {
    updatePreferences({
      id,
      enabled,
      revision: savedPreferences.revision + 1,
      automatic: enabled,
      source: "commands",
    });
  }
  const matchesScope = savedPreferences.id === id && savedPreferences.enabled === enabled;
  const automatic = matchesScope && savedPreferences.automatic;
  const source: RemoteSuggestionSource = matchesScope ? savedPreferences.source : "commands";
  const passiveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const passiveAllowed = useRef(false);
  const preferences = useRef({
    automatic,
    source,
    enabled,
    id,
    revision: savedPreferences.revision,
  });
  useLayoutEffect(() => {
    preferences.current = { automatic, source, enabled, id, revision: savedPreferences.revision };
  }, [automatic, source, enabled, id, savedPreferences.revision]);
  const cancelPassive = useCallback(() => {
    clearTimeout(passiveTimer.current);
    passiveTimer.current = undefined;
  }, []);
  const [snapshot, setState] = useState<SshShellState>();
  const [snapshotRevision, setSnapshotRevision] = useState(-1);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const state =
    enabled && snapshot?.id === id && snapshotRevision === savedPreferences.revision
      ? snapshot
      : undefined;
  const waiting = enabled && waitingFor === id;
  const error = enabled && failure?.id === id ? failure.message : "";
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const epoch = useRef(0);
  const pending = useRef(false);
  const acknowledgement = useRef<string | undefined>(undefined);
  const trustedScope = useRef<{ host: string; user: string } | undefined>(undefined);
  const buffered = useRef<SshShellState | undefined>(undefined);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => {
    epoch.current += 1;
    passiveAllowed.current = false;
    trustedScope.current = undefined;
    cancelPassive();
    if (!enabled) return;
    let disposed = false;
    const listener = listen<unknown>("ssh-shell-state", (event) => {
      if (disposed || !validSshShellState(event.payload, id)) return;
      const value = event.payload;
      if (value.status === "ready") {
        const previousScope = trustedScope.current;
        trustedScope.current = { host: value.host, user: value.user };
        if (
          previousScope &&
          (previousScope.host !== value.host || previousScope.user !== value.user)
        ) {
          cancelPassive();
          epoch.current += 1;
          pending.current = false;
          acknowledgement.current = undefined;
          buffered.current = undefined;
          clearTimer();
          setWaitingFor(null);
          setFailure(undefined);
          const reset = {
            ...preferences.current,
            revision: preferences.current.revision + 1,
            automatic: false,
            source: "commands" as const,
          };
          preferences.current = reset;
          updatePreferences(reset);
        }
        if (pending.current) return;
        passiveAllowed.current = true;
        setSnapshotRevision(preferences.current.revision);
        setState(value);
        return;
      }
      if (value.status === "suggestions") {
        if (!pending.current) return;
        if (!acknowledgement.current) {
          buffered.current = value;
          return;
        }
        if (value.requestId !== acknowledgement.current) return;
      } else {
        passiveAllowed.current = value.promptReady === true;
        cancelPassive();
      }
      pending.current = false;
      buffered.current = undefined;
      clearTimer();
      setWaitingFor(null);
      setFailure(
        value.status === "unavailable"
          ? { id, message: "No safe matching suggestions." }
          : undefined,
      );
      setSnapshotRevision(preferences.current.revision);
      setState(value);
    });
    void listener.catch(() => {
      if (!disposed) setFailure({ id, message: "Remote shell integration is unavailable" });
    });
    return () => {
      disposed = true;
      passiveAllowed.current = false;
      cancelPassive();
      pending.current = false;
      epoch.current += 1;
      clearTimer();
      void listener.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [id, enabled, clearTimer, cancelPassive]);

  const request = useCallback(
    async (requestedSource?: RemoteSuggestionSource) => {
      if (!enabled) return;
      const current = ++epoch.current;
      acknowledgement.current = undefined;
      buffered.current = undefined;
      clearTimer();
      pending.current = true;
      setState((previous) =>
        previous?.id === id
          ? { ...previous, status: "ready", suggestions: undefined, requestId: undefined }
          : undefined,
      );
      setWaitingFor(id);
      setFailure(undefined);
      timer.current = setTimeout(() => {
        if (current === epoch.current) {
          pending.current = false;
          setWaitingFor(null);
          setFailure({
            id,
            message:
              "Suggestions are available only at a supported shell prompt with echo enabled.",
          });
        }
      }, 2500);
      try {
        const requestId = await invoke<string>("ssh_terminal_suggestions_request", {
          id,
          ...(requestedSource ? { source: requestedSource } : {}),
        });
        if (current !== epoch.current || !pending.current) return;
        if (typeof requestId !== "string" || !requestId)
          throw new Error("Remote shell integration is unavailable");
        acknowledgement.current = requestId;
        const early = buffered.current as SshShellState | undefined;
        buffered.current = undefined;
        if (early?.requestId === requestId) {
          pending.current = false;
          clearTimer();
          setWaitingFor(null);
          setSnapshotRevision(preferences.current.revision);
          setState(early);
        }
      } catch (reason) {
        if (current === epoch.current) {
          pending.current = false;
          clearTimer();
          setWaitingFor(null);
          setFailure({ id, message: String(reason) });
        }
      }
    },
    [id, enabled, clearTimer],
  );

  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  }, [request]);
  const notifyInput = useCallback(() => {
    cancelPassive();
    const preference = preferences.current;
    if (!preference.enabled || !preference.automatic || !passiveAllowed.current) return;
    const generation = epoch.current;
    passiveTimer.current = setTimeout(() => {
      if (
        generation === epoch.current &&
        preferences.current.id === preference.id &&
        preferences.current.automatic &&
        passiveAllowed.current
      )
        void requestRef.current(preferences.current.source);
    }, 250);
  }, [cancelPassive]);
  const suspendAutomatic = useCallback(() => {
    cancelPassive();
    epoch.current += 1;
    acknowledgement.current = undefined;
    buffered.current = undefined;
    pending.current = false;
    clearTimer();
    setWaitingFor(null);
    setState(undefined);
  }, [cancelPassive, clearTimer]);
  const setAutomatic = useCallback(
    (value: boolean) => {
      cancelPassive();
      if (!value) suspendAutomatic();
      updatePreferences({ ...preferences.current, automatic: value });
      preferences.current.automatic = value;
    },
    [cancelPassive, suspendAutomatic],
  );
  const setSource = useCallback(
    (value: RemoteSuggestionSource) => {
      cancelPassive();
      suspendAutomatic();
      updatePreferences({ ...preferences.current, source: value });
      preferences.current.source = value;
    },
    [cancelPassive, suspendAutomatic],
  );

  const dismiss = useCallback(() => {
    cancelPassive();
    epoch.current += 1;
    acknowledgement.current = undefined;
    buffered.current = undefined;
    pending.current = false;
    clearTimer();
    setWaitingFor(null);
    setFailure(undefined);
    setState((previous) =>
      previous?.id === id
        ? { ...previous, status: "ready", suggestions: undefined, requestId: undefined }
        : undefined,
    );
    if (enabled) void invoke("ssh_terminal_suggestions_dismiss", { id }).catch(() => undefined);
  }, [id, enabled, clearTimer, cancelPassive]);

  const accept = useCallback(
    async (value: string) => {
      if (
        !enabled ||
        state?.status !== "suggestions" ||
        !state.requestId ||
        !state.suggestions?.includes(value)
      )
        throw new Error("Suggestion is stale; request a new snapshot at the shell prompt");
      await invoke("ssh_terminal_suggestion_accept", { id, requestId: state.requestId, value });
      dismiss();
    },
    [id, enabled, state, dismiss],
  );

  const invalidate = useCallback(() => {
    cancelPassive();
    epoch.current += 1;
    acknowledgement.current = undefined;
    buffered.current = undefined;
    pending.current = false;
    clearTimer();
    setWaitingFor(null);
    setState(undefined);
  }, [clearTimer, cancelPassive]);

  return {
    state,
    waiting,
    error,
    request,
    dismiss,
    accept,
    invalidate,
    automatic,
    source,
    setAutomatic,
    setSource,
    notifyInput,
    suspendAutomatic,
  };
}
