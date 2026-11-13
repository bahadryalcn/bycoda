import {
  OPEN_MODELS_SETTINGS_EVENT,
  MODELS_TABS,
  modelsTabAnchor,
  type ModelsTab,
} from "../../../features/settings/ui/models/modelsSettingsLink";
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
  loadSettingsAliasAnchor,
  saveSettingsSection,
  settingsSectionForAnchor,
  type SettingsSectionId,
} from "../../../features/settings/model/settings";
import { toolSettingsAnchorForSection } from "../../../features/settings/model/toolSettingsSections";
import { OPEN_CONNECTIONS_EVENT } from "../../../features/connections/model/connections";
import { OPEN_DECISION_MODELS_SETTINGS_EVENT } from "../../../features/decision-models/model/decisionModelsSettings";
import { OPEN_PROVIDER_SETTINGS_EVENT } from "../../../features/providers/public/providerSettingsLink";
import type { ConnectableInboxSource } from "../../../features/inbox/model/inboxFilters";
import { OPEN_MESSAGING_SETTINGS_EVENT } from "../../../features/messaging/model/messagingSettings";

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
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | null>(
    loadSettingsAliasAnchor,
  );
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
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
  settingsOpenRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
  serversViewOpenRef?: MutableRefObject<boolean>;
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
  setServersViewOpen,
  settingsOpenRef,
  searchViewOpenRef,
  inboxViewOpenRef,
  notesViewOpenRef,
  automationsViewOpenRef,
  serversViewOpenRef,
}: SettingsSurfaceActionsDeps) {
  const settingsReturnViewRef = useRef({
    search: false,
    inbox: false,
    notes: false,
    automations: false,
    servers: false,
  });

  const openSettings = useCallback((section?: SettingsSectionId, anchor?: SettingsAnchor) => {
    if (!settingsOpenRef.current) {
      settingsReturnViewRef.current = {
        search: searchViewOpenRef.current,
        inbox: inboxViewOpenRef.current,
        notes: notesViewOpenRef.current,
        automations: automationsViewOpenRef.current,
        servers: Boolean(serversViewOpenRef?.current),
      };
    }
    startTransition(() => {
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      const targetAnchor = anchor ?? toolSettingsAnchorForSection(section);
      const targetSection = settingsSectionForAnchor(section, targetAnchor);
      if (targetSection) {
        setSettingsSection(targetSection);
        saveSettingsSection(targetSection);
      }
      setSettingsAnchor(targetAnchor);
      // The existing external reveal counter also replays explicit tool links to the same row.
      if (targetSection === "tools" && targetAnchor)
        setNotificationSettingsRequest((request) => request + 1);
      setNotificationProjectPath(null);
      setSettingsOpen(true);
    });
  }, []);

  // Feature screens deep-link through this surface so return-view state is preserved.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the Models deep-link window listener attached to the settings surface
  useEffect(() => {
    const openModels = (event: Event) => {
      const tab = (event as CustomEvent<ModelsTab>).detail;
      if (MODELS_TABS.includes(tab))
        openSettings(tab === "chat" ? "models" : "work", modelsTabAnchor(tab));
    };
    window.addEventListener(OPEN_MODELS_SETTINGS_EVENT, openModels);
    return () => window.removeEventListener(OPEN_MODELS_SETTINGS_EVENT, openModels);
  }, [openSettings]);

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);

  useEffect(() => {
    const openConnections = () => openSettings("connections");
    window.addEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
    return () => window.removeEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
  }, [openSettings]);

  useEffect(() => {
    const openProviders = () => openSettings("providers");
    window.addEventListener(OPEN_DECISION_MODELS_SETTINGS_EVENT, openProviders);
    window.addEventListener(OPEN_PROVIDER_SETTINGS_EVENT, openProviders);
    return () => {
      window.removeEventListener(OPEN_DECISION_MODELS_SETTINGS_EVENT, openProviders);
      window.removeEventListener(OPEN_PROVIDER_SETTINGS_EVENT, openProviders);
    };
  }, [openSettings]);

  useEffect(() => {
    const onOpenMcp = () => openSettings("mcp");
    window.addEventListener("bycoda:open-mcp-settings", onOpenMcp);
    return () => window.removeEventListener("bycoda:open-mcp-settings", onOpenMcp);
  }, [openSettings]);

  useEffect(() => {
    const onOpenMessaging = () => openSettings("integrations", "email");
    window.addEventListener(OPEN_MESSAGING_SETTINGS_EVENT, onOpenMessaging);
    return () => window.removeEventListener(OPEN_MESSAGING_SETTINGS_EVENT, onOpenMessaging);
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
    (source: ConnectableInboxSource) => openSettings("integrations", source),
    [openSettings],
  );

  const onCloseSettings = useCallback(() => {
    const returnView = settingsReturnViewRef.current;
    setSearchViewOpen(returnView.search);
    setInboxViewOpen(returnView.inbox);
    setNotesViewOpen(returnView.notes && loadNotesEnabled());
    setAutomationsViewOpen(returnView.automations);
    setServersViewOpen?.(returnView.servers);
    setSettingsOpen(false);
  }, [
    setInboxViewOpen,
    setNotesViewOpen,
    setServersViewOpen,
    setSettingsOpen,
    setAutomationsViewOpen,
    setSearchViewOpen,
  ]);

  const onSelectSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      setSettingsSection(section);
      saveSettingsSection(section);
    },
    [setSettingsSection],
  );

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
