import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { observeResize } from "../../../shared/lib/observeResize";
import { Button } from "../../../shared/ui/Button";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { Sparkles, X } from "../../../shared/ui/icons";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { NewSessionProjectDialog } from "../../projects/public/NewSessionProjectDialog";
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
  children: (
    actions?: ReactNode,
    onSendToAgent?: (text: string) => Promise<void>,
    onSendToHost?: (text: string) => Promise<void>,
  ) => ReactNode;
}) {
  const t = useT();
  const bridge = useContext(ServerAgentContext);
  const [binding, setBinding] = useState<{ project: string; session: ServerAgentSession }>();
  const [request, setRequest] = useState<{ text?: string; direct?: boolean }>();
  const [expanded, setExpanded] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const mount = bridge?.mount;
  const session =
    binding?.project === "~" || bridge?.projects.some(({ path }) => path === binding?.project)
      ? binding?.session
      : undefined;
  const shown = visible && expanded && !!session && !!mount;
  const defaultSize = stacked ? 340 : 448;
  const resize = useDragResize({
    axis: stacked ? "vertical" : "horizontal",
    min: stacked ? 160 : 280,
    max: () =>
      layout.current
        ? stacked
          ? layout.current.clientHeight - 120
          : layout.current.clientWidth - 280
        : defaultSize,
    defaultWidth: defaultSize,
    initial: defaultSize,
    direction: "left",
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Match the sash axis to the container layout.
  useLayoutEffect(() => {
    if (!visible || !layout.current) return;
    const element = layout.current;
    const sync = () => setStacked(element.clientWidth <= 640);
    sync();
    return observeResize(element, sync);
  }, [visible]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the app-owned conversation pointed at only the active tab's pane.
  useLayoutEffect(() => {
    if (shown && session && host.current) return mount(session, host.current);
  }, [shown, session, mount]);

  const openIn = async (project: string, pending: { text?: string; direct?: boolean }) => {
    if (!bridge || !target) return;
    const opened = await bridge.open(target, project);
    setBinding({ project, session: opened });
    setExpanded(true);
    if (pending.text) {
      if (pending.direct) await bridge.sendSelection(opened, pending.text);
      else bridge.addSelection(opened.sessionId, pending.text);
    }
  };
  // One project is no choice: open in it directly. Several ask which one first.
  const begin = (pending: { text?: string; direct?: boolean }) => {
    const only = bridge?.projects.length === 1 ? bridge.projects[0] : undefined;
    if (only) void openIn(only.path, pending);
    else setRequest(pending);
  };
  const actions =
    bridge && target ? (
      <Button
        variant="ghost"
        size="sm"
        pressed={!!session && expanded}
        onClick={() => {
          if (session && expanded) setExpanded(false);
          else begin({});
        }}
      >
        <Sparkles aria-hidden className="icon-sm" />
        {t("Ask AI")}
      </Button>
    ) : undefined;
  const send = async (text: string, direct: boolean) => {
    if (!bridge || !target) return;
    if (!shown || !session) {
      begin({ text, direct });
      return;
    }
    if (direct) await bridge.sendSelection(session, text);
    else bridge.addSelection(session.sessionId, text);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div ref={layout} className={`flex min-h-0 min-w-0 flex-1 ${stacked ? "flex-col" : ""}`}>
        <div className="flex min-h-24 min-w-0 flex-1 flex-col">
          {children(
            actions,
            bridge && target ? (text) => send(text, false) : undefined,
            bridge && target ? (text) => send(text, true) : undefined,
          )}
        </div>
        {shown && session ? (
          <>
            <Sash {...resize.sashProps} label={t("Resize panel")} />
            <section
              ref={resize.setPaneRef}
              aria-label={t("Ask AI")}
              {...surfaceAttributes(
                { frame: "pane", variant: "workspace-panel" },
                "flex min-h-0 min-w-0 shrink-0 flex-col",
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
          </>
        ) : null}
      </div>
      {visible && request && bridge && target ? (
        <NewSessionProjectDialog
          projects={bridge.projects}
          onClose={() => setRequest(undefined)}
          onPick={(project) => openIn(project, request)}
        />
      ) : null}
    </div>
  );
}
