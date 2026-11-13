import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Alert } from "../../../shared/ui/Alert";
import { LiveText } from "../../../shared/ui/LiveText";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Surface } from "../../../shared/ui/Surface";
import { stripAnsi } from "../../../shared/lib/ansi";
import { terminalResultMessage } from "../model/codeTerminal";
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
  const [autoReport, setAutoReport] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState<string>();
  const [reporting, setReporting] = useState(false);
  const reportSent = useRef(false);
  const [stopping, setStopping] = useState(false);
  const working = state.phase === "starting" || state.phase === "running";
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
        setReportError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setReporting(false))
      .catch(() => {});
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll the owned Host process while this terminal dialog is mounted; never replay launch.
  useEffect(() => {
    if (options.native || state.phase === "exited") return;
    const timer = setInterval(() => {
      void controller.refresh().catch(() => {});
    }, 300);
    return () => clearInterval(timer);
  }, [controller, options.native, state.phase]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe process settlement and attach its final drained output once when the owner selected reporting.
  useEffect(() => {
    if (autoReport && state.phase === "exited") report();
  }, [autoReport, state.phase, report]);
  const status = working
    ? t("Running command")
    : state.phase === "unknown"
      ? t("Command status unknown")
      : state.exitCode === 0
        ? t("Command completed")
        : state.exitCode === null
          ? t("Command status unknown")
          : t("Command exited with code {p0}", { p0: state.exitCode });
  return (
    <Modal
      title={t("Run in terminal")}
      context={options.cwd}
      size="xl"
      closeDisabled={working}
      onClose={onClose}
      footer={
        <ModalActions
          start={
            working || state.phase === "unknown" ? (
              <Button
                variant="ghost"
                tone="danger"
                disabled={stopping || state.phase === "starting"}
                onClick={() => {
                  setStopping(true);
                  void controller
                    .stop()
                    .finally(() => setStopping(false))
                    .catch(() => {});
                }}
              >
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
          <Button variant="ghost" disabled={working} onClick={onClose}>
            {t("Close")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <LiveText text={status} />
          {onReport ? (
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
        <Surface variant="raised" padding="none" className="h-80 min-w-0 overflow-hidden">
          {options.native && state.profile ? (
            <TerminalView
              id={state.id}
              cwd={options.cwd}
              profile={state.profile}
              active
              canStart={options.isCurrent}
            />
          ) : (
            <OutputBlock scroll className="h-full p-3">
              {stripAnsi(state.output) || status}
            </OutputBlock>
          )}
        </Surface>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
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
