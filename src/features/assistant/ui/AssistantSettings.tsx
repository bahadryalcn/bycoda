import { presentRemoteError } from "../../connections/public/remoteFailure";
import { validWorkerContextSettings } from "../../../shared/model/assistantContext";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { invoke } from "@tauri-apps/api/core";
import { AssistantStandingConsentFields } from "./settings/AssistantStandingConsentFields";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { t } from "../../../shared/i18n";
import type {
  AssistantProfilePatch,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import type { assistantRequest } from "../model/assistantClient";
import type { ManualSupervisionController } from "../model/assistantManual";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { InlineError } from "../../../shared/ui/InlineError";
import {
  RefreshCw,
  Sparkles,
  Shield,
  Lock,
  SlidersHorizontal,
  RotateCcw,
  Briefcase,
  UserRound,
} from "../../../shared/ui/icons";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { AssistantProfileFields, type ProfileSection } from "./AssistantProfileFields";
import { PresenceStatusRow } from "./settings/PresenceStatusRow";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import {
  DesktopControlSettings,
  type DesktopControlDraftState,
} from "../../host-tools/DesktopControlSettings";
import {
  AdvancedSettings,
  Group,
  Row,
  SettingsSaveBar,
  useLeaveGuard,
} from "../../../shared/ui/settings";
import { assistantChanges } from "./settings/assistantChanges";
import { AssistantBuilderDialog } from "./builder/AssistantBuilderDialog";
import { useLanguageChangeFlow } from "./settings/useLanguageChangeFlow";
import { ProfileRowsProvider } from "./settings/SettingsProfileRow";
import { AssistantRetentionField } from "./settings/AssistantUsageSettings";
import { AssistantScheduleInfo } from "./settings/AssistantScheduleFields";
import { AssistantCostInfo } from "./settings/AssistantCostFields";
import { settingsProfilePatch, validateTelegramNotificationTarget } from "./settings/settingsPatch";
import { AlwaysOnChecklist } from "./settings/AlwaysOnChecklist";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { AssistantFoldersSettings } from "./settings/folders/AssistantFoldersSettings";
import settingsStyles from "./AssistantSettings.module.css";
import {
  assistantAccessMode,
  assistantAccessPatch,
  DEFAULT_CRITICAL_EXCLUSIONS,
  effectiveConsent,
  nativeConsentFromGrant,
  type AssistantAccessChoice,
  type NativeConsent,
  type NativeConsentGrant,
} from "./settings/assistantAccess";
import type { FoldersDraftState } from "./settings/folders/useAssistantFolders";
import { useDefaultWorkerExecution } from "./settings/defaultWorkerExecution";
import { AssistantTelegramNotifications } from "./settings/AssistantTelegramNotifications";

type OwnerRequest = typeof assistantRequest;
type Project = { id?: string; path: string; name: string };
type SettingsPage = "personal" | "work" | "access" | "advanced";
type SectionSave = MutableRefObject<(() => Promise<void>) | null>;

const pages = [
  ["personal", "Personal", UserRound],
  ["work", "Work", Briefcase],
  ["access", "Access", Shield],
  ["advanced", "Advanced", SlidersHorizontal],
] as const;

function permissionLevelLabel(level: NonNullable<AssistantProfilePatch["permissionLevel"]>) {
  if (level === "ask") return t("Ask for each operation");
  if (level === "watch") return t("Watch");
  if (level === "projects") return t("Selected projects");
  return t("Everything");
}

/** What the native app enforces on this device for the selected Host, not the Host mirror. */
function nativeConsentDescription(native: NativeConsent, changed: boolean) {
  if (changed) return t("Save to apply the permission you chose on this device.");
  if (native.state === "loading") return t("Reading the permission saved on this device.");
  if (native.state === "failed")
    return t("The permission saved on this device could not be read. Reopen settings.");
  if (native.state === "missing")
    return t("No standing permission is saved on this device. Every operation asks first.");
  if (native.state === "other-credentials")
    return t(
      "The saved permission belongs to other Host credentials, so every operation asks first. Renew it on Save to use it again.",
    );
  return t(
    "Standing permission on this device: {p0}. It stays with the selected Host until changed.",
    { p0: permissionLevelLabel(native.permissionLevel) },
  );
}

function RefreshButton({
  onClick,
  loading,
  disabled,
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      label={t("Refresh")}
      startIcon={<RefreshCw className="icon-sm" />}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function AssistantSettings({
  request,
  environmentId,
  snapshot,
  manual,
  projects,
  onClose,
  onSetup,
}: {
  request: OwnerRequest;
  environmentId?: string;
  snapshot: AssistantSnapshot;
  manual: ManualSupervisionController;
  projects: readonly Project[];
  onClose: () => void;
  onSetup: () => void;
}) {
  const [assistantRequest] = useState(() => request);
  const [consentEnvironment] = useState(environmentId);
  const [draft, setDraft] = useState<AssistantProfilePatch>(() => ({
    ...snapshot.profile,
  }));
  const version = useRef(snapshot.profile.version);
  const consentRevision = useRef<number | null>(null);
  const consentChanged = useRef(false);
  const [consentDirty, setConsentDirty] = useState(false);
  const [nativeConsent, setNativeConsent] = useState<NativeConsent>({
    state: consentEnvironment ? "loading" : "failed",
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Loads the native consent grant for this mounted environment and discards results after unmount.
  useEffect(() => {
    let current = true;
    consentRevision.current = null;
    if (consentEnvironment) {
      void invoke<NativeConsentGrant | null>("assistant_consent_get", {
        environmentId: consentEnvironment,
      })
        .then((consent) => {
          if (!current) return;
          consentRevision.current = consent?.revision ?? 0;
          setNativeConsent(nativeConsentFromGrant(consent));
        })
        .catch(() => {
          // Saving remains blocked until an authoritative native revision is available.
          if (current) setNativeConsent({ state: "failed" });
        });
    }
    return () => {
      current = false;
    };
  }, [consentEnvironment]);
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(snapshot.profile));
  const [projectState, setProjectState] = useState({ dirty: false, pending: false });
  const [computerState, setComputerState] = useState<DesktopControlDraftState>({
    dirty: false,
    pending: false,
  });
  const [foldersState, setFoldersState] = useState<FoldersDraftState>({
    dirty: false,
    pending: false,
  });
  const computerAccess = useRef<((mode: "ask" | "full") => void) | null>(null);
  const foldersAccess = useRef<((runWithoutAsking: boolean) => void) | null>(null);
  const defaultWorker = useDefaultWorkerExecution();
  const access = assistantAccessMode(
    draft,
    computerState.access,
    foldersState.runWithoutAsking,
    foldersState.allowChangesWithoutAsking,
    effectiveConsent(nativeConsent, draft, consentDirty),
  );
  const { guard, dialog: leaveDialog } = useLeaveGuard();
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [retention, setRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [savedRetention, setSavedRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  /** Typed answer the builder opens with (the language-change rewrite request). */
  const [builderRequest, setBuilderRequest] = useState("");
  const languageFlow = useLanguageChangeFlow({
    draft,
    lastSpoken: snapshot.lastSpokenLanguage,
    applyLanguage: (language) => {
      setSavedNotice(false);
      setDraft((current) => ({ ...current, language }));
    },
    startBuilder: (request) => {
      setBuilderRequest(request);
      setBuilderOpen(true);
    },
  });
  const [customAccessOpen, setCustomAccessOpen] = useState(false);
  const formId = useId();
  const [page, setPage] = useState<SettingsPage>("personal");
  const contentRef = useRef<HTMLDivElement>(null);
  /** Each embedded section registers its own save routine; the footer runs them in order. */
  const projectSave: SectionSave = useRef<(() => Promise<void>) | null>(null);
  const computerSave: SectionSave = useRef<(() => Promise<void>) | null>(null);
  const foldersSave: SectionSave = useRef<(() => Promise<void>) | null>(null);
  /** The computer section status refresh, shown in its title row by this shell. */
  const computerRefresh = useRef<(() => void) | null>(null);
  const profileDirty =
    consentDirty || JSON.stringify(draft) !== savedDraft || retention !== savedRetention;
  const anyDirty = profileDirty || projectState.dirty || computerState.dirty || foldersState.dirty;
  const busy = pending || projectState.pending || computerState.pending || foldersState.pending;
  const saved = savedNotice && !anyDirty;
  const changes = anyDirty
    ? assistantChanges({
        draft,
        saved: JSON.parse(savedDraft) as AssistantProfilePatch,
        retention,
        savedRetention,
        consentDirty,
        sections: {
          projects: projectState.dirty,
          computer: computerState.dirty,
          folders: foldersState.dirty,
        },
        setDraft,
        setRetention,
      })
    : [];
  const changeProjectState = useCallback((state: { dirty: boolean; pending: boolean }) => {
    setProjectState(state);
    if (state.dirty) setSavedNotice(false);
  }, []);
  const changeComputerState = useCallback((state: DesktopControlDraftState) => {
    setComputerState(state);
    if (state.dirty) setSavedNotice(false);
  }, []);
  const changeFoldersState = useCallback((state: FoldersDraftState) => {
    setFoldersState(state);
    if (state.dirty) setSavedNotice(false);
  }, []);
  const showPermissionControls = customAccessOpen || access === "custom";
  function chooseAccess(choice: string) {
    if (choice === "custom") {
      if (!busy) setCustomAccessOpen(true);
      return;
    }
    if (
      (choice !== "ask" && choice !== "full") ||
      busy ||
      access === "loading" ||
      !computerAccess.current ||
      !foldersAccess.current
    )
      return;
    const next = choice as AssistantAccessChoice;
    const execution =
      draft.execution ?? defaultWorker(next === "full" ? "full-access" : "supervised");
    if (!execution) {
      setError(t("Choose a worker model before enabling job execution."));
      return;
    }
    setDraft((current) => ({
      ...current,
      ...assistantAccessPatch({ ...current, execution }, next),
    }));
    setCustomAccessOpen(false);
    computerAccess.current(next);
    foldersAccess.current(next === "full");
    // The preset also replaces the native grant on Save: full grants everything, ask drops it.
    consentChanged.current = true;
    setConsentDirty(true);
    setError("");
    setSavedNotice(false);
  }
  function requestLeave(leave: () => void) {
    if (busy) return;
    guard(leave);
  }
  /** Embedded sections reload their drafts from the Host when the form remounts. */
  function discard() {
    languageFlow.clearReview();
    setDraft(JSON.parse(savedDraft) as AssistantProfilePatch);
    setRetention(savedRetention);
    consentChanged.current = false;
    setConsentDirty(false);
    setError("");
    setSavedNotice(false);
    setFormKey((current) => current + 1);
  }
  async function saveProfile() {
    if (!consentEnvironment || environmentId !== consentEnvironment)
      throw new Error(t("Selected Host is unavailable."));
    await validateTelegramNotificationTarget(
      draft,
      JSON.parse(savedDraft) as AssistantProfilePatch,
      async () =>
        (await assistantRequest({ op: "notifications.targets" }, consentEnvironment))
          .notificationTargets,
    );
    if (environmentId !== consentEnvironment) throw new Error(t("Selected Host is unavailable."));
    let nativeSaved = false;
    if (draft.permissionLevel && consentChanged.current) {
      if (!consentEnvironment) throw new Error(t("Selected Host is unavailable."));
      if (consentRevision.current === null)
        throw new Error(t("Permission is unavailable. Reopen settings before saving permissions."));
      const consent = await invoke<NativeConsentGrant>("assistant_consent_set", {
        environmentId: consentEnvironment,
        expectedRevision: consentRevision.current,
        permissionLevel: draft.permissionLevel,
        projectIds: draft.permissionProjectIds ?? [],
        criticalExclusions: draft.criticalExclusions ?? DEFAULT_CRITICAL_EXCLUSIONS,
      });
      consentRevision.current = consent.revision;
      consentChanged.current = false;
      setConsentDirty(false);
      setNativeConsent(nativeConsentFromGrant(consent));
      nativeSaved = true;
    }
    try {
      const result = await assistantRequest(
        {
          op: "profile.update",
          expectedVersion: version.current,
          patch: settingsProfilePatch(draft),
        },
        consentEnvironment,
      );
      if (!result.profile)
        throw new Error(t("Saving settings could not be confirmed. Check before retrying."));
      version.current = result.profile.version;
      setSavedDraft(JSON.stringify(draft));
    } catch (cause) {
      if (nativeSaved)
        throw new Error(
          t("Permission saved. Host settings could not be confirmed; review before retrying."),
        );
      throw cause;
    }
    if (retention !== savedRetention) {
      const retained = await assistantRequest(
        {
          op: "conversations.retention",
          days: retention as 0 | 30 | 90 | 365,
        },
        consentEnvironment,
      );
      if (retained.ok !== true)
        throw new Error(t("The retention change could not be confirmed. Check before retrying."));
      setSavedRetention(retention);
    }
  }
  /** Profile, then project scope, computer use, then folders. The first failure stops the chain. */
  /** True only after every dirty section was acknowledged; the first failure keeps the draft. */
  async function save(): Promise<boolean> {
    if (busy) return false;
    setError("");
    if (profileDirty && !validWorkerContextSettings(draft)) {
      setPage("advanced");
      return false;
    }
    setPending(true);
    setSavedNotice(false);
    // Folders show their own save error inline; the footer would repeat it.
    let shownInline = false;
    let savingAccess = false;
    try {
      if (profileDirty) await saveProfile();
      savingAccess = true;
      if (projectState.dirty) await projectSave.current?.();
      if (computerState.dirty) await computerSave.current?.();
      shownInline = true;
      if (foldersState.dirty) await foldersSave.current?.();
      setSavedNotice(true);
      return true;
    } catch (cause) {
      if (savingAccess) {
        setPage("access");
        setCustomAccessOpen(true);
      }
      if (!shownInline) setError(presentRemoteError(cause, { explicit: true }));
      return false;
    } finally {
      setPending(false);
    }
  }
  /** A profile section is mounted on every page visit so unsaved drafts survive tab changes. */
  const profile = (section: ProfileSection, key: string = section) => (
    <AssistantProfileFields
      key={key}
      observationTasksAvailable={snapshot.capabilities.observationTasks === true}
      section={section}
      value={draft}
      languageReview={languageFlow.review}
      onChange={(patch) => {
        if (languageFlow.intercept(patch)) return;
        setSavedNotice(false);
        setDraft((current) => ({ ...current, ...patch }));
      }}
    />
  );
  /** One tab. It stays mounted while hidden so every section keeps its draft. */
  const tab = (id: SettingsPage, children: ReactNode) => (
    <TabPanel
      key={id}
      value={id}
      keepMounted
      className={[settingsStyles.page, id === "access" ? "" : settingsStyles.ownRows]
        .filter(Boolean)
        .join(" ")}
      data-settings-page={id}
    >
      {children}
    </TabPanel>
  );
  return (
    <Modal
      padding="none"
      title={
        snapshot.profile.name ? t("Settings for {p0}", { p0: snapshot.profile.name }) : t("Set up")
      }
      onClose={() => {
        requestLeave(onClose);
      }}
      closeDisabled={busy}
      size="lg"
      className={settingsStyles.dialog}
      scroll="none"
      fitViewport
    >
      <form
        key={formKey}
        ref={formRef}
        id={formId}
        {...surfaceAttributes({ variant: "canvas" }, settingsStyles.form)}
        onInvalidCapture={(event) => {
          const field = event.target as HTMLInputElement;
          const section = field.closest<HTMLElement>("[data-settings-page]");
          let revealed = false;
          if (section?.hidden) {
            setPage(section.dataset.settingsPage as SettingsPage);
            revealed = true;
          }
          for (
            let ancestor = field.parentElement;
            ancestor && ancestor !== event.currentTarget;
            ancestor = ancestor.parentElement
          ) {
            if (ancestor.matches('[data-settings-part="advanced"]:not([data-open])')) {
              const toggle = ancestor.querySelector<HTMLButtonElement>(
                ':scope > h3 button[aria-expanded="false"]',
              );
              if (toggle) {
                toggle.click();
                revealed = true;
              }
            } else if (ancestor.matches("details:not([open])")) {
              const toggle = ancestor.querySelector<HTMLElement>(":scope > summary");
              if (toggle) {
                toggle.click();
                revealed = true;
              }
            }
          }
          if (revealed) {
            event.preventDefault();
            requestAnimationFrame(() => {
              field.focus();
              field.reportValidity();
            });
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Tabs
          value={page}
          responsive
          onValueChange={(next) => {
            setPage(next);
            if (contentRef.current) contentRef.current.scrollTop = 0;
          }}
        >
          <div
            {...surfaceAttributes({ frame: "pane", edge: "block-end" }, settingsStyles.navigation)}
          >
            <TabList className={settingsStyles.tabs} label={t("Assistant settings")}>
              {pages.map(([value, label, Icon]) => (
                <Tab key={value} value={value} icon={<Icon className="icon-sm" aria-hidden />}>
                  {t(label)}
                </Tab>
              ))}
            </TabList>
          </div>
          <ScrollArea gutter="stable" ref={contentRef} className={settingsStyles.content}>
            <ProfileRowsProvider value>
              {tab(
                "personal",
                <>
                  <Group
                    title={t("Identity")}
                    action={
                      <Button
                        type="button"
                        size="sm"
                        startIcon={<Sparkles className="icon-sm" />}
                        tooltip={t("Answer a few questions and AI drafts the profile for you")}
                        onClick={() => {
                          setBuilderRequest("");
                          setBuilderOpen(true);
                        }}
                      >
                        {t("Create with AI")}
                      </Button>
                    }
                  >
                    {profile("identity")}
                  </Group>
                  <Group title={t("Conversation")}>
                    {profile("language")}
                    <AdvancedSettings title={t("Personality and conversation")} keepMounted>
                      {profile("personality")}
                      {profile("behavior")}
                    </AdvancedSettings>
                  </Group>
                </>,
              )}
              {tab(
                "work",
                <>
                  <Group
                    title={t("Work limits")}
                    action={
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        startIcon={<SlidersHorizontal className="icon-sm" />}
                        disabled={busy}
                        onClick={() =>
                          requestLeave(() => {
                            onClose();
                            openModelsSettings("roles");
                          })
                        }
                      >
                        {t("Manage models")}
                      </Button>
                    }
                  >
                    {profile("budget")}
                  </Group>
                  <Group title={t("Presence and hours")} info={<AssistantScheduleInfo />}>
                    {profile("presence")}
                    <PresenceStatusRow snapshot={snapshot} draft={draft} />
                  </Group>
                  <Group title={null}>
                    <AdvancedSettings
                      title={
                        <>
                          {t("Notifications")}
                          {snapshot.capabilities.observationTasks === true ? null : (
                            <Badge tone="warning" size="xs">
                              {t("Readiness not confirmed")}
                            </Badge>
                          )}
                        </>
                      }
                      keepMounted
                    >
                      {profile("notifications")}
                      <AssistantTelegramNotifications
                        request={assistantRequest}
                        environmentId={consentEnvironment}
                        value={draft}
                        onChange={(patch) => {
                          setSavedNotice(false);
                          setDraft((current) => ({ ...current, ...patch }));
                        }}
                      />
                    </AdvancedSettings>
                  </Group>
                </>,
              )}
              {tab(
                "access",
                <>
                  <Group title={t("Permissions")}>
                    <AssistantStandingConsentFields
                      value={draft}
                      projects={projects}
                      disabled={busy}
                      onChange={(patch) => {
                        consentChanged.current = true;
                        setConsentDirty(true);
                        setSavedNotice(false);
                        setDraft((current) => ({ ...current, ...patch }));
                      }}
                    />
                    <Row
                      label={t("Computer access")}
                      descriptionVisible
                      description={nativeConsentDescription(nativeConsent, consentDirty)}
                    >
                      {draft.permissionLevel && (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy || nativeConsent.state === "loading"}
                          onClick={() => {
                            consentChanged.current = true;
                            setConsentDirty(true);
                            setSavedNotice(false);
                          }}
                        >
                          {t("Renew on Save")}
                        </Button>
                      )}
                    </Row>
                    <Row
                      label={t("Access presets")}
                      stacked
                      description={t(
                        "Configures existing job, folder and computer permissions. Assistant authority and critical exclusions still apply.",
                      )}
                    >
                      <SegmentedControl
                        label={t("Access presets")}
                        value={access}
                        onValueChange={chooseAccess}
                        options={[
                          {
                            value: "ask",
                            label: t("Work and ask"),
                            icon: <Lock className="icon-sm" />,
                            disabled: busy || access === "loading",
                          },
                          {
                            value: "full",
                            label: t("Full access"),
                            icon: <Shield className="icon-sm" />,
                            disabled: busy || access === "loading",
                          },
                          {
                            value: "custom",
                            label: t("Custom"),
                            icon: <SlidersHorizontal className="icon-sm" />,
                            disabled: busy,
                          },
                        ]}
                      />
                    </Row>
                  </Group>
                  {showPermissionControls && (
                    <Group
                      title={t("Customize access")}
                      action={
                        access !== "custom" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setCustomAccessOpen(false)}
                          >
                            {t("Done")}
                          </Button>
                        ) : undefined
                      }
                    >
                      {profile("jobs")}
                      {draft.execution ? (
                        <AdvancedSettings title={t("Job permissions")} keepMounted>
                          {profile("permissions")}
                        </AdvancedSettings>
                      ) : (
                        <Row
                          label={t("Execution permissions")}
                          descriptionVisible
                          description={t("Choose a worker model before enabling job execution.")}
                        />
                      )}
                    </Group>
                  )}
                  <Group title={t("Folders and commands")}>
                    <AssistantFoldersSettings
                      request={assistantRequest}
                      saveRef={foldersSave}
                      onDraftStateChange={changeFoldersState}
                      showPermissionControls={showPermissionControls}
                      accessRef={foldersAccess}
                    />
                  </Group>
                  <Group
                    title={t("Computer use")}
                    action={<RefreshButton onClick={() => computerRefresh.current?.()} />}
                  >
                    <DesktopControlSettings
                      saveRef={computerSave}
                      refreshRef={computerRefresh}
                      onDraftStateChange={changeComputerState}
                      showPermissionControls={showPermissionControls}
                      accessRef={computerAccess}
                    />
                  </Group>
                  <Group
                    title={t("Manual session supervision")}
                    action={
                      <RefreshButton
                        onClick={() => void manual.refresh()}
                        loading={manual.pending === "list"}
                        disabled={!!manual.pending || manual.stopping}
                      />
                    }
                  >
                    <ManualSessionSupervision
                      key={environmentId ?? "unknown"}
                      controller={manual}
                      projects={projects}
                      environmentId={environmentId}
                      settings
                      saveRef={projectSave}
                      onDraftStateChange={changeProjectState}
                    />
                  </Group>
                  <Group title={t("Ready for 24/7")}>
                    <AlwaysOnChecklist
                      request={assistantRequest}
                      snapshot={snapshot}
                      onOpen={(target) => {
                        if (target === "setup") requestLeave(onSetup);
                        else {
                          setPage(target === "access" ? "access" : "work");
                          if (target === "access") setCustomAccessOpen(true);
                          if (contentRef.current) contentRef.current.scrollTop = 0;
                        }
                      }}
                    />
                  </Group>
                </>,
              )}
              {tab(
                "advanced",
                <>
                  <Group title={t("Cost and context")} info={<AssistantCostInfo />}>
                    {profile("cost")}
                  </Group>
                  <Group title={t("Retention and usage")}>
                    <AssistantRetentionField
                      value={retention}
                      disabled={pending}
                      usage={snapshot.usage}
                      dailyBudget={snapshot.profile.dailyTokenBudget}
                      onChange={(days) => {
                        setSavedNotice(false);
                        setRetention(days);
                      }}
                    />
                  </Group>
                </>,
              )}
            </ProfileRowsProvider>
          </ScrollArea>
        </Tabs>
        <footer className={settingsStyles.footer}>
          <SettingsSaveBar
            id="assistant-settings"
            title={t("Assistant settings")}
            changes={changes}
            pending={busy}
            saved={saved}
            canSave={!(profileDirty && !draft.name?.trim())}
            onDiscard={discard}
            // Save goes through the form so native validation still reveals the invalid field.
            onSave={() => {
              return formRef.current?.reportValidity() ? save() : false;
            }}
            leading={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                startIcon={<RotateCcw className="icon-sm" />}
                disabled={busy}
                onClick={() => requestLeave(onSetup)}
              >
                {t("Quick setup")}
              </Button>
            }
          >
            {error && <InlineError>{error}</InlineError>}
          </SettingsSaveBar>
        </footer>
      </form>
      {leaveDialog}
      {languageFlow.dialog}
      {builderOpen && (
        <AssistantBuilderDialog
          current={draft}
          initialAnswer={builderRequest}
          onClose={() => setBuilderOpen(false)}
          onApply={(patch) => {
            setSavedNotice(false);
            setDraft((current) => ({ ...current, ...patch }));
          }}
        />
      )}
    </Modal>
  );
}
