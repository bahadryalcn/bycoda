import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { StatusBadge, type BadgeStatus } from "../../../shared/ui/Badge";
import { LiveText } from "../../../shared/ui/LiveText";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Surface } from "../../../shared/ui/Surface";
import { reportFailure } from "../../../shared/ui/reportFailure";
import { useGracedFailure } from "../../connections/public/transientFailure";
import { stripAnsi } from "../../../shared/lib/ansi";
import {
  CODE_POLL_BASE_MS,
  codeTerminalPollDelay,
  terminalResultMessage,
} from "../model/codeTerminal";
import { loadCodeRunReport } from "../model/codeRunReport";
import type { RemoteCodeRun } from "../runtime/codeTerminalController";

const TerminalView = lazySurface(async () => ({
  default: (await import("./TerminalView")).TerminalView,
}));

export function RemoteCodeTerminalPane(
  props: RemoteCodeRun & { dockToolbarTarget?: HTMLDivElement | null },
) {
  return <CodeTerminalPresentation {...props} />;
}

export function CodeTerminalDialog(props: RemoteCodeRun & { onClose(): void }) {
  return <CodeTerminalPresentation {...props} />;
}

function CodeTerminalPresentation({
  controller,
  options,
  onClose,
  onReport,
  dockToolbarTarget,
}: RemoteCodeRun & { onClose?: () => void; dockToolbarTarget?: HTMLDivElement | null }) {
  const t = useT();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const readFailure = useGracedFailure({ error: state.readError, scope: state.id });
  const actionFailure = useGracedFailure({ error: state.actionError, scope: state.id });
  const [autoReport, setAutoReport] = useState(loadCodeRunReport);
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState<string>();
  const [reporting, setReporting] = useState(false);
  const reportSent = useRef(false);
  const [stopping, setStopping] = useState(false);
  const working =
    !readFailure.visibleError && (state.phase === "starting" || state.phase === "running");
  const exited = state.phase === "exited";
  const report = useStableCallback(() => {
    const finished = controller.snapshot();
    if (!onReport || reportSent.current || finished.phase !== "exited") return;
    reportSent.current = true;
    setReporting(true);
    setReportError(undefined);
    const message = terminalResultMessage(
      options.command,
      options.cwd,
      finished.shell,
      finished.output,
      finished.exitCode,
      finished.truncated,
    );
    void Promise.resolve()
      .then(() => onReport(message))
      .then((accepted) => {
        if (accepted === false) throw new Error(t("Could not add result to chat. Try again."));
        setReported(true);
      })
      .catch((error: unknown) => {
        reportSent.current = false;
        return reportFailure(error, { toast: { show: ({ message }) => setReportError(message) } });
      })
      .finally(() => setReporting(false))
      .catch(() => {});
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll the owned Host process while its terminal view is mounted.
  useEffect(() => {
    if (options.native || exited) return;
    let stopped = false;
    let idleReads = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      timer = undefined;
      // A hidden window reads nothing; visibilitychange resumes the loop.
      if (stopped || document.visibilityState === "hidden") return;
      void controller
        .refresh()
        .then((outcome) => {
          idleReads = outcome === "idle" ? idleReads + 1 : 0;
          failures = outcome === "failed" ? failures + 1 : 0;
        })
        .catch(() => {
          failures += 1;
        })
        .finally(() => {
          if (stopped || timer !== undefined || document.visibilityState === "hidden") return;
          timer = setTimeout(poll, codeTerminalPollDelay(idleReads, failures));
        })
        .catch(() => {});
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) return;
      idleReads = 0;
      poll();
    };
    timer = setTimeout(poll, CODE_POLL_BASE_MS);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [controller, options.native, exited]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe process settlement and attach its final drained output once when the owner selected reporting.
  useEffect(() => {
    if (!autoReport) return;
    const unsubscribe = controller.subscribe(report);
    report();
    return unsubscribe;
  }, [autoReport, controller, report]);
  const notStarted = state.phase === "not-started";
  const unknownStatus =
    state.phase === "unknown" || readFailure.visibleError || state.exitCode === null;
  // Success, failure and "can't tell" must look different at a glance, not only read differently.
  const statusKind: BadgeStatus =
    actionFailure.pending || working
      ? "running"
      : notStarted
        ? "failed"
        : unknownStatus
          ? "warning"
          : state.exitCode === 0
            ? "done"
            : "failed";
  const status = actionFailure.pending
    ? t("Loading…")
    : notStarted
      ? t("Could not run the command.")
      : state.phase === "starting"
        ? t("Loading…")
        : working
          ? t("Running command")
          : state.phase === "unknown" || readFailure.visibleError
            ? t("Command status unknown")
            : state.exitCode === 0
              ? t("Command completed")
              : state.exitCode === null
                ? t("Command status unknown")
                : t("Command exited with code {p0}", { p0: state.exitCode });
  const starting = state.phase === "starting";
  const stopCommand = () => {
    setStopping(true);
    return controller
      .stop()
      .then(() => {
        const result = controller.snapshot();
        return (
          !result.actionError && (!result.error || (options.native && result.phase === "unknown"))
        );
      })
      .finally(() => setStopping(false));
  };
  const closeDialog = () => {
    if (!onClose || starting || stopping) return;
    if (!working) {
      onClose();
      return;
    }
    void stopCommand()
      .then((accepted) => {
        if (accepted) onClose();
      })
      .catch(() => {});
  };
  const stop =
    (working || state.phase === "unknown" || readFailure.visibleError) &&
    (onClose ? !working : !controller.canDismiss()) ? (
      <Button
        variant="ghost"
        tone="danger"
        disabled={stopping || starting}
        disabledReason={starting ? t("Starting…") : undefined}
        onClick={() => void stopCommand().catch(() => {})}
      >
        {stopping ? t("Stopping…") : t("Stop")}
      </Button>
    ) : null;
  const addResult =
    onReport && !reported && exited ? (
      <Button loading={reporting} onClick={report}>
        {t("Add result to chat")}
      </Button>
    ) : null;
  const content = (
    <div
      className={
        onClose
          ? "flex min-w-0 flex-col gap-3"
          : "flex h-full min-w-0 flex-col gap-2 overflow-auto p-3"
      }
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <StatusBadge status={statusKind}>
          <LiveText text={status} />
        </StatusBadge>
        {onReport && !exited ? (
          <Checkbox
            label={t("Add result to chat when finished")}
            checked={autoReport}
            disabled={reported}
            onChange={(event) => setAutoReport(event.target.checked)}
          />
        ) : null}
        {onClose ? null : (
          <div className="flex items-center gap-2">
            {addResult}
            {stop}
          </div>
        )}
      </div>
      <OutputBlock frame="filled" scroll className="max-h-32">
        {options.command}
      </OutputBlock>
      <Surface
        variant="card"
        padding="none"
        className={
          onClose ? "h-80 min-w-0 overflow-hidden" : "min-h-12 min-w-0 flex-1 overflow-hidden"
        }
      >
        {options.native && state.profile ? (
          <TerminalView
            id={state.id}
            cwd={options.cwd}
            profile={state.profile}
            active
            canStart={options.isCurrent}
            dockToolbarTarget={dockToolbarTarget}
          />
        ) : (
          <OutputBlock
            scroll
            className="h-full p-3"
            aria-busy={readFailure.pending || actionFailure.pending || undefined}
          >
            {stripAnsi(state.output) ||
              (onClose && !notStarted && !actionFailure.pending ? status : undefined)}
          </OutputBlock>
        )}
      </Surface>
      {state.error ? (
        <InlineError details={state.error}>
          {notStarted ? t("Could not run the command.") : t("Could not confirm command status.")}
        </InlineError>
      ) : actionFailure.visibleError || readFailure.visibleError ? (
        // Graced failures are already presented sentences ("busy right now"), so they lead.
        <InlineError>{actionFailure.visibleError ?? readFailure.visibleError}</InlineError>
      ) : null}
      {reportError ? (
        <InlineError details={reportError}>
          {t("Could not add result to chat. Try again.")}
        </InlineError>
      ) : null}
      {state.truncated ? (
        <InlineMessage tone="warning">
          {t("Only the latest terminal output is included.")}
        </InlineMessage>
      ) : null}
      {reported ? (
        <InlineMessage tone="success">
          {t("Result added to chat. Review and send when ready.")}
        </InlineMessage>
      ) : null}
    </div>
  );
  if (!onClose) return content;
  return (
    <Modal
      title={t("Run in terminal")}
      context={options.cwd}
      size="xl"
      closeDisabled={starting || stopping}
      onClose={closeDialog}
      footer={
        <ModalActions start={stop}>
          {addResult}
          {working ? (
            <Button
              variant="primary"
              tone="danger"
              disabled={starting || stopping}
              disabledReason={starting ? t("Starting…") : undefined}
              onClick={closeDialog}
            >
              {stopping ? t("Stopping…") : t("Stop and close")}
            </Button>
          ) : (
            <Button variant="ghost" disabled={stopping} onClick={closeDialog}>
              {t("Close")}
            </Button>
          )}
        </ModalActions>
      }
    >
      {content}
    </Modal>
  );
}
