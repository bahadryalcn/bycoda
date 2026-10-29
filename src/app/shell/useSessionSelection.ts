import { useEffect, useEffectEvent, useState } from "react";
import {
  pruneSessionSelection,
  selectAllSessions,
  sessionSelectionRange,
  toggleSessionSelection,
} from "../../features/sessions/model/sessionSelection";
import { useSessionBulkDelete, type SessionBulkDeleteOptions } from "./useSessionBulkDelete";

type SelectionState = {
  /** The project the sessions tab shows, or null while another tab is open. */
  scope: string | null;
  /** Navigation order the selection was last pruned against. */
  navigationKey: string;
  ids: ReadonlySet<string>;
  mode: boolean;
  anchor: string | null;
  /** Selected only to act on through the open context menu. */
  contextual: boolean;
  /** Mode entered by holding a card: deselecting the last card leaves it. */
  longPress: boolean;
};

const NO_IDS: ReadonlySet<string> = new Set();

const emptySelection = (scope: string | null, navigationKey: string): SelectionState => ({
  scope,
  navigationKey,
  ids: NO_IDS,
  mode: false,
  anchor: null,
  contextual: false,
  longPress: false,
});

const cleared = (state: SelectionState): SelectionState => ({
  ...state,
  ids: NO_IDS,
  mode: false,
  anchor: null,
  contextual: false,
  longPress: false,
});

export type SessionSelectionOptions = {
  /** Selection belongs to the sessions tab of one project; null clears it. */
  scope: string | null;
  navigationIds: readonly string[];
  navigationKey: string;
  /** Whether the Delete key may delete the selection. */
  canDelete: boolean;
  /** A selection-ending gesture also closes the session context menu. */
  onDismissMenu: () => void;
  bulkDelete: Omit<SessionBulkDeleteOptions, "onDeleted">;
};

export type SessionSelectEvent = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

/**
 * Session list selection (click ranges, toggles, long press, context menu) and
 * the bulk delete that acts on it. State is owned per sessions tab and project:
 * leaving the tab, switching project or the list no longer showing a session
 * adjusts it while rendering instead of after a commit.
 */
export function useSessionSelection({
  scope,
  navigationIds,
  navigationKey,
  canDelete,
  onDismissMenu,
  bulkDelete,
}: SessionSelectionOptions) {
  const [state, setState] = useState(() => emptySelection(scope, navigationKey));
  if (state.scope !== scope) {
    setState(emptySelection(scope, navigationKey));
  } else if (state.navigationKey !== navigationKey) {
    const available = new Set(navigationIds);
    setState({
      ...state,
      navigationKey,
      ids: pruneSessionSelection(state.ids, available),
      anchor: state.anchor && available.has(state.anchor) ? state.anchor : null,
    });
  }

  const bulk = useSessionBulkDelete({
    ...bulkDelete,
    onDeleted: (deleted) =>
      setState((current) => ({
        ...current,
        ids: new Set([...current.ids].filter((id) => !deleted.has(id))),
      })),
  });

  const selectedOrderedIds = navigationIds.filter((id) => state.ids.has(id));
  const showBulkBar = state.mode || (state.ids.size > 0 && !state.contextual);

  const clear = () => setState(cleared);
  const selectAll = () =>
    setState((current) => ({
      ...current,
      contextual: false,
      ids: selectAllSessions(current.ids, navigationIds),
    }));
  /** Starts selecting from the header button, with nothing selected yet. */
  const enterMode = () => setState((current) => ({ ...current, contextual: false, mode: true }));
  /** The menu's Select item: select one card and keep selecting. */
  const startSelecting = (sessionId: string) =>
    setState((current) => ({
      ...current,
      ids: new Set([sessionId]),
      mode: true,
      anchor: sessionId,
      contextual: false,
      longPress: false,
    }));
  /** A card context menu acts on its card unless that card is already selected. */
  const beginContextMenu = (sessionId: string) =>
    setState((current) => {
      const contextual = !current.ids.has(sessionId);
      return {
        ...current,
        contextual,
        ids: contextual ? new Set([sessionId]) : current.ids,
      };
    });
  const endContextMenu = () =>
    setState((current) =>
      current.contextual
        ? { ...current, contextual: false, anchor: null, ids: NO_IDS }
        : current,
    );
  /** Holding a card starts selecting from it, like the menu's Select item. */
  const longPress = (sessionId: string) =>
    setState((current) => ({
      ...current,
      contextual: false,
      anchor: sessionId,
      longPress: current.mode ? current.longPress : true,
      mode: true,
      ids: new Set([...current.ids, sessionId]),
    }));
  /**
   * A card click. Returns true when it only changed the selection; false means
   * a plain click, which the caller treats as opening the session.
   */
  const select = (
    sessionId: string,
    event: SessionSelectEvent,
    visibleIds: readonly string[],
    fallbackAnchor?: string,
  ): boolean => {
    const additive = event.ctrlKey || event.metaKey || state.mode;
    if (event.shiftKey) {
      setState((current) => {
        const kept = current.anchor && visibleIds.includes(current.anchor) ? current.anchor : null;
        const anchor = kept ?? fallbackAnchor ?? sessionId;
        const range = sessionSelectionRange(visibleIds, anchor, sessionId);
        return {
          ...current,
          contextual: false,
          anchor: visibleIds.includes(anchor) ? anchor : sessionId,
          ids: new Set(additive ? [...current.ids, ...range] : range),
        };
      });
      return true;
    }
    if (additive) {
      setState((current) => {
        const ids = toggleSessionSelection(current.ids, sessionId);
        if (ids.size > 0) return { ...current, contextual: false, anchor: sessionId, ids };
        return {
          ...current,
          contextual: false,
          anchor: null,
          ids,
          mode: current.longPress ? false : current.mode,
          longPress: false,
        };
      });
      return true;
    }
    setState((current) => ({ ...current, contextual: false, anchor: sessionId, ids: NO_IDS }));
    return false;
  };

  const dismissFromWindow = useEffectEvent(() => {
    setState(cleared);
    onDismissMenu();
  });
  const selectAllFromKey = useEffectEvent(selectAll);
  const deleteFromKey = useEffectEvent(() => {
    if (canDelete) void bulk.bulkDeleteSessions(selectedOrderedIds);
  });
  const selecting = state.ids.size > 0 || state.mode;
  const { mode, contextual } = state;
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissFromWindow();
        return;
      }
      if (event.defaultPrevented || contextual) return;
      const target = event.target instanceof Element ? event.target : null;
      // Typing, dialogs and menus keep their own keys.
      if (target?.closest("input,textarea,select,[contenteditable],[role='dialog'],[role='menu']"))
        return;
      if (target && target !== document.body && !target.closest("[data-session-list-panel]"))
        return;
      const mod = event.ctrlKey || event.metaKey;
      if (mode && mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllFromKey();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !mod && !event.altKey) {
        event.preventDefault();
        deleteFromKey();
      }
    };
    // A pointer landing off the cards drops the selection; a menu acting on
    // it stays open, and the cards handle their own clicks. Selection mode
    // also survives the rest of the session list, such as its search field.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (el?.closest("[data-session-card],[data-popover-side],[data-session-selection-keep]"))
        return;
      if (mode && el?.closest("[data-session-list-panel]")) return;
      dismissFromWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selecting, mode, contextual]);

  return {
    selectedSessionIds: state.ids,
    selectionMode: state.mode,
    /** The selection exists only for the open context menu. */
    contextSelection: state.contextual,
    selectedOrderedIds,
    showBulkBar,
    clear,
    selectAll,
    enterMode,
    startSelecting,
    beginContextMenu,
    endContextMenu,
    longPress,
    select,
    bulkNotice: bulk.bulkNotice,
    deleteProgress: bulk.deleteProgress,
    deleteNoticeError: bulk.deleteNoticeError,
    deleteNoticeCwd: bulk.deleteNoticeCwd,
    deleting: bulk.deleting,
    dismissBulkNotice: bulk.dismissBulkNotice,
    bulkDeleteSessions: bulk.bulkDeleteSessions,
  };
}
