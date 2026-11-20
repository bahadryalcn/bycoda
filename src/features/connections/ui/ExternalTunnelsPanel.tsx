import { useEffect, useId, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import { Plus } from "../../../shared/ui/icons";
import { isLocalSyncMachine } from "../model/localSync";
import type { RemoteMachine } from "../model/protocol";
import { TunnelRows } from "./TunnelRows";
import { TunnelStartForm, useTunnelDraft, useTunnelStart } from "./TunnelStartForm";
import { issueCopy } from "./tunnelCopy";
import { useTunnelSession } from "./useTunnelSession";
import "./external-tunnels.css";

const machineLabel = (machine: RemoteMachine) =>
  isLocalSyncMachine(machine) ? t("This computer") : machine.name;

/** The status and repair notices a machine's tunnel read can raise. */
function TunnelNotices({
  session,
  repair = true,
  issue = true,
  retry = true,
}: {
  session: ReturnType<typeof useTunnelSession>;
  /** Show the damaged-state repair notice. */
  repair?: boolean;
  /** Show the read or start failure. */
  issue?: boolean;
  /** Offer "Check again" under the failure; the start form already has its own. */
  retry?: boolean;
}) {
  const { state, overview, controller } = session;
  const [repairNoticeDismissed, setRepairNoticeDismissed] = useState(false);
  return (
    <>
      {repair && overview?.repair && !repairNoticeDismissed ? (
        <Alert tone="info" onDismiss={() => setRepairNoticeDismissed(true)}>
          {t("Tunnel settings were damaged and repaired; {p0} entries could not be recovered.", {
            p0: String(overview.repair.dropped),
          })}
        </Alert>
      ) : null}
      {issue && state.issue ? <Alert tone="danger">{t(issueCopy[state.issue])}</Alert> : null}
      {issue && retry && state.issue && state.phase === "error" ? (
        <Button
          type="button"
          className="shrink-0 self-start"
          disabled={state.pending}
          onClick={() => void controller.refresh(true)}
        >
          {t("Check again")}
        </Button>
      ) : null}
    </>
  );
}

/** Keyed by machine identity at each entry point, so responses cannot cross hosts. */
export function TunnelControls({
  machine,
  initialLocalUrl = "3000",
  active = true,
}: {
  machine: RemoteMachine;
  initialLocalUrl?: string;
  active?: boolean;
}) {
  useLocale();
  const formId = useId();
  const session = useTunnelSession(machine, active);
  const draft = useTunnelDraft(initialLocalUrl);
  const { canStart, start } = useTunnelStart(session, draft);
  const { state, action } = session;
  return (
    <Text
      as="div"
      size="secondary"
      tone="primary"
      leading="inherit"
      className="external-tunnel-controls"
      aria-busy={state.pending || state.phase === "loading"}
    >
      <TunnelRows machine={machine} session={session} active={active} />
      <TunnelNotices session={session} retry={false} />
      <TunnelStartForm
        session={session}
        draft={draft}
        machineLabel={machineLabel(machine)}
        formId={formId}
        onStart={start}
        submit={
          <Button
            stableWidth
            type="submit"
            variant="primary"
            loading={state.pending && action === "start"}
            disabled={!canStart}
          >
            {t("Start tunnel")}
          </Button>
        }
      />
    </Text>
  );
}

type Report = { count: number; phase: "loading" | "ready" | "error" };

/** One computer's shared links, its notices and its share dialog. */
function MachineSharing({
  machine,
  active,
  grouped,
  sharing,
  onShareClose,
  computerPicker,
  onReport,
}: {
  machine: RemoteMachine;
  active: boolean;
  grouped: boolean;
  sharing: boolean;
  onShareClose: () => void;
  computerPicker: ReactNode;
  onReport: (key: string, report: Report) => void;
}) {
  const key = `${machine.id}:${machine.environmentId}`;
  const formId = useId();
  // An open share dialog keeps its computer's status current even if the tab hides.
  const session = useTunnelSession(machine, active || sharing);
  const draft = useTunnelDraft();
  const { canStart, start } = useTunnelStart(session, draft, onShareClose);
  const { state, action, overview } = session;
  const count = overview?.tunnels.length ?? 0;
  const phase = state.phase;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reports this machine's link count and read phase to the panel header and empty state.
  useEffect(() => onReport(key, { count, phase }), [key, count, phase, onReport]);
  const hasContent = count > 0 || !!state.issue || !!overview?.repair;
  return (
    <>
      {hasContent ? (
        <div className="external-tunnel-group" aria-busy={state.pending || phase === "loading"}>
          {grouped ? (
            <SectionLabel as="h3" count={count || null}>
              {machineLabel(machine)}
            </SectionLabel>
          ) : null}
          <TunnelRows machine={machine} session={session} />
          <TunnelNotices session={session} issue={!sharing} />
        </div>
      ) : null}
      {sharing ? (
        <Modal
          title={t("Create link")}
          description={
            computerPicker ? undefined : t("Share from {p0}", { p0: machineLabel(machine) })
          }
          size="md"
          onClose={onShareClose}
          footer={
            <ModalActions>
              <Button variant="ghost" type="button" onClick={onShareClose}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                type="submit"
                form={formId}
                loading={state.pending && action === "start"}
                disabled={!canStart}
              >
                {t("Start sharing")}
              </Button>
            </ModalActions>
          }
        >
          <div className="external-tunnel-controls">
            {computerPicker}
            <TunnelNotices session={session} repair={false} retry={false} />
            <TunnelStartForm
              session={session}
              draft={draft}
              machineLabel={machineLabel(machine)}
              formId={formId}
              onStart={start}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function ExternalTunnelsPanel({
  machines,
  loaded,
  loading,
  active = true,
}: {
  machines: RemoteMachine[];
  loaded: boolean;
  loading: boolean;
  /** The Sharing tab is showing; hidden, the panel stays mounted but stops polling Hosts. */
  active?: boolean;
}) {
  useLocale();
  const id = useId();
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const report = (key: string, next: Report) =>
    setReports((current) => {
      const previous = current[key];
      return previous && previous.count === next.count && previous.phase === next.phase
        ? current
        : { ...current, [key]: next };
    });
  const keys = ordered.map((entry) => `${entry.id}:${entry.environmentId}`);
  const total = keys.reduce((sum, key) => sum + (reports[key]?.count ?? 0), 0);
  const settled = keys.length > 0 && keys.every((key) => reports[key]?.phase === "ready");
  const checking =
    !loaded || loading || keys.some((key) => !reports[key] || reports[key].phase === "loading");
  const sharing = ordered.find((entry) => entry.id === sharingId);
  const computerPicker =
    ordered.length > 1 ? (
      <SearchableSelect
        label={t("Computer")}
        triggerProps={{ id: `${id}-machine` }}
        value={sharing?.id ?? ""}
        onChange={setSharingId}
        options={ordered.map((entry) => ({ value: entry.id, label: machineLabel(entry) }))}
      />
    ) : null;
  const share = () => setSharingId(ordered[0]?.id ?? null);
  return (
    <section className="external-tunnels-panel" aria-label={t("External tunnels")}>
      <SectionLabel
        as="h2"
        count={total || undefined}
        actions={
          <Button
            variant="primary"
            type="button"
            aria-haspopup="dialog"
            disabled={!loaded || loading || !ordered.length}
            onClick={share}
          >
            <Plus aria-hidden className="icon-sm" />
            {t("Create link")}
          </Button>
        }
      >
        {t("Shared links")}
      </SectionLabel>
      {ordered.map((entry) => (
        <MachineSharing
          key={`${entry.id}:${entry.environmentId}`}
          machine={entry}
          active={active}
          grouped={ordered.length > 1}
          sharing={entry.id === sharing?.id}
          onShareClose={() => setSharingId(null)}
          computerPicker={computerPicker}
          onReport={report}
        />
      ))}
      {total === 0 && checking ? <LoadingText>{t("Checking tunnel access…")}</LoadingText> : null}
      {loaded && !loading && !ordered.length ? (
        <EmptyState
          size="inline"
          kind="empty"
          description={t("Choose a connected computer to manage its tunnels.")}
        />
      ) : null}
      {total === 0 && settled && loaded && !loading ? (
        <EmptyState
          context="panel"
          kind="empty"
          title={t("No shared links")}
          description={t("Create a link to share a dev server or bycoda Host.")}
          showDescription
        />
      ) : null}
    </section>
  );
}
