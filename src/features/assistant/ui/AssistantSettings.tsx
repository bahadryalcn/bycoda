import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from "react";
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
import { LiveText } from "../../../shared/ui/LiveText";
import { Check, RefreshCw } from "../../../shared/ui/icons";
import { AssistantProfileFields, type ProfileSection } from "./AssistantProfileFields";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import { DesktopControlSettings } from "../../host-tools/DesktopControlSettings";
import { Group } from "../../settings/public/settingsControls";
import { ProfileRowsProvider } from "./settings/SettingsProfileRow";
import { AssistantRetentionField } from "./settings/AssistantUsageSettings";
import { AssistantScheduleInfo } from "./settings/AssistantScheduleFields";
import { AssistantCostInfo } from "./settings/AssistantCostFields";
import { settingsProfilePatch } from "./settings/settingsPatch";
import settingsStyles from "./AssistantSettings.module.css";

type OwnerRequest = typeof assistantRequest;
type Project = { id?: string; path: string; name: string };
type SettingsPage = "personal" | "work" | "schedule" | "projects" | "computer" | "advanced";
type SectionSave = MutableRefObject<(() => Promise<void>) | null>;

const pages = [
  ["personal", "Personal"],
  ["work", "Work"],
  ["schedule", "Schedule"],
  ["projects", "Projects"],
  ["computer", "Computer use"],
  ["advanced", "Advanced"],
] as const satisfies readonly (readonly [SettingsPage, string])[];

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
  const [computerState, setComputerState] = useState({ dirty: false, pending: false });
  const [leave, setLeave] = useState<"close" | "setup" | null>(null);
  const [retention, setRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [savedRetention, setSavedRetention] = useState(snapshot.conversationRetentionDays ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const formId = useId();
  const [page, setPage] = useState<SettingsPage>("personal");
  const contentRef = useRef<HTMLDivElement>(null);
  /** Each embedded section registers its own save routine; the footer runs them in order. */
  const projectSave: SectionSave = useRef<(() => Promise<void>) | null>(null);
  const computerSave: SectionSave = useRef<(() => Promise<void>) | null>(null);
  /** The computer section status refresh, shown in its title row by this shell. */
  const computerRefresh = useRef<(() => void) | null>(null);
  const currentPage = pages.find(([id]) => id === page)!;
  const profileDirty = JSON.stringify(draft) !== savedDraft || retention !== savedRetention;
  const anyDirty = profileDirty || projectState.dirty || computerState.dirty;
  const busy = pending || projectState.pending || computerState.pending;
  const saved = savedNotice && !anyDirty;
  useEffect(() => {
    if (projectState.dirty || computerState.dirty) setSavedNotice(false);
  }, [projectState.dirty, computerState.dirty]);
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
  /** Profile, then project scope, then computer use. The first failure stops the chain. */
  async function save() {
    if (busy) return;
    setPending(true);
    setError("");
    setSavedNotice(false);
    try {
      if (profileDirty) await saveProfile();
      if (projectState.dirty) await projectSave.current?.();
      if (computerState.dirty) await computerSave.current?.();
      setSavedNotice(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      className={[
        settingsStyles.page,
        id === "projects" || id === "computer" ? "" : settingsStyles.ownRows,
      ]
        .filter(Boolean)
        .join(" ")}
      data-settings-page={id}
      hidden={page !== id}
    >
      {children}
    </div>
  );
  const refreshButton = (
    onClick: () => void,
    options: { loading?: boolean; disabled?: boolean },
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      label={t("Refresh")}
      startIcon={<RefreshCw className="icon-sm" />}
      loading={options.loading}
      disabled={options.disabled}
      onClick={onClick}
    />
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
                  <Button onClick={() => setLeave(null)}>{t("Keep editing")}</Button>
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
                <Button variant="secondary" disabled={busy} onClick={() => requestLeave("setup")}>
                  {t("Run setup again")}
                </Button>
                <div className={settingsStyles.footerActions}>
                  {/* Always mounted so the saved notice is announced on each save. */}
                  <LiveText text={saved ? t("Profile settings saved.") : ""} />
                  {saved && (
                    <span className={settingsStyles.saved}>
                      <Check className="icon-xs" aria-hidden />
                      {t("Saved")}
                    </span>
                  )}
                  <Button
                    type="submit"
                    form={formId}
                    variant="primary"
                    aria-label={t("Save profile settings")}
                    loading={pending}
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
          if (section?.hidden) {
            event.preventDefault();
            setPage(section.dataset.settingsPage as SettingsPage);
            requestAnimationFrame(() => {
              field.focus();
              field.reportValidity();
            });
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          // ast-grep-ignore: ts-void-promise-without-catch -- save() reports its own failures
          void save();
        }}
      >
        <div className={settingsStyles.navigation}>
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
        <div
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
                <Group title={t("Identity")}>{profile("identity")}</Group>
                <Group title={t("Language")}>{profile("language")}</Group>
                <Group title={t("Personality")}>{profile("personality")}</Group>
                <Group title={t("Conversation")}>{profile("behavior")}</Group>
              </>,
            )}
            {tab(
              "work",
              <>
                <Group title={t("Jobs")}>{profile("autonomy")}</Group>
                <Group title={t("Models")}>{profile("models")}</Group>
              </>,
            )}
            {tab(
              "schedule",
              <>
                <Group title={t("Presence and hours")} info={<AssistantScheduleInfo />}>
                  {profile("presence")}
                </Group>
                <div className={settingsStyles.statusLine}>
                  <AssistantPresenceStatus snapshot={snapshot} details />
                  <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
                </div>
                <Group
                  title={t("Notifications")}
                  action={
                    snapshot.capabilities.observationTasks === true ? undefined : (
                      <Badge tone="warning" size="xs">
                        {t("Readiness not confirmed")}
                      </Badge>
                    )
                  }
                >
                  {profile("notifications")}
                </Group>
              </>,
            )}
            {tab(
              "projects",
              <Group
                title={t("Manual session supervision")}
                action={refreshButton(() => void manual.refresh(), {
                  loading: manual.pending === "list",
                  disabled: !!manual.pending || manual.stopping,
                })}
              >
                <ManualSessionSupervision
                  key={environmentId ?? "unknown"}
                  controller={manual}
                  projects={projects}
                  environmentId={environmentId}
                  settings
                  saveRef={projectSave}
                  onDraftStateChange={setProjectState}
                />
              </Group>,
            )}
            {tab(
              "computer",
              <Group
                title={t("Computer use")}
                action={refreshButton(() => computerRefresh.current?.(), {})}
              >
                <DesktopControlSettings
                  saveRef={computerSave}
                  refreshRef={computerRefresh}
                  onDraftStateChange={setComputerState}
                />
              </Group>,
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
        </div>
      </form>
    </Modal>
  );
}
