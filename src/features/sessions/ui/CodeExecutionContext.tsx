import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Play } from "../../../shared/ui/icons";
import { toast } from "../../../shared/ui/ToastRegion";
import {
  codeShellKind,
  type CodeShellKind,
  createCodeTerminal,
  type CodeTerminalController,
  type CodeTerminalOptions,
  CodeTerminalDialog,
  discardTerminalRun,
  loadCodeRunReport,
  terminalResultMessage,
} from "../../terminal/public/codeExecution";

export type CodeExecutionScope = {
  sessionId: string;
  projectCwd: string;
  native: boolean;
  /** Opens the queued native run as a project dock terminal; false falls back to the dialog. */
  openTerminal?: (sessionId: string, cwd: string, profile: string, terminalId: string) => boolean;
};

/** Adds the settled dock run's output to the composer once, when the owner setting allows it. */
function reportWhenSettled(
  controller: CodeTerminalController,
  options: CodeTerminalOptions,
  report: ((text: string) => void) | undefined,
) {
  const unsubscribe = controller.subscribe(() => {
    const state = controller.snapshot();
    if (state.phase !== "exited" && state.phase !== "unknown") return;
    unsubscribe();
    if (state.phase !== "exited" || !report || !loadCodeRunReport()) return;
    report(
      terminalResultMessage(
        options.command,
        options.cwd,
        state.shell,
        state.output,
        state.exitCode,
        state.truncated,
      ),
    );
  });
}
const CodeExecutionContext = createContext<
  ((command: string, shellKind: CodeShellKind) => void) | undefined
>(undefined);

/** Kept with the pooled transcript, including its original result destination. */
export function CodeExecutionProvider({
  scope,
  cwd,
  onReport,
  children,
}: {
  scope?: CodeExecutionScope;
  cwd?: string;
  onReport?: (text: string) => void;
  children: ReactNode;
}) {
  const t = useT();
  const latest = useRef({ scope, cwd });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep pending native launch guards synchronized with the committed conversation authority.
  useLayoutEffect(() => {
    latest.current = { scope, cwd };
  }, [scope, cwd]);
  const active = useRef(false);
  const [run, setRun] = useState<{
    controller: CodeTerminalController;
    options: CodeTerminalOptions;
    report?: (text: string) => void;
  }>();
  const execute = useStableCallback((command: string, shellKind: CodeShellKind) => {
    if (!scope || !cwd) return;
    if (active.current) return;
    active.current = true;
    const options: CodeTerminalOptions = {
      projectCwd: scope.projectCwd,
      native: scope.native,
      cwd,
      command,
      shellKind,
      isCurrent: () =>
        latest.current.cwd === cwd &&
        latest.current.scope?.sessionId === scope.sessionId &&
        latest.current.scope?.projectCwd === scope.projectCwd &&
        latest.current.scope?.native === scope.native,
    };
    const controller = createCodeTerminal(options);
    const openTerminal = scope.openTerminal;
    if (!scope.native || !openTerminal) {
      setRun({ controller, options, report: onReport });
      void controller.start().catch(() => {});
      return;
    }
    // Native runs open in the project terminal dock; the dialog stays the fallback.
    void controller
      .start()
      .then(() => {
        const state = controller.snapshot();
        if (state.phase !== "running" || !state.profile) {
          active.current = false;
          toast.show({ tone: "danger", message: state.error ?? t("Could not run the command.") });
          return;
        }
        if (!options.isCurrent()) {
          // The conversation moved on before the terminal opened: never run its code later.
          discardTerminalRun(state.id);
          active.current = false;
          return;
        }
        if (!openTerminal(scope.sessionId, cwd, state.profile, state.id)) {
          setRun({ controller, options, report: onReport });
          return;
        }
        active.current = false;
        reportWhenSettled(controller, options, onReport);
      })
      .catch(() => {
        active.current = false;
      });
  });
  return (
    <CodeExecutionContext.Provider value={scope && cwd ? execute : undefined}>
      {children}
      {run ? (
        <CodeTerminalDialog
          controller={run.controller}
          options={run.options}
          onReport={run.report}
          onClose={() => {
            active.current = false;
            setRun(undefined);
          }}
        />
      ) : null}
    </CodeExecutionContext.Provider>
  );
}

export function CodeRunButton({
  code,
  language,
  incomplete,
}: {
  code: string;
  language: string;
  incomplete: boolean;
}) {
  const t = useT();
  const execute = useContext(CodeExecutionContext);
  const shellKind = codeShellKind(language);
  if (!execute || !shellKind) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      motion="none"
      iconOnly
      label={t("Run in terminal")}
      tooltip={t("Run in terminal")}
      className="markdown-code-copy markdown-code-run"
      disabled={incomplete || !code.trim()}
      onClick={() => execute(code.replace(/\r?\n$/, ""), shellKind)}
    >
      <Play aria-hidden className="icon-sm" />
    </Button>
  );
}
