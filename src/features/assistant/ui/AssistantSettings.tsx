import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { useCallback, useId, useRef, useState, type MutableRefObject, type ReactNode } from "react";
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
import { TabStrip } from "../../../shared/ui/Tabs";
import { InlineError } from "../../../shared/ui/InlineError";
import {
  RefreshCw,
  Sparkles,
  Shield,
  Lock,
  Save,
  SlidersHorizontal,
  RotateCcw,
} from "../../../shared/ui/icons";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { AssistantProfileFields, type ProfileSection } from "./AssistantProfileFields";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import {
  DesktopControlSettings,
  type DesktopControlDraftState,
} from "../../host-tools/DesktopControlSettings";
import { AdvancedSettings, Group, Row } from "../../settings/public/settingsControls";
import { AssistantBuilderDialog } from "./builder/AssistantBuilderDialog";
import { ProfileRowsProvider } from "./settings/SettingsProfileRow";
import { AssistantRetentionField } from "./settings/AssistantUsageSettings";
import { AssistantScheduleInfo } from "./settings/AssistantScheduleFields";
import { AssistantCostInfo } from "./settings/AssistantCostFields";
import { settingsProfilePatch } from "./settings/settingsPatch";
import { AlwaysOnChecklist } from "./settings/AlwaysOnChecklist";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { AssistantFoldersSettings } from "./settings/folders/AssistantFoldersSettings";
import settingsStyles from "./AssistantSettings.module.css";
import {
  assistantAccessMode,
  assistantAccessPatch,
  type AssistantAccessChoice,
} from "./settings/assistantAccess";
import type { FoldersDraftState } from "./settings/folders/useAssistantFolders";
import { useDefaultWorkerExecution } from "./settings/defaultWorkerExecution";

type OwnerRequest = typeof assistantRequest;
type Project = { id?: string; path: string; name: string };
type SettingsPage = "personal" | "work" | "access" | "advanced";
type SectionSave = MutableRefObject<(() => Promise<void>) | null>;

const pages = [
  ["personal", "Personal"],
  ["work", "Work"],
  ["access", "Access"],
  ["advanced", "Advanced"],
] as const satisfies readonly (readonly [SettingsPage, string])[];

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
  const [draft, setDraft] = useState<AssistantProfilePatch>(() => ({
    ...snapshot.profile,
  }));
  const version = useRef(snapshot.profile.version);
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
  );
  const [leave, setLeave] = useState<"close" | "setup" | null>(null);
  const [retention, setRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [savedRetention, setSavedRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
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
  const currentPage = pages.find(([id]) => id === page)!;
  const profileDirty = JSON.stringify(draft) !== savedDraft || retention !== savedRetention;
  const anyDirty = profileDirty || projectState.dirty || computerState.dirty || foldersState.dirty;
  const busy = pending || projectState.pending || computerState.pending || foldersState.pending;
  const saved = savedNotice && !anyDirty;
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
      if (!busy && access !== "loading") setCustomAccessOpen(true);
      return;
    }
    if (
      (choice !== "ask" && choice !== "full") ||
      busy ||
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
    setError("");
    setSavedNotice(false);
  }
  function requestLeave(target: "close" | "setup") {
    if (busy) return;
    if (anyDirty) setLeave(target);
    else if (target === "close") onClose();
    else onSetup();
  }
  async function saveProfile() {
    const result = await assistantRequest({
      op: "profile.update",
      expectedVersion: version.current,
      patch: settingsProfilePatch(draft),
    });
    if (!result.profile)
      throw new Error(t("The settings save was not confirmed. Check before retrying."));
    version.current = result.profile.version;
    setSavedDraft(JSON.stringify(draft));
    if (retention !== savedRetention) {
      const retained = await assistantRequest({
        op: "conversations.retention",
        days: retention as 0 | 30 | 90 | 365,
      });
      if (retained.ok !== true)
        throw new Error(t("The retention change was not confirmed. Check before retrying."));
      setSavedRetention(retention);
    }
  }
  /** Profile, then project scope, computer use, then folders. The first failure stops the chain. */
  async function save() {
    if (busy) return;
    setPending(true);
    setError("");
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
    } catch (cause) {
      if (savingAccess) {
        setPage("access");
        setCustomAccessOpen(true);
      }
      if (!shownInline) setError(cause instanceof Error ? cause.message : String(cause));
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
      onChange={(patch) => {
        setSavedNotice(false);
        setDraft((current) => ({ ...current, ...patch }));
      }}
    />
  );
  /** One tab. It stays mounted while hidden so every section keeps its draft. */
  const tab = (id: SettingsPage, children: ReactNode) => (
    <div
      key={id}
      className={[settingsStyles.page, id === "access" ? "" : settingsStyles.ownRows]
        .filter(Boolean)
        .join(" ")}
      data-settings-page={id}
      hidden={page !== id}
    >
      {children}
    </div>
  );
  return (
    <Modal
      padding="none"
      title={
        snapshot.profile.name ? t("Settings · {p0}", { p0: snapshot.profile.name }) : t("Set up")
      }
      onClose={() => {
        requestLeave("close");
      }}
      size="lg"
      className={settingsStyles.dialog}
      scroll="none"
      fitViewport
      footer={
        <div className={settingsStyles.footer}>
          {error && <InlineError>{error}</InlineError>}
          <div className={settingsStyles.footerRow}>
            {leave ? (
              <>
                <InlineError>{t("Discard unsaved changes?")}</InlineError>
                <div className={settingsStyles.footerActions}>
                  <Button key="keep-editing" onClick={() => setLeave(null)}>
                    {t("Keep editing")}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      const target = leave;
                      setLeave(null);
                      if (target === "close") onClose();
                      else onSetup();
                    }}
                  >
                    {t("Discard")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  startIcon={<RotateCcw className="icon-sm" />}
                  disabled={busy}
                  onClick={() => requestLeave("setup")}
                >
                  {t("Quick setup")}
                </Button>
                <div className={settingsStyles.footerActions}>
                  <Button
                    key="save-profile"
                    type="submit"
                    form={formId}
                    variant="primary"
                    startIcon={<Save className="icon-sm" />}
                    aria-label={saved ? t("Saved") : t("Save profile settings")}
                    loading={pending}
                    loadingLabel={t("Saving…")}
                    success={saved}
                    successLabel={t("Saved")}
                    disabled={busy || !anyDirty || (profileDirty && !draft.name?.trim())}
                  >
                    {t("Save")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className={settingsStyles.form}
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
        <div
          {...surfaceAttributes({ frame: "neutral", edge: "block-end" }, settingsStyles.navigation)}
        >
          <TabStrip
            className={settingsStyles.tabs}
            label={t("Assistant settings")}
            value={page}
            controls={formId + "-content"}
            onValueChange={(next) => {
              setPage(next);
              if (contentRef.current) contentRef.current.scrollTop = 0;
            }}
            items={pages.map(([value, label]) => ({ value, label: t(label) }))}
          />
        </div>
        <ScrollArea
          gutter="stable"
          id={formId + "-content"}
          ref={contentRef}
          className={settingsStyles.content}
          role="region"
          aria-label={t(currentPage[1])}
        >
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
                      tooltip={t("Answer a few questions and let AI draft your whole profile")}
                      onClick={() => setBuilderOpen(true)}
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
                <Group title={null}>{profile("budget")}</Group>
                <Group title={t("Models")}>
                  <Row
                    label={t("Assistant models")}
                    description={t("Models and limits follow Settings > Models.")}
                  >
                    <Button
                      type="button"
                      size="sm"
                      startIcon={<SlidersHorizontal className="icon-sm" />}
                      onClick={() => openModelsSettings("roles")}
                    >
                      {t("Manage in Models")}
                    </Button>
                  </Row>
                </Group>
                <Group title={t("Presence and hours")} info={<AssistantScheduleInfo />}>
                  {profile("presence")}
                  <div className={settingsStyles.statusLine}>
                    <AssistantPresenceStatus snapshot={snapshot} details />
                    <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
                  </div>
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
                  </AdvancedSettings>
                </Group>
              </>,
            )}
            {tab(
              "access",
              <>
                <Group title={t("Access")}>
                  <Row
                    label={t("Permission")}
                    description={t(
                      access === "full"
                        ? "Jobs, selected-folder changes, commands and computer input run without confirmation. Save applies this access."
                        : "Applies to jobs, selected folders, commands and computer use.",
                    )}
                    stacked
                  >
                    <SegmentedControl
                      label={t("Permission")}
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
                          disabled: busy || access === "loading",
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
                    {/* Contents-only wrapper: gives the permission rows the profile rows' control width. */}
                    <div className={`${settingsStyles.ownRows} ${settingsStyles.rowsScope}`}>
                      <Group title={t("Job permissions")}>
                        {draft.execution ? (
                          profile("permissions")
                        ) : (
                          <Row
                            label={t("Execution permissions")}
                            description={t("Choose a worker model before enabling job execution.")}
                          />
                        )}
                      </Group>
                    </div>
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
                      if (target === "setup") requestLeave("setup");
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
      </form>
      {builderOpen && (
        <AssistantBuilderDialog
          current={draft}
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
