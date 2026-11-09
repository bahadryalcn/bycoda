import { createElement, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { AssistantPresenceIndicator } from "../ui/AssistantPresenceIndicator";
import { assistantPresencePresentation } from "../model/assistantPresencePresentation";
import {
  canSetAssistantPresence,
  emptyAssistantPresence,
  nativeAssistantPresencePort,
  type AssistantPresenceChoice,
  type AssistantPresencePort,
  type AssistantPresenceView,
} from "../model/assistantPresence";

/**
 * The one owner of assistant presence state for every surface that shows or sets it (the
 * sidebar account menu). `begin` opens a choice session against a fresh host token and `end`
 * closes it; `items` and `pick` drive the availability choices of a DropdownMenu.
 */
export function useAssistantPresence(port: AssistantPresencePort = nativeAssistantPresencePort) {
  const supported = port !== nativeAssistantPresencePort || isTauri();
  const [view, setView] = useState(emptyAssistantPresence),
    [token, setToken] = useState<string | null | undefined>(undefined),
    [localError, setLocalError] = useState(false),
    [busy, setBusy] = useState(false);
  const active = useRef(true),
    inflight = useRef(false),
    latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  function accept(next: AssistantPresenceView) {
    if (active.current) {
      if (next.revision > latest.current.revision && !next.pending && !next.writeError)
        setLocalError(false);
      setView((current) => (next.revision >= current.revision ? next : current));
    }
  }
  useEffect(() => {
    if (!supported) return;
    active.current = true;
    let release: (() => void) | undefined;
    void port.read().then(accept, () => {
      if (active.current) setLocalError(true);
    });
    void port.subscribe(accept).then(
      (stop) => {
        if (active.current) release = stop;
        else stop();
      },
      () => {
        if (active.current) setLocalError(true);
      },
    );
    return () => {
      active.current = false;
      release?.();
    };
  }, [port, supported]);
  async function begin() {
    if (inflight.current) return;
    setToken(latest.current.sourceToken);
    setLocalError(false);
    inflight.current = true;
    setBusy(true);
    try {
      const next = await port.refresh();
      if (active.current) {
        accept(next);
        setToken(next.sourceToken);
      }
    } catch {
      if (active.current) setLocalError(true);
    } finally {
      inflight.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function change(state: AssistantPresenceChoice) {
    const captured = token;
    if (!captured || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const next = await port.set(captured, state);
      if (active.current) {
        accept(next);
        setLocalError(false);
        if (next.writeError) setToken(captured);
      }
    } catch {
      if (active.current) {
        setLocalError(true);
        setToken(captured);
      }
    } finally {
      inflight.current = false;
      if (active.current) setBusy(false);
    }
  }
  const hidden = !supported || Boolean(view.status && !view.status.setupComplete);
  const error = localError || view.statusError || view.writeError;
  const state = assistantPresencePresentation(
    view.status?.state,
    Boolean(error || view.pending || busy),
  ).state;
  const label = t(
    view.pending || busy ? "Updating availability..." : assistantPresencePresentation(state).label,
  );
  const items: DropdownMenuItem[] = [
    {
      kind: "group",
      id: "presence",
      label: t("Availability"),
      items: (["present", "away", "dnd"] as const).map((choice) => ({
        kind: "item",
        id: choice,
        label: t(assistantPresencePresentation(choice).label),
        icon: createElement(AssistantPresenceIndicator, { state: choice, markOnly: true }),
        checked: state === choice,
        selectionRole: "radio",
        disabled: busy || localError || !canSetAssistantPresence(view, token ?? null),
      })),
    },
  ];
  if (error)
    items.push({
      kind: "item",
      id: "failure",
      label: t("Availability change was not confirmed."),
      disabled: true,
    });
  if (view.writeError && view.retry)
    items.push({
      kind: "item",
      id: "retry",
      label: t("Retry"),
      disabled: view.pending || busy || token !== view.sourceToken,
    });
  /** Handles a picked id; returns false for ids that are not presence rows. */
  function pick(id: string): boolean {
    if (id === "retry" && view.retry) change(view.retry).catch(() => undefined);
    else if (id === "present" || id === "away" || id === "dnd") change(id).catch(() => undefined);
    else return false;
    return true;
  }
  return {
    hidden,
    state,
    label,
    error,
    busy,
    pending: view.pending,
    writeError: view.writeError,
    open: token !== undefined,
    items,
    begin,
    end: () => setToken(undefined),
    pick,
  };
}

export type AssistantPresenceControl = ReturnType<typeof useAssistantPresence>;
