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
import {
  codeShellKind,
  type CodeShellKind,
  createCodeTerminal,
  type CodeTerminalController,
  type CodeTerminalOptions,
  CodeTerminalDialog,
} from "../../terminal/public/codeExecution";

export type CodeExecutionScope = { sessionId: string; projectCwd: string; native: boolean };
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
    setRun({ controller, options, report: onReport });
    void controller.start().catch(() => {});
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
