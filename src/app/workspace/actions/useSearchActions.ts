import { useCallback, useState, startTransition, type Dispatch, type SetStateAction } from "react";

export interface SearchActionDeps {
  activeTabId: string | null | undefined;
  onCloseTab: (tabId: string) => unknown;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewFocusToken: Dispatch<SetStateAction<number>>;
}

/** Search surface open/close and closing the focused tab. */
export function useSearchActions(deps: SearchActionDeps): {
  onCloseCurrentTab: () => unknown;
  onOpenSearch: () => void;
  onLeaveSearch: () => void;
  searchDialogOpen: boolean;
  onExpandSearch: () => void;
} {
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const {
    activeTabId,
    onCloseTab,
    setFilePickerOpen,
    setSettingsOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSearchViewOpen,
    setSearchViewFocusToken,
  } = deps;

  const onCloseCurrentTab = useCallback(
    () => (activeTabId ? onCloseTab(activeTabId) : undefined),
    [activeTabId, onCloseTab],
  );

  const onOpenSearch = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setSearchDialogOpen(true);
      setSearchViewFocusToken((token) => token + 1);
    });
  }, []);

  const onExpandSearch = useCallback(() => {
    startTransition(() => {
      setSearchDialogOpen(false);
      setSettingsOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setSearchViewOpen(true);
      setSearchViewFocusToken((token) => token + 1);
    });
  }, []);

  const onLeaveSearch = useCallback(() => {
    setSearchDialogOpen(false);
    setSearchViewOpen(false);
  }, []);

  return { onCloseCurrentTab, onOpenSearch, onLeaveSearch, searchDialogOpen, onExpandSearch };
}
