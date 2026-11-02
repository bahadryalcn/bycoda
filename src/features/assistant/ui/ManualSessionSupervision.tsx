import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import type { ManualProject, ManualSupervisionController } from "../model/assistantManual";
import styles from "./AssistantView.module.css";

export function ManualSessionSupervision({ controller, projects, settings = false, query = "", environmentId, onSettings, onOpenSession }: {
  controller: ManualSupervisionController;
  projects: readonly ManualProject[];
  settings?: boolean;
  query?: string;
  environmentId?: string;
  onSettings?: () => void;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
}) {
  const { data, pending, stopping, error, chief } = controller;
  const visible = projects.filter(project => project.id);
  const projectIds = new Set(visible.map(project => project.id!));
  const [selected, setSelected] = useState<string[]>(() => data?.policy.projectIds.filter(id => projectIds.has(id)) ?? []);
  const dirty = useRef(false);
  const editVersion = useRef<number | null>(null);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const navigation = useRef(0);
  useEffect(() => () => { navigation.current++; }, []);
  useEffect(() => {
    if (data && !dirty.current) setSelected(data.policy.projectIds.filter(id => projectIds.has(id)));
  }, [data?.policy.version, projects]);
  const selectedVisible = selected.filter(id => projectIds.has(id));
  const scopeChanged = dirty.current && editVersion.current !== null && data?.policy.version !== editVersion.current;
  const enabled = data?.policy.enabled === true;
  const grants = (data?.grants ?? []).filter(grant => grant.active && projectIds.has(grant.source.projectId));
  const candidates = (data?.candidates ?? []).filter(candidate => projectIds.has(candidate.projectId));
  const matching = (title: string) => !query.trim() || title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  async function commit(enabled: boolean) {
    if (await controller.save(enabled, selectedVisible, editVersion.current ?? data?.policy.version)) { dirty.current = false; editVersion.current = null; }
  }
  async function open(sessionId: string) {
    if (opening || !onOpenSession) return;
    const generation = ++navigation.current; setOpening(sessionId); setOpenError("");
    try { if (environmentId) await onOpenSession(sessionId, environmentId); else await onOpenSession(sessionId); }
    catch (cause) { if (generation === navigation.current) setOpenError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation === navigation.current) setOpening(""); }
  }
  const off = data && (enabled || !!pending || stopping) && <Button loading={stopping} disabled={stopping} onClick={() => void controller.off()}>{t("Turn off supervision")}</Button>;
  if(!settings&&!enabled&&!grants.length&&!error&&!pending)return <section className={styles.section} aria-label={t("Manual session supervision")}>
    <div className={styles.rowHeading}><h2>{t("Manual session supervision")}</h2><div className={styles.toolbar}><Badge>{t("Off")}</Badge>{onSettings&&<Button onClick={onSettings}>{t("Settings")}</Button>}<Button onClick={()=>void controller.refresh()}>{t("Refresh")}</Button></div></div>
  </section>;
  return <section className={styles.section} aria-label={t("Manual session supervision")}>
    <div className={styles.rowHeading}>
      {!settings&&<h2>{t("Manual session supervision")}</h2>}
      <div className={styles.toolbar}>
        {!settings && <Badge>{t(stopping ? "Turning off…" : enabled ? "Enabled" : "Off")}</Badge>}
        {off}
        <Button loading={pending === "list"} disabled={!!pending || stopping} onClick={() => void controller.refresh()}>{t("Refresh")}</Button>
      </div>
    </div>
    <p className={styles.muted}>{t("Only explicitly enrolled conversations in selected projects can be supervised. Existing task, review and automation owners keep control.")}</p>
    {!chief && <p role="status" className={styles.muted}>{t("Chief autonomy is required for manual session supervision.")}</p>}
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    {!data && <p role="status" className={styles.muted}>{t(pending ? "Loading…" : "Manual supervision state is unavailable. Refresh to retry.")}</p>}
    {settings ? <>
      <label className={styles.rowHeading}>
        <span>{t("Allow manual session supervision")}</span>
        <Switch aria-label={t("Allow manual session supervision")} checked={enabled}
          disabled={stopping || (!enabled && (!!pending || !chief || !data || !selectedVisible.length))}
          onCheckedChange={value => { if (value) void commit(true); else void controller.off(); }}/>
      </label>
      <fieldset className={styles.manualScope} disabled={!!pending || stopping || !chief || !data}>
        <legend>{t("Selected projects")}</legend>
        {visible.map(project => <label key={project.id} className={styles.manualProject}>
          <Checkbox checked={selectedVisible.includes(project.id!)} onChange={event => {
            const checked = event.currentTarget.checked;
            if (!dirty.current) editVersion.current = data?.policy.version ?? null;
            dirty.current = true;
            setSelected(before => checked ? [...new Set([...before, project.id!])] : before.filter(id => id !== project.id));
          }}/><span>{project.name}</span>
        </label>)}
        {!visible.length && <p className={styles.muted}>{t("No visible projects are available.")}</p>}
      </fieldset>
      {scopeChanged && <div className={styles.feedback} role="status"><span>{t("Project scope changed. Your unsaved selection is kept.")}</span>
        <Button onClick={() => { dirty.current = false; editVersion.current = null; setSelected(data?.policy.projectIds.filter(id => projectIds.has(id)) ?? []); }}>{t("Reload saved scope")}</Button></div>}
      <div className={styles.toolbar}><Button loading={pending === "policy"} disabled={!!pending || stopping || !chief || !data} onClick={() => void commit(enabled)}>{t("Save project scope")}</Button></div>
      <p className={styles.muted}>{t("Saving project scope does not enroll conversations. Choose each conversation in Sessions.")}</p>
    </> : <>
      {!enabled && <p role="status" className={styles.muted}>{t("Manual session supervision is off.")}</p>}
      {onSettings && <div><Button onClick={onSettings}>{t("Choose projects in Settings")}</Button></div>}
      {grants.filter(grant => matching(grant.title || candidates.find(candidate => candidate.sessionId === grant.sessionId)?.title || "")).map(grant => {
        const candidate = candidates.find(value => value.sessionId === grant.sessionId);
        const title = grant.title || candidate?.title || t("Enrolled conversation");
        const effective = enabled && chief && data?.policy.projectIds.includes(grant.source.projectId);
        return <div className={styles.row} key={grant.id}>
          <div className={styles.rowText}><strong>{title}</strong><p>{visible.find(project => project.id === grant.source.projectId)?.name}</p>
            <span className={styles.muted}>{t(effective ? "Enrollment saved" : "Supervision paused")}</span>
            {candidate?.enrolledSourceChanged && <p role="status" className={styles.muted}>{t("Execution changed. Enroll again to supervise this source.")}</p>}
            {candidate && !candidate.eligible && <p className={styles.muted}>{t(candidate.reason ?? "This conversation is not eligible for supervision.")}</p>}
          </div>
          {onOpenSession && <Button disabled={!!opening} loading={opening === grant.sessionId} onClick={() => void open(grant.sessionId)}>{t("Open session")}</Button>}
          {candidate?.enrolledSourceChanged && <Button loading={pending === `enroll:${candidate.sessionId}`} disabled={!!pending || stopping || !effective || !candidate.eligible} onClick={() => void controller.enroll(candidate)}>{t("Enroll again")}</Button>}
          <Button loading={pending === `revoke:${grant.id}`} disabled={!!pending || stopping} onClick={() => void controller.revoke(grant)}>{t("Revoke supervision")}</Button>
        </div>;
      })}
      {candidates.filter(candidate => !grants.some(grant => grant.sessionId === candidate.sessionId) && matching(candidate.title)).map(candidate => {
        const inScope = data?.policy.projectIds.includes(candidate.projectId);
        return <div className={styles.row} key={candidate.sessionId}>
          <div className={styles.rowText}><strong>{candidate.title || t("Untitled session")}</strong><p>{visible.find(project => project.id === candidate.projectId)?.name}</p>
            {!candidate.eligible && <p className={styles.muted}>{t(candidate.reason ?? "This conversation is not eligible for supervision.")}</p>}
            {candidate.eligible && !inScope && <p className={styles.muted}>{t("Select this project in Settings before enrolling.")}</p>}
          </div>
          <Button loading={pending === `enroll:${candidate.sessionId}`} disabled={!!pending || stopping || !enabled || !chief || !inScope || !candidate.eligible}
            onClick={() => void controller.enroll(candidate)}>{t("Enroll conversation")}</Button>
        </div>;
      })}
      {data && !grants.length && !candidates.length && <p className={styles.empty}>{t("No visible conversations are available for enrollment.")}</p>}
      {openError && <p role="alert" className={styles.error}>{t(openError)}</p>}
    </>}
  </section>;
}
