import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sparkles, X } from "../../../shared/ui/icons";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import {
  ServerAgentContext,
  type ServerAgentSession,
  type ServerAgentTarget,
} from "../model/serverAgent";

export function ServerTerminalAgent({
  target,
  visible,
  children,
}: {
  target?: ServerAgentTarget;
  visible: boolean;
  children: (actions?: ReactNode, onSendToAgent?: (text: string) => Promise<void>) => ReactNode;
}) {
  const t = useT();
  const bridge = useContext(ServerAgentContext);
  const [binding, setBinding] = useState<{ project: string; session: ServerAgentSession }>();
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{
    project: string;
    operation: Promise<ServerAgentSession | undefined>;
  } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const mount = bridge?.mount;
  const session = binding?.project === bridge?.project ? binding?.session : undefined;
  const shown = visible && expanded && !!session && !!mount;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the app-owned conversation pointed at only the active tab's pane.
  useLayoutEffect(() => {
    if (shown && session && host.current) return mount(session, host.current);
  }, [shown, session, mount]);

  const open = () => {
    if (!bridge || !target) return Promise.resolve(undefined);
    if (pending.current?.project === bridge.project) return pending.current.operation;
    setOpening(true);
    setError("");
    const operation = bridge
      .open(target)
      .then(
        (opened) => {
          if (pending.current?.operation !== operation) return undefined;
          setBinding({ project: bridge.project, session: opened });
          setExpanded(true);
          return opened;
        },
        (reason: unknown) => {
          if (pending.current?.operation === operation) setError(errorText(reason));
          return undefined;
        },
      )
      .finally(() => {
        if (pending.current?.operation === operation) {
          pending.current = null;
          setOpening(false);
        }
      });
    pending.current = { project: bridge.project, operation };
    return operation;
  };
  const actions =
    bridge && target ? (
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={!!session && expanded}
        loading={opening}
        onClick={() => {
          if (session && expanded) setExpanded(false);
          else void open().catch(() => undefined);
        }}
      >
        <Sparkles aria-hidden className="icon-sm" />
        {t("Ask AI")}
      </Button>
    ) : undefined;
  const send =
    bridge && target
      ? async (text: string) => {
          const opened = await open();
          if (!opened) throw new Error(t("Could not add result to chat. Try again."));
          bridge.addSelection(opened.sessionId, text);
        }
      : undefined;
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 @max-[640px]:flex-col">
        <div className="flex min-h-24 min-w-0 flex-1 flex-col">
          {error ? <InlineError className="mx-3 my-1">{error}</InlineError> : null}
          {children(actions, send)}
        </div>
        {shown && session ? (
          <section
            aria-label={t("Ask AI")}
            {...surfaceAttributes(
              { frame: "pane", edge: "inline-start", variant: "workspace-panel" },
              "flex min-h-0 min-w-0 basis-[min(42%,28rem)] flex-col @max-[640px]:basis-1/2",
            )}
          >
            <PaneHeader
              title={t("Ask AI")}
              meta={target?.name}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Close")}
                  onClick={() => setExpanded(false)}
                >
                  <X aria-hidden />
                </Button>
              }
            />
            <div ref={host} className="flex min-h-0 min-w-0 flex-1 flex-col" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
