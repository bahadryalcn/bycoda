import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import { RefreshCw } from "../../../shared/ui/icons";
import { Row } from "../../settings/public/settingsControls";
import type { ManualProject, ManualSupervisionController } from "../model/assistantManual";
import styles from "./AssistantView.module.css";
import panelStyles from "./ManualSessionSupervision.module.css";
import sessionStyles from "./AssistantSessions.module.css";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";

/** Refresh as a quiet icon action; its tooltip is the only label, so it adds no visible text. */
function RefreshIcon({
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
      iconOnly
      variant="ghost"
      label={t("Refresh")}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
    >
      <RefreshCw className="icon-sm" aria-hidden="true" />
    </Button>
  );
}

export function ManualSessionSupervision({
  controller,
  projects,
  settings = false,
  query = "",
  environmentId,
  onSettings,
  onOpenSession,
  onDraftStateChange,
  saveRef,
}: {
  controller: ManualSupervisionController;
  projects: readonly ManualProject[];
  settings?: boolean;
  query?: string;
  environmentId?: string;
  onSettings?: () => void;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onDraftStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
  /** Settings shell's single Save: receives the save routine, which throws on failure. */
  saveRef?: { current: (() => Promise<void>) | null };
}) {
  const { data, pending, stopping, error, chief } = controller;
  const visible = projects.filter((project) => project.id);
  const projectIds = new Set(visible.map((project) => project.id!));
  const [selected, setSelected] = useState<string[]>(
    () => data?.policy.projectIds.filter((id) => projectIds.has(id)) ?? [],
  );
  const dirty = useRef(false);
  const editVersion = useRef<number | null>(null);
  // With saveRef the supervision switch is a draft too, so the shell's one Save applies it.
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const draftMode = settings && !!saveRef;
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const navigation = useRef(0);
  useEffect(
    () => () => {
      navigation.current++;
    },
    [],
  );
  useEffect(() => {
    if (data && !dirty.current)
      setSelected(data.policy.projectIds.filter((id) => projectIds.has(id)));
  }, [data?.policy.version, projects]);
  useEffect(() => {
    onDraftStateChange?.({
      dirty: dirty.current,
      pending: !!pending || stopping,
    });
  }, [onDraftStateChange, selected, draftEnabled, pending, stopping, data?.policy.version]);
  const selectedVisible = selected.filter((id) => projectIds.has(id));
  const scopeChanged =
    dirty.current && editVersion.current !== null && data?.policy.version !== editVersion.current;
  const enabled = data?.policy.enabled === true;
  const shownEnabled = draftEnabled ?? enabled;
  const grants = (data?.grants ?? []).filter(
    (grant) => grant.active && projectIds.has(grant.source.projectId),
  );
  const candidates = (data?.candidates ?? []).filter((candidate) =>
    projectIds.has(candidate.projectId),
  );
  const matching = (title: string) =>
    !query.trim() || title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const status = stopping
    ? "Turning off…"
    : error
      ? "Unknown"
      : pending === "list" || (!data && pending)
        ? "Loading…"
        : !data
          ? "Unknown"
          : enabled
            ? "Enabled"
            : "Off";
  function markDirty() {
    if (!dirty.current) editVersion.current = data?.policy.version ?? null;
    dirty.current = true;
  }
  async function commit(next: boolean) {
    if (await controller.save(next, selectedVisible, editVersion.current ?? data?.policy.version)) {
      dirty.current = false;
      editVersion.current = null;
      setDraftEnabled(null);
      return true;
    }
    return false;
  }
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      if (!dirty.current) return;
      if (!(await commit(shownEnabled)))
        throw new Error(
          t("Manual supervision was not saved. Check the message above and try again."),
        );
    };
  });
  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null;
    },
    [saveRef],
  );
  async function open(sessionId: string) {
    if (opening || !onOpenSession) return;
    const generation = ++navigation.current;
    setOpening(sessionId);
    setOpenError("");
    try {
      if (environmentId) await onOpenSession(sessionId, environmentId);
      else await onOpenSession(sessionId);
    } catch (cause) {
      if (generation === navigation.current)
        setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === navigation.current) setOpening("");
    }
  }
  // The controller's request runner reports its own failures in `error`.
  const reload = () => void controller.refresh();
  const off = data && (enabled || !!pending || stopping) && (
    <Button loading={stopping} disabled={stopping} onClick={() => void controller.off()}>
      {t("Turn off supervision")}
    </Button>
  );
  const idle = !settings && data && !enabled && !grants.length && !error && !pending && !stopping;
  if (idle)
    return (
      <section className={sessionStyles.frame} aria-label={t("Manual session supervision")}>
        <div className={sessionStyles.statusRow}>
          <div className={sessionStyles.statusText}>
            <div className={sessionStyles.titleGroup}>
              <h2>{t("Manual session supervision")}</h2>
              <Badge size="sm">{t("Off")}</Badge>
            </div>
            <p className={sessionStyles.description}>
              {t("Only enrolled conversations in selected projects are supervised.")}
            </p>
          </div>
          <div className={sessionStyles.actions}>
            {onSettings && <Button onClick={onSettings}>{t("Settings")}</Button>}
            <RefreshIcon onClick={reload} />
          </div>
        </div>
      </section>
    );
  const refresh = settings ? (
    <Button loading={pending === "list"} disabled={!!pending || stopping} onClick={reload}>
      {t("Refresh")}
    </Button>
  ) : (
    <RefreshIcon loading={pending === "list"} disabled={!!pending || stopping} onClick={reload} />
  );
  const chiefNotice = !chief
    ? settings
      ? t("Requires Autonomy “Supervise assigned jobs” in Work.")
      : t("Chief autonomy is required for manual session supervision.")
    : "";
  // Settings rows are direct children of the dialog's group so the shared row layout applies.
  if (settings)
    return (
      <>
        <Row
          label={t("Supervise my conversations")}
          description={t("Only conversations you enroll in selected projects are supervised.")}
        >
          {off}
          {!draftMode && refresh}
          <Switch
            aria-label={t("Supervise my conversations")}
            checked={shownEnabled}
            disabled={stopping || (!shownEnabled && (!!pending || !chief || !data))}
            onCheckedChange={(value) => {
              if (draftMode) {
                markDirty();
                setDraftEnabled(value);
              } else if (value) void commit(true);
              else void controller.off();
            }}
          />
        </Row>
        <div className={panelStyles.notices}>
          <LiveText className={styles.muted} text={chiefNotice} />
          {error && <InlineError className={styles.error}>{t(error)}</InlineError>}
          <LiveText
            className={styles.muted}
            text={
              !data
                ? t(
                    pending
                      ? "Loading…"
                      : "Manual supervision state is unavailable. Refresh to retry.",
                  )
                : ""
            }
          />
          <LiveText
            className={styles.muted}
            text={scopeChanged ? t("Project scope changed. Your unsaved selection is kept.") : ""}
          />
          <LiveText
            className={styles.muted}
            text={
              !visible.length
                ? t("No visible projects are available. Add or unlock a project to select it.")
                : ""
            }
          />
        </div>
        <Row
          label={t("Selected projects")}
          stacked
          feedback={
            scopeChanged ? (
              <Button
                onClick={() => {
                  dirty.current = false;
                  editVersion.current = null;
                  setDraftEnabled(null);
                  setSelected(data?.policy.projectIds.filter((id) => projectIds.has(id)) ?? []);
                }}
              >
                {t("Reload saved scope")}
              </Button>
            ) : undefined
          }
        >
          <div className={panelStyles.picker}>
            <SearchableSelect
              hideLabel
              multiple
              label={t("Selected projects")}
              searchPlaceholder={t("Search projects…")}
              noOptionsLabel={t("No visible projects are available.")}
              value={selectedVisible}
              options={visible.map((project) => ({
                value: project.id!,
                label: project.name,
                description: project.path,
                keywords: project.id,
              }))}
              showSelectedValues={false}
              disabled={!!pending || stopping || !chief || !data || !shownEnabled}
              onChange={(projectIds) => {
                markDirty();
                setSelected(projectIds);
              }}
              footer={({ close }) => (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={selectedVisible.length === visible.length}
                  onClick={() => {
                    markDirty();
                    setSelected(visible.map((project) => project.id!));
                    close();
                  }}
                >
                  {t("Select all projects")}
                </Button>
              )}
            />
          </div>
        </Row>
        {!saveRef && (
          <div className={panelStyles.footerAction}>
            <p className={styles.muted}>
              {t(
                "Saving project scope does not enroll conversations. Choose each conversation in Sessions.",
              )}
            </p>
            <Button
              loading={pending === "policy"}
              disabled={!!pending || stopping || !chief || !data}
              onClick={() => void commit(enabled)}
            >
              {t("Save project scope")}
            </Button>
          </div>
        )}
      </>
    );
  return (
    <section className={sessionStyles.frame} aria-label={t("Manual session supervision")}>
      <div className={sessionStyles.statusRow}>
        <div className={sessionStyles.statusText}>
          <div className={sessionStyles.titleGroup}>
            <h2>{t("Manual session supervision")}</h2>
            <Badge size="sm" tone={status === "Enabled" ? "success" : "neutral"}>
              {t(status)}
            </Badge>
          </div>
          <p className={sessionStyles.description}>
            {t("Only enrolled conversations in selected projects are supervised.")}
          </p>
        </div>
        <div className={sessionStyles.actions}>
          {onSettings && <Button onClick={onSettings}>{t("Choose projects in Settings")}</Button>}
          {off}
          {refresh}
        </div>
      </div>
      <LiveText className={styles.muted} text={chiefNotice} />
      {error && <InlineError className={styles.error}>{t(error)}</InlineError>}
      <LiveText
        className={styles.muted}
        text={
          !data
            ? t(pending ? "Loading…" : "Manual supervision state is unavailable. Refresh to retry.")
            : ""
        }
      />
      <LiveText
        className={styles.muted}
        text={data && !enabled ? t("Manual session supervision is off.") : ""}
      />
      {grants
        .filter((grant) =>
          matching(
            grant.title ||
              candidates.find((candidate) => candidate.sessionId === grant.sessionId)?.title ||
              "",
          ),
        )
        .map((grant) => {
          const candidate = candidates.find((value) => value.sessionId === grant.sessionId);
          const title = grant.title || candidate?.title || t("Enrolled conversation");
          const effective =
            enabled && chief && data?.policy.projectIds.includes(grant.source.projectId);
          return (
            <div className={panelStyles.row} key={grant.id}>
              <div className={panelStyles.rowText}>
                <strong>{title}</strong>
                <p>{visible.find((project) => project.id === grant.source.projectId)?.name}</p>
                <span className={styles.muted}>
                  {t(effective ? "Enrollment saved" : "Supervision paused")}
                </span>
                <LiveText
                  className={styles.muted}
                  text={
                    candidate?.enrolledSourceChanged
                      ? t("Execution changed. Enroll again to supervise this source.")
                      : ""
                  }
                />
                {candidate && !candidate.eligible && (
                  <p className={styles.muted}>
                    {t(candidate.reason ?? "This conversation is not eligible for supervision.")}
                  </p>
                )}
              </div>
              {onOpenSession && (
                <Button
                  disabled={!!opening}
                  loading={opening === grant.sessionId}
                  onClick={() => void open(grant.sessionId)}
                >
                  {t("Open session")}
                </Button>
              )}
              {candidate?.enrolledSourceChanged && (
                <Button
                  loading={pending === `enroll:${candidate.sessionId}`}
                  disabled={!!pending || stopping || !effective || !candidate.eligible}
                  onClick={() => void controller.enroll(candidate)}
                >
                  {t("Enroll again")}
                </Button>
              )}
              <Button
                loading={pending === `revoke:${grant.id}`}
                disabled={!!pending || stopping}
                onClick={() => void controller.revoke(grant)}
              >
                {t("Revoke supervision")}
              </Button>
            </div>
          );
        })}
      {candidates
        .filter(
          (candidate) =>
            !grants.some((grant) => grant.sessionId === candidate.sessionId) &&
            matching(candidate.title),
        )
        .map((candidate) => {
          const inScope = data?.policy.projectIds.includes(candidate.projectId);
          return (
            <div className={panelStyles.row} key={candidate.sessionId}>
              <div className={panelStyles.rowText}>
                <strong>{candidate.title || t("Untitled session")}</strong>
                <p>{visible.find((project) => project.id === candidate.projectId)?.name}</p>
                {!candidate.eligible && (
                  <p className={styles.muted}>
                    {t(candidate.reason ?? "This conversation is not eligible for supervision.")}
                  </p>
                )}
                {candidate.eligible && !inScope && (
                  <p className={styles.muted}>
                    {t("Select this project in Settings before enrolling.")}
                  </p>
                )}
              </div>
              <Button
                loading={pending === `enroll:${candidate.sessionId}`}
                disabled={
                  !!pending || stopping || !enabled || !chief || !inScope || !candidate.eligible
                }
                onClick={() => void controller.enroll(candidate)}
              >
                {t("Enroll conversation")}
              </Button>
            </div>
          );
        })}
      {data && !grants.length && !candidates.length && (
        <p className={styles.empty}>
          {t("No visible conversations are available for enrollment.")}
        </p>
      )}
      {openError && <InlineError className={styles.error}>{t(openError)}</InlineError>}
    </section>
  );
}
