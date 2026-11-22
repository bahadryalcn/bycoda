import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Alert } from "../../../shared/ui/Alert";
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
import type {
  CodeTerminalController,
  CodeTerminalOptions,
} from "../runtime/codeTerminalController";

const TerminalView = lazySurface(async () => ({
  default: (await import("./TerminalView")).TerminalView,
}));

export function CodeTerminalDialog({
  controller,
  options,
  onClose,
  onReport,
}: {
  controller: CodeTerminalController;
  options: CodeTerminalOptions;
  onClose(): void;
  onReport?: (text: string) => boolean | void;
}) {
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
    if (!onReport || reportSent.current || state.phase !== "exited") return;
    reportSent.current = true;
    setReporting(true);
    setReportError(undefined);
    const message = terminalResultMessage(
      options.command,
      options.cwd,
      state.shell,
      state.output,
      state.exitCode,
      state.truncated,
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll the owned Host process while this terminal dialog is mounted; never replay launch.
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
    if (autoReport && state.phase === "exited") report();
  }, [autoReport, state.phase, report]);
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
      : working
        ? t("Running command")
        : state.phase === "unknown" || readFailure.visibleError
          ? t("Command status unknown")
          : state.exitCode === 0
            ? t("Command completed")
            : state.exitCode === null
              ? t("Command status unknown")
              : t("Command exited with code {p0}", { p0: state.exitCode });
  const stop = () => {
    setStopping(true);
    return controller
      .stop()
      .finally(() => setStopping(false))
      .catch(() => {});
  };
  // A running command is stopped before the dialog goes: closing never leaves it running unseen.
  const closeDialog = () => {
    if (!working) return onClose();
    if (state.phase === "starting") return;
    // A refused stop stays in the dialog with its failure instead of hiding it.
    void stop().then(() => {
      if (!controller.snapshot().actionError) onClose();
    });
  };
  return (
    <Modal
      title={t("Run in terminal")}
      context={options.cwd}
      size="xl"
      onClose={closeDialog}
      footer={
        <ModalActions
          start={
            !working && (state.phase === "unknown" || readFailure.visibleError) ? (
              <Button variant="ghost" tone="danger" disabled={stopping} onClick={() => void stop()}>
                {stopping ? t("Stopping…") : t("Stop")}
              </Button>
            ) : undefined
          }
        >
          {onReport && !reported && state.phase === "exited" ? (
            <Button disabled={reporting} onClick={report}>
              {t("Add result to chat")}
            </Button>
          ) : null}
          {working ? (
            <Button
              variant="primary"
              tone="danger"
              disabled={stopping || state.phase === "starting"}
              disabledReason={state.phase === "starting" ? t("Starting…") : undefined}
              onClick={closeDialog}
            >
              {stopping ? t("Stopping…") : t("Stop and close")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {t("Close")}
            </Button>
          )}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
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
        </div>
        <OutputBlock frame="filled" scroll className="max-h-32">
          {options.command}
        </OutputBlock>
        <Surface variant="card" padding="none" className="h-80 min-w-0 overflow-hidden">
          {options.native && state.profile ? (
            <TerminalView
              id={state.id}
              cwd={options.cwd}
              profile={state.profile}
              active
              canStart={options.isCurrent}
            />
          ) : (
            <OutputBlock
              scroll
              className="h-full p-3"
              aria-busy={readFailure.pending || actionFailure.pending || undefined}
            >
              {stripAnsi(state.output) ||
                (notStarted || actionFailure.pending ? undefined : status)}
            </OutputBlock>
          )}
        </Surface>
        {state.error || actionFailure.visibleError || readFailure.visibleError ? (
          <Alert tone="danger">
            {state.error ?? actionFailure.visibleError ?? readFailure.visibleError}
          </Alert>
        ) : null}
        {reportError ? <Alert tone="danger">{reportError}</Alert> : null}
        {state.truncated ? (
          <Alert tone="warning">{t("Only the latest terminal output is included.")}</Alert>
        ) : null}
        {reported ? (
          <LiveText text={t("Result added to chat. Review and send when ready.")} />
        ) : null}
      </div>
    </Modal>
  );
}
