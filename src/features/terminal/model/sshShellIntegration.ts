import { invoke } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { isSingleLineCommand } from "./terminalSuggestions";

export type RemoteSuggestionSource = "commands" | "paths" | "history";

export type SshShellState = {
  id: string;
  status: "ready" | "suggestions" | "unavailable" | "catalog";
  shell: "bash" | "zsh" | "powershell";
  user: string;
  host: string;
  promptReady?: boolean;
  source?: RemoteSuggestionSource;
  requestId?: string;
  prefix?: string;
  cursor?: number;
  suggestions?: string[];
  /** On `catalog` events: the prompt-time list that `suggestions` replaces. */
  catalog?: "history" | "commands";
};

/** One literal catalog line: the same policy the shell and the native side apply. */
const CATALOG_VALUE = /^[a-zA-Z0-9./_:][a-zA-Z0-9 ./_:-]*$/;
const MAX_CATALOG = 4000;
const MAX_MATCHES = 12;

/** Prompt-time candidates issued by the shell, filtered here on every keystroke. */
export type SshShellCatalog = { history: string[]; commands: string[] };

/**
 * Matches for the echoed prefix. There is no shell round trip: while the owner
 * types only the suggestion list changes, the shell line is never redrawn.
 */
export function catalogSuggestions(
  catalog: SshShellCatalog | undefined,
  source: RemoteSuggestionSource,
  prefix: string,
): string[] {
  // An empty prefix (explicit selection at an empty prompt) lists the newest entries.
  if (
    !catalog ||
    source === "paths" ||
    prefix.length > 256 ||
    (prefix !== "" && !CATALOG_VALUE.test(prefix))
  )
    return [];
  const pool = source === "history" ? catalog.history : [...catalog.history, ...catalog.commands];
  const matches: string[] = [];
  for (const value of pool) {
    if (value === prefix || !value.startsWith(prefix) || matches.includes(value)) continue;
    matches.push(value);
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

/** Structured native events only. Never infer a prompt from raw terminal text. */
export function validSshShellState(value: unknown, id: string): value is SshShellState {
  if (!value || typeof value !== "object") return false;
  const state = value as SshShellState;
  if (
    state.id !== id ||
    !["bash", "zsh", "powershell"].includes(state.shell) ||
    !["ready", "suggestions", "unavailable", "catalog"].includes(state.status)
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
  if (state.status === "catalog")
    return (
      (state.catalog === "history" || state.catalog === "commands") &&
      Array.isArray(state.suggestions) &&
      state.suggestions.length <= MAX_CATALOG &&
      state.suggestions.every(
        (entry) => typeof entry === "string" && entry.length <= 256 && CATALOG_VALUE.test(entry),
      )
    );
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

/**
 * The passive list for the echoed prefix, filtered from the prompt catalog.
 * Native code still verifies every insertion against the catalog it issued.
 */
export type SshShellPreview = { prefix: string; suggestions: string[] };

type ShellSubscriber = { receive: (payload: unknown) => void; failed: () => void };
const shellSubscribers = new Map<string, Set<ShellSubscriber>>();
type ShellBridge = { ready: Promise<void>; stop?: () => void };
let shellBridge: ShellBridge | undefined;

function ensureShellBridge() {
  if (!shellBridge) {
    const bridge: ShellBridge = { ready: Promise.resolve() };
    shellBridge = bridge;
    bridge.ready = listenWindowAsync<unknown>("ssh-shell-state", ({ payload }) => {
      if (shellBridge !== bridge || !payload || typeof payload !== "object") return;
      const id = (payload as { id?: unknown }).id;
      if (typeof id !== "string") return;
      for (const entry of shellSubscribers.get(id) ?? []) entry.receive(payload);
    }).then(
      (stop) => {
        if (shellBridge !== bridge) stop();
        else bridge.stop = stop;
      },
      (error: unknown) => {
        if (shellBridge === bridge) {
          shellBridge = undefined;
          for (const group of shellSubscribers.values()) for (const entry of group) entry.failed();
        }
        throw error;
      },
    );
    void bridge.ready.catch(() => {});
  }
  return shellBridge!;
}

function subscribeShellState(id: string, subscriber: ShellSubscriber) {
  const entries = shellSubscribers.get(id) ?? new Set<ShellSubscriber>();
  entries.add(subscriber);
  shellSubscribers.set(id, entries);
  const bridge = ensureShellBridge();
  let disposed = false;
  return {
    ready: bridge.ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.delete(subscriber);
      if (!entries.size && shellSubscribers.get(id) === entries) shellSubscribers.delete(id);
      if (!shellSubscribers.size && shellBridge) {
        const current = shellBridge;
        shellBridge = undefined;
        current.stop?.();
      }
    },
  };
}

function requestSuggestions(id: string, source: RemoteSuggestionSource | undefined) {
  return invoke<string>("ssh_terminal_suggestions_request", {
    id,
    ...(source ? { source } : {}),
  });
}

function isInvalidRequestId(requestId: unknown) {
  return typeof requestId !== "string" || !requestId;
}

function answersRequest(state: SshShellState | undefined, requestId: string) {
  return state?.requestId === requestId;
}

// The compiler cannot lower a `throw` inside the request try/catch; a call can.
function throwShellUnavailable(): never {
  throw new Error("Remote shell integration is unavailable");
}

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
  const [snapshot, setState] = useState<SshShellState>();
  const [snapshotRevision, setSnapshotRevision] = useState(-1);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string; details?: string }>();
  const state =
    enabled && snapshot?.id === id && snapshotRevision === savedPreferences.revision
      ? snapshot
      : undefined;
  const waiting = enabled && waitingFor === id;
  const notice = enabled && failure?.id === id ? failure.message : "";
  const noticeDetails = enabled && failure?.id === id ? failure.details : undefined;
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
  const [catalogState, setCatalog] = useState<SshShellCatalog & { id: string; revision: number }>();
  const catalog =
    enabled && catalogState?.id === id && catalogState.revision === savedPreferences.revision
      ? catalogState
      : undefined;
  // The native prompt capability: true only at a verified, echoing shell prompt.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const promptReady = enabled && readyFor === id;
  // Bumped when the owner dismisses, accepts or a view hides the list. The
  // passive list then stays closed until the next typed edit.
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const closePreview = useCallback(() => setPreviewEpoch((value) => value + 1), []);
  const listenerReady = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    epoch.current += 1;
    trustedScope.current = undefined;
    setReadyFor(null);
    if (!enabled) return;
    let disposed = false;
    const listener = subscribeShellState(id, {
      receive: (payload) => {
        if (disposed || !validSshShellState(payload, id)) return;
        const value = payload;
        if (value.status === "catalog") {
          // Lists belong to the account whose prompt announced readiness.
          const scope = trustedScope.current;
          if (!scope || scope.host !== value.host || scope.user !== value.user) return;
          const kind = value.catalog === "history" ? "history" : "commands";
          const revision = preferences.current.revision;
          setCatalog((previous) => {
            const base =
              previous?.id === id && previous.revision === revision
                ? previous
                : { id, revision, history: [], commands: [] };
            return { ...base, [kind]: value.suggestions ?? [] };
          });
          return;
        }
        setReadyFor(value.status === "suggestions" || value.promptReady === true ? id : null);
        if (value.status === "ready") {
          const previousScope = trustedScope.current;
          trustedScope.current = { host: value.host, user: value.user };
          if (
            previousScope &&
            (previousScope.host !== value.host || previousScope.user !== value.user)
          ) {
            epoch.current += 1;
            pending.current = false;
            acknowledgement.current = undefined;
            buffered.current = undefined;
            clearTimer();
            setWaitingFor(null);
            setFailure(undefined);
            setCatalog(undefined);
            closePreview();
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
        }
        pending.current = false;
        buffered.current = undefined;
        clearTimer();
        setWaitingFor(null);
        setFailure(
          value.status === "unavailable"
            ? { id, message: t("No safe matching suggestions.") }
            : undefined,
        );
        setSnapshotRevision(preferences.current.revision);
        setState(value);
      },
      failed: () => {
        if (!disposed) setFailure({ id, message: t("Remote shell integration is unavailable") });
      },
    });
    listenerReady.current = listener.ready;
    return () => {
      disposed = true;
      pending.current = false;
      epoch.current += 1;
      clearTimer();
      listenerReady.current = undefined;
      listener.dispose();
    };
  }, [id, enabled, clearTimer, closePreview]);

  /** An explicit snapshot (selection mode, saved commands). Never sent per keystroke. */
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
            message: t(
              "Suggestions are available only at a supported shell prompt with echo enabled.",
            ),
          });
        }
      }, 2500);
      // Logical expressions cannot be lowered inside the try block below.
      const superseded = () => current !== epoch.current || !pending.current;
      try {
        if (!listenerReady.current) throwShellUnavailable();
        listenerReady.current = ensureShellBridge().ready;
        await listenerReady.current;
        if (superseded()) return;
        const requestId = await requestSuggestions(id, requestedSource);
        if (superseded()) return;
        if (isInvalidRequestId(requestId)) throwShellUnavailable();
        acknowledgement.current = requestId;
        const early = buffered.current as SshShellState | undefined;
        buffered.current = undefined;
        if (answersRequest(early, requestId)) {
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
          setFailure({
            id,
            message: t("Remote shell integration is unavailable"),
            details: String(reason),
          });
        }
      }
    },
    [id, enabled, clearTimer],
  );

  const suspendAutomatic = useCallback(() => {
    epoch.current += 1;
    acknowledgement.current = undefined;
    buffered.current = undefined;
    pending.current = false;
    clearTimer();
    setWaitingFor(null);
    closePreview();
    setState(undefined);
  }, [clearTimer, closePreview]);
  const setAutomatic = useCallback(
    (value: boolean) => {
      if (!value) suspendAutomatic();
      updatePreferences({ ...preferences.current, automatic: value });
      preferences.current.automatic = value;
    },
    [suspendAutomatic],
  );
  const setSource = useCallback(
    (value: RemoteSuggestionSource) => {
      suspendAutomatic();
      updatePreferences({ ...preferences.current, source: value });
      preferences.current.source = value;
    },
    [suspendAutomatic],
  );

  const dismiss = useCallback(() => {
    epoch.current += 1;
    acknowledgement.current = undefined;
    buffered.current = undefined;
    pending.current = false;
    clearTimer();
    setWaitingFor(null);
    setFailure(undefined);
    closePreview();
    setState((previous) =>
      previous?.id === id
        ? { ...previous, status: "ready", suggestions: undefined, requestId: undefined }
        : undefined,
    );
    if (enabled) void invoke("ssh_terminal_suggestions_dismiss", { id }).catch(() => undefined);
  }, [id, enabled, clearTimer, closePreview]);

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

  /** Typed input ends an explicit snapshot; the passive list follows the echoed prefix. */
  const invalidate = useCallback(
    (textEdit = false) => {
      epoch.current += 1;
      acknowledgement.current = undefined;
      buffered.current = undefined;
      pending.current = false;
      clearTimer();
      setWaitingFor(null);
      if (!textEdit) closePreview();
      setState(undefined);
    },
    [clearTimer, closePreview],
  );

  /** Passive matches for the echoed prefix from the current prompt's catalog. */
  const catalogMatches = (prefix: string) =>
    automatic && promptReady ? catalogSuggestions(catalog, source, prefix) : [];

  /**
   * Explicit selection from the prompt catalog. Undefined when the prompt is not
   * verified, the source needs the shell (paths) or no catalog arrived yet: the
   * caller then falls back to a snapshot request.
   */
  const catalogSelection = (prefix: string | null): SshShellPreview | undefined =>
    promptReady && source !== "paths" && catalog && prefix !== null
      ? { prefix, suggestions: catalogSuggestions(catalog, source, prefix) }
      : undefined;

  /**
   * Opens selection without writing a request chord: the shell's line editor
   * would erase and redraw the prompt for every Ctrl+Space. False: request instead.
   */
  const selectFromCatalog = (prefix: string | null) => {
    if (!catalogSelection(prefix)) return false;
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
    return true;
  };

  /** Native code re-checks the value against the catalog this prompt issued. */
  const acceptCatalog = useCallback(
    async (prefix: string, value: string) => {
      if (!enabled) throwShellUnavailable();
      await invoke("ssh_terminal_catalog_accept", { id, prefix, value });
      closePreview();
    },
    [id, enabled, closePreview],
  );

  return {
    state,
    waiting,
    notice,
    noticeDetails,
    request,
    dismiss,
    accept,
    invalidate,
    automatic,
    source,
    setAutomatic,
    setSource,
    suspendAutomatic,
    promptReady,
    previewEpoch,
    catalogMatches,
    catalogSelection,
    selectFromCatalog,
    acceptCatalog,
  };
}
