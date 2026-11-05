import { useId, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import type {
  AssistantProfilePatch,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import type { assistantRequest } from "../model/assistantClient";
import type { ManualSupervisionController } from "../model/assistantManual";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TabStrip } from "../../../shared/ui/Tabs";
import { InlineError } from "../../../shared/ui/InlineError";
import { AssistantProfileFields, type ProfileSection } from "./AssistantProfileFields";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import { DesktopControlSettings } from "../../host-tools/DesktopControlSettings";
import styles from "./AssistantView.module.css";
import settingsStyles from "./AssistantSettings.module.css";

type OwnerRequest = typeof assistantRequest;
type Project = { id?: string; path: string; name: string };
type SettingsPage = "personal" | "work" | "schedule" | "projects" | "computer" | "advanced";
const profilePages: Record<ProfileSection, SettingsPage> = {
  identity: "personal",
  language: "personal",
  behavior: "personal",
  autonomy: "work",
  presence: "schedule",
  cost: "advanced",
};

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
  const pages = [
    ["personal", "Personal", "Name, language and conversation preferences."],
    ["work", "Work", "Choose what your assistant can do and when it needs approval."],
    ["schedule", "Schedule", "Set working hours, quiet hours and notifications."],
    ["projects", "Projects", "Choose which projects can join manual supervision."],
    ["computer", "Computer use", "Choose allowed applications and review computer permissions."],
    ["advanced", "Advanced", "Review scheduling limits, conversation history and measured usage."],
  ] as const;
  const currentPage = pages.find(([id]) => id === page)!;
  const profileDirty = JSON.stringify(draft) !== savedDraft || retention !== savedRetention;
  const busy = pending || projectState.pending || computerState.pending;
  function requestLeave(target: "close" | "setup") {
    if (busy) return;
    if (profileDirty || projectState.dirty || computerState.dirty) setLeave(target);
    else if (target === "close") onClose();
    else onSetup();
  }
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    setSavedNotice(false);
    const {
      execution,
      chiefExecution,
      replyExecution,
      planningExecution,
      allowRoutineQuestions,
      name,
      showTitle,
      avatar,
      addressAs,
      language,
      autonomy,
      planApproval,
      dailyTokenBudget,
      perWakeTokenCap,
      proactiveSpeech,
      keepAwakeWhileWorking,
      quietStart,
      quietEnd,
      chiefSoftContext,
      chiefHardContext,
      workerSoftContext,
      workerHardContext,
      workerCompactPercent,
      workerHandoffPercent,
      stallMinutes,
      idleMinutes,
      awayMinutes,
      chiefWakeLimit,
      nudgeLimit,
      activeStart,
      activeEnd,
      notificationPresent,
      notificationAway,
      notificationDnd,
      summaryRefreshMessages,
      observationTaskDone,
      observationTaskNeedsInput,
    } = draft;
    try {
      const saved = await assistantRequest({
        op: "profile.update",
        expectedVersion: version.current,
        patch: {
          execution,
          chiefExecution,
          replyExecution,
          planningExecution,
          allowRoutineQuestions,
          name,
          showTitle,
          avatar,
          addressAs,
          language,
          autonomy,
          planApproval,
          dailyTokenBudget,
          perWakeTokenCap,
          proactiveSpeech,
          keepAwakeWhileWorking,
          quietStart,
          quietEnd,
          chiefSoftContext,
          chiefHardContext,
          workerSoftContext,
          workerHardContext,
          workerCompactPercent,
          workerHandoffPercent,
          stallMinutes,
          idleMinutes,
          awayMinutes,
          chiefWakeLimit,
          nudgeLimit,
          activeStart,
          activeEnd,
          notificationPresent,
          notificationAway,
          notificationDnd,
          summaryRefreshMessages,
          observationTaskDone,
          observationTaskNeedsInput,
        },
      });
      if (!saved.profile)
        throw new Error(t("The settings save was not confirmed. Check before retrying."));
      version.current = saved.profile.version;
      setSavedDraft(JSON.stringify(draft));
      if (retention !== savedRetention) {
        const result = await assistantRequest({
          op: "conversations.retention",
          days: retention as 0 | 30 | 90 | 365,
        });
        if (result.ok !== true)
          throw new Error(t("The retention change was not confirmed. Check before retrying."));
        setSavedRetention(retention);
      }
      setSavedNotice(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
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
      footerStart={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => requestLeave("setup")}>
            {t("Run setup again")}
          </Button>
          {error && <InlineError>{error}</InlineError>}
          {savedNotice && !profileDirty && (
            <span role="status">{t("Profile settings saved.")}</span>
          )}
          {leave && (
            <div role="alert">
              <span>{t("Discard unsaved changes in assistant settings?")}</span>{" "}
              <Button onClick={() => setLeave(null)}>{t("Keep editing")}</Button>{" "}
              <Button
                disabled={busy}
                onClick={() => {
                  const target = leave;
                  setLeave(null);
                  if (target === "close") onClose();
                  else onSetup();
                }}
              >
                {t("Discard changes")}
              </Button>
            </div>
          )}
        </>
      }
      footer={
        <ModalActions>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!draft.name?.trim()}
          >
            {t("Save profile settings")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={settingsStyles.form}
        onInvalidCapture={(event) => {
          const field = event.target as HTMLInputElement;
          const group = field.closest<HTMLDetailsElement>("details[data-settings-page]");
          if (group) {
            group.open = true;
            if (group.hidden) {
              event.preventDefault();
              setPage(group.dataset.settingsPage as SettingsPage);
              requestAnimationFrame(() => {
                field.focus();
                field.reportValidity();
              });
            }
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
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
          <header className={settingsStyles.introduction}>
            <h2>{t(currentPage[1])}</h2>
            <p>{t(currentPage[2])}</p>
            {(page === "projects" || page === "computer") && (
              <p className={settingsStyles.saveHint}>
                {t("Changes in this section are saved separately using its own controls.")}
              </p>
            )}
          </header>
          {(
            [
              ["identity", "Identity"],
              ["language", "Language"],
              ["behavior", "Conversation behavior"],
              ["autonomy", "Autonomy"],
              ["presence", "Presence and hours"],
              ["cost", "Cost and context"],
            ] as const
          ).map(([section, label]) => (
            <details
              className={styles.settingsGroup}
              key={section}
              data-settings-page={profilePages[section]}
              open
              hidden={page !== profilePages[section]}
            >
              <summary>{t(label)}</summary>
              <div className={styles.stack}>
                <div className={settingsStyles.profileFields}>
                  <AssistantProfileFields
                    observationTasksAvailable={snapshot.capabilities.observationTasks === true}
                    section={section}
                    value={draft}
                    onChange={(patch) => {
                      setSavedNotice(false);
                      setDraft((current) => ({ ...current, ...patch }));
                    }}
                  />
                </div>
                {section === "presence" && (
                  <>
                    <AssistantPresenceStatus snapshot={snapshot} details />
                    <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
                  </>
                )}
              </div>
            </details>
          ))}
          <details className={styles.settingsGroup} open hidden={page !== "projects"}>
            <summary>{t("Manual session supervision")}</summary>
            <div className={styles.stack}>
              <ManualSessionSupervision
                key={environmentId ?? "unknown"}
                controller={manual}
                projects={projects}
                environmentId={environmentId}
                settings
                onDraftStateChange={setProjectState}
              />
            </div>
          </details>
          <section
            className={settingsStyles.computerPanel}
            hidden={page !== "computer"}
            aria-label={t("Computer use")}
          >
            <DesktopControlSettings onDraftStateChange={setComputerState} />
          </section>
          <details className={styles.settingsGroup} open hidden={page !== "advanced"}>
            <summary>{t("Conversation retention")}</summary>
            <div className={styles.stack}>
              <Select
                label={t("Keep conversation messages")}
                value={String(retention)}
                disabled={pending}
                options={[
                  [0, t("Forever")],
                  [30, t("30 days")],
                  [90, t("90 days")],
                  [365, t("365 days")],
                ].map(([value, label]) => ({ value: String(value), label: String(label) }))}
                onValueChange={(value) => {
                  setSavedNotice(false);
                  setRetention(Number(value));
                }}
              />
              <p className={styles.muted}>
                {t(
                  "Older messages move to Recently deleted for seven days. Summaries and unsent drafts are kept. Choosing Forever does not restore deleted messages.",
                )}
              </p>
            </div>
          </details>
          <details className={styles.settingsGroup} open hidden={page !== "advanced"}>
            <summary>{t("Today's usage")}</summary>
            <div className={styles.stack}>
              <p>
                {t("Chief tokens")}: {snapshot.usage.chiefTokens.toLocaleString()}
              </p>
              <p>
                {t("Worker tokens")}: {snapshot.usage.workerTokens.toLocaleString()}
              </p>
              {snapshot.usage.workerUsageIncomplete && (
                <p role="status" className={styles.muted}>
                  {t("Usage unavailable. No zero usage is assumed.")}
                </p>
              )}
              <div role="group" aria-label={t("Worker cache usage")}>
                <h3>{t("Worker cache usage")}</h3>
                {snapshot.usage.cacheUsage ? (
                  <div className={styles.stack}>
                    <p>
                      {t("{p0} of {p1} worker turns measured", {
                        p0: snapshot.usage.cacheUsage.measuredTurns,
                        p1: snapshot.usage.cacheUsage.totalTurns,
                      })}
                    </p>
                    <p className={styles.muted}>
                      {t(
                        snapshot.usage.cacheUsage.complete
                          ? "All observed worker turns have cache measurements."
                          : "Partial measurements. Missing cache usage is unavailable, not zero.",
                      )}
                    </p>
                    <p>
                      {t("Cache read tokens")}:{" "}
                      {snapshot.usage.cacheUsage.cacheReadTokens === undefined
                        ? t("Unavailable")
                        : snapshot.usage.cacheUsage.cacheReadTokens.toLocaleString()}
                    </p>
                    <p>
                      {t("Cache write tokens")}:{" "}
                      {snapshot.usage.cacheUsage.cacheWriteTokens === undefined
                        ? t("Unavailable")
                        : snapshot.usage.cacheUsage.cacheWriteTokens.toLocaleString()}
                    </p>
                    <p>
                      {t("Mean reported cache hit")}:{" "}
                      {snapshot.usage.cacheUsage.cacheHitPercent === undefined
                        ? t("Unavailable")
                        : `${snapshot.usage.cacheUsage.cacheHitPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                    </p>
                    {snapshot.usage.cacheUsage.cacheHitPercent !== undefined && (
                      <p className={styles.muted}>
                        {t(
                          "Average of {p0} provider-reported worker percentages. This is not a billing discount.",
                          { p0: snapshot.usage.cacheUsage.percentageTurns },
                        )}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className={styles.muted}>{t("Cache usage unavailable")}</p>
                )}
              </div>
            </div>
          </details>
        </div>
      </form>
    </Modal>
  );
}
