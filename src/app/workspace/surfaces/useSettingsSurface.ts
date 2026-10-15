import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import {
  loadNotesEnabled,
  loadSettingsSection,
  saveSettingsSection,
  type SettingsSectionId,
} from "../../../features/settings/model/settings";
import { OPEN_CONNECTIONS_EVENT } from "../../../features/connections/model/connections";
import type { ConnectableInboxSource } from "../../../features/inbox/model/inboxFilters";

export interface SettingsSurfaceState {
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  settingsSection: SettingsSectionId;
  setSettingsSection: Dispatch<SetStateAction<SettingsSectionId>>;
  settingsAnchor: SettingsAnchor | null;
  setSettingsAnchor: Dispatch<SetStateAction<SettingsAnchor | null>>;
  settingsOpenRef: MutableRefObject<boolean>;
}

// State half of the settings surface. Called where `settingsOpen` used to be
// declared, because the render-time foreground/ref mirrors read it early.
export function useSettingsSurfaceState(): SettingsSurfaceState {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(loadSettingsSection);
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | null>(null);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  return {
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    settingsAnchor,
    setSettingsAnchor,
    settingsOpenRef,
  };
}

export interface SettingsSurfaceActionsDeps {
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsSection: Dispatch<SetStateAction<SettingsSectionId>>;
  setSettingsAnchor: Dispatch<SetStateAction<SettingsAnchor | null>>;
  setNotificationProjectPath: Dispatch<SetStateAction<string | null>>;
  setNotificationSettingsRequest: Dispatch<SetStateAction<number>>;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpenRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
}

// Open/return half of the settings surface. Called where the surface openers
// used to start, after the view setters and mirrors it reads are declared.
export function useSettingsSurfaceActions({
  setSettingsOpen,
  setSettingsSection,
  setSettingsAnchor,
  setNotificationProjectPath,
  setNotificationSettingsRequest,
  setFilePickerOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  settingsOpenRef,
  searchViewOpenRef,
  inboxViewOpenRef,
  notesViewOpenRef,
  automationsViewOpenRef,
}: SettingsSurfaceActionsDeps) {
  const settingsReturnViewRef = useRef({
    search: false,
    inbox: false,
    notes: false,
    automations: false,
  });

  const openSettings = useCallback((section?: SettingsSectionId, anchor?: SettingsAnchor) => {
    if (!settingsOpenRef.current) {
      settingsReturnViewRef.current = {
        search: searchViewOpenRef.current,
        inbox: inboxViewOpenRef.current,
        notes: notesViewOpenRef.current,
        automations: automationsViewOpenRef.current,
      };
    }
    startTransition(() => {
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      if (section) {
        setSettingsSection(section);
        saveSettingsSection(section);
      }
      setSettingsAnchor(anchor ?? null);
      setNotificationProjectPath(null);
      setSettingsOpen(true);
    });
  }, []);

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);

  useEffect(() => {
    const openConnections = () => openSettings("connections");
    window.addEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
    return () => window.removeEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
  }, [openSettings]);

  useEffect(() => {
    const onOpenMcp = () => openSettings("mcp");
    window.addEventListener("bycoda:open-mcp-settings", onOpenMcp);
    return () => window.removeEventListener("bycoda:open-mcp-settings", onOpenMcp);
  }, [openSettings]);

  const onOpenNotificationSettings = useCallback(
    (path?: string) => {
      openSettings("notifications", "project-notifications");
      setNotificationProjectPath(path ?? null);
      setNotificationSettingsRequest((request) => request + 1);
    },
    [openSettings],
  );

  const onOpenInboxIntegrations = useCallback(
    (source: ConnectableInboxSource) => openSettings("inbox", source),
    [openSettings],
  );

  const onCloseSettings = useCallback(() => {
    const returnView = settingsReturnViewRef.current;
    setSearchViewOpen(returnView.search);
    setInboxViewOpen(returnView.inbox);
    setNotesViewOpen(returnView.notes && loadNotesEnabled());
    setAutomationsViewOpen(returnView.automations);
    setSettingsOpen(false);
  }, []);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  return {
    settingsReturnViewRef,
    openSettings,
    onOpenSettings,
    onOpenNotificationSettings,
    onOpenInboxIntegrations,
    onCloseSettings,
    onSelectSettingsSection,
  };
}
