import { Alert } from "../../shared/ui/Alert";
import { Button } from "../../shared/ui/Button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../shared/i18n/technical";
import type { ConversationTools } from "./SessionHostTools";
import { lazySurface } from "../../shared/ui/lazySurface";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { useDragResize } from "../../shared/hooks/useDragResize";
import {
  CircleX,
  ExternalLink,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Wrench,
  X,
} from "../../shared/ui/icons";
export { readHostToolsWindow } from "../../app/model/hostToolsWindow";
import "./tools-workspace.css";
import { setDockedToolPanes } from "./toolPaneState";
import { registerToolsUiControl, type ToolsUiState, type ToolsTab } from "./toolsUiControl";
import { listHostToolMachines } from "../connections/model/hostFeatureClient";

const SessionHostTools = lazySurface(async () => {
  const module = await import("./SessionHostTools");
  return { default: module.SessionHostTools };
});

type ToolPane = ConversationTools & { id: string; onlyTab?: "logs" };
type Placement = "left" | "right" | "top" | "bottom";
const OPEN_EVENT = "bycoda:open-tool-pane";
const placements = {
  left: { label: "Dock Left", Icon: PanelLeft },
  right: { label: "Dock Right", Icon: PanelRight },
  top: { label: "Dock Top", Icon: PanelTop },
  bottom: { label: "Dock Bottom", Icon: PanelBottom },
} as const;

function PlacementButton({
  value,
  onChange,
}: {
  value: Placement;
  onChange: (value: Placement) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { Icon, label } = placements[value];
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        ref={trigger}
        type="button"
        className="tools-workspace-icon"
        aria-label={`${t("Placement")}: ${t(label)}`}
        title={`${t("Placement")}: ${t(label)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Placement")}
          returnFocusRef={trigger}
          align="end"
          onClose={() => setOpen(false)}
          onPick={(side) => onChange(side as Placement)}
          items={(Object.keys(placements) as Placement[]).map((side) => {
            const option = placements[side];
            return {
              kind: "item",
              id: side,
              label: t(option.label),
              icon: <option.Icon className="size-4" aria-hidden />,
              checked: side === value,
              selectionRole: "radio",
            };
          })}
        />
      ) : null}
    </>
  );
}

export function dockHostTools(tools: ConversationTools, onlyTab?: "logs") {
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { ...tools, onlyTab, id: crypto.randomUUID() } }),
  );
}

export async function openHostToolsWindow(tools: ConversationTools, onlyTab?: "logs") {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const payload = {
    cwd: tools.cwd,
    sessionId: tools.sessionId,
    composerSessionId: tools.composerSessionId,
    title: tools.title,
    onlyTab,
    initialMachine: tools.initialMachine,
    initialTab: tools.initialTab,
    initialUrl: tools.initialUrl,
    composerWindow: tools.composerWindow ?? getCurrentWebviewWindow().label,
  };
  const view = new WebviewWindow(`tools-${crypto.randomUUID()}`, {
    url: `index.html?hostTools=${encodeURIComponent(JSON.stringify(payload))}`,
    title: `${onlyTab ? t("Logs") : t("Conversation tools")} · ${tools.title}`,
    width: 1000,
    height: 760,
    minWidth: 360,
    minHeight: 320,
    decorations: true,
    resizable: true,
  });
  await new Promise<void>((resolve, reject) => {
    void view.once("tauri://created", () => resolve()).catch(reject);
    void view
      .once("tauri://error", (event) => reject(new Error(String(event.payload))))
      .catch(reject);
  });
}

function ToolDock({ placement, children }: { placement: Placement; children: ReactNode }) {
  const dock = useRef<HTMLElement | null>(null);
  const vertical = placement === "top" || placement === "bottom";
  const resize = useDragResize({
    axis: vertical ? "vertical" : "horizontal",
    direction: placement === "right" || placement === "bottom" ? "left" : "right",
    min: vertical ? 160 : 260,
    max: () => {
      const parent = dock.current?.parentElement;
      const available = vertical ? parent?.clientHeight : parent?.clientWidth;
      return Math.max(
        0,
        (available ?? (vertical ? window.innerHeight : window.innerWidth)) -
          6 -
          (vertical ? 180 : 320),
      );
    },
    defaultWidth: vertical ? 300 : 420,
    initial: vertical ? 300 : 420,
  });
  return (
    <>
      <div
        {...resize.separatorProps}
        className="tools-workspace-resizer"
        data-dragging={resize.dragging}
        aria-label={t("Tool panels")}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
      <aside
        ref={(element) => {
          dock.current = element;
          resize.setPaneRef(element);
        }}
        className="tools-workspace-dock"
        aria-label={t("Tool panels")}
      >
        {children}
      </aside>
    </>
  );
}

/** Tools share the application's content region and leave its shell intact. */
export function ToolsWorkspace({ children }: { children: ReactNode }) {
  useLocale();
  const [panes, setPanes] = useState<ToolPane[]>([]);
  const paneOwner = useRef({});
  useEffect(() => {
    const owner = paneOwner.current;
    setDockedToolPanes(owner, panes);
    return () => setDockedToolPanes(owner, []);
  }, [panes]);
  const [placement, setPlacement] = useState<Placement>("right");
  const [error, setError] = useState("");
  const live = useRef({ panes, placement });
  live.current = { panes, placement };
  const views = useRef(new Map<string, { tab: ToolsTab; machine: string }>());
  useEffect(() => {
    for (const id of views.current.keys())
      if (!panes.some((pane) => pane.id === id)) views.current.delete(id);
  }, [panes]);
  useEffect(
    () =>
      registerToolsUiControl(async (context, action, input) => {
        const owns = (pane: ToolPane) =>
          pane.cwd === context.cwd && pane.sessionId === context.sessionId;
        const snapshot = (): ToolsUiState => {
          const owned = live.current.panes.filter(owns);
          return {
            open: owned.length > 0,
            placement: live.current.placement,
            panels: owned.map((pane) => ({
              id: pane.id,
              tab: views.current.get(pane.id)?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
              machine: views.current.get(pane.id)?.machine ?? pane.initialMachine ?? "project",
              mounted: views.current.has(pane.id),
            })),
          };
        };
        if (action === "ui.tools.status") return snapshot();
        if (
          input.machineId !== undefined &&
          !(await listHostToolMachines()).some((machine) => machine.id === input.machineId)
        )
          throw new Error("Selected tools machine is no longer connected.");
        let expectedId: string | undefined;
        let expectedMachine: string | undefined;
        let expectedTab: ToolsTab | undefined;
        if (action === "ui.tools.open") {
          const existing = live.current.panes.find((pane) => owns(pane) && !pane.onlyTab);
          expectedId = existing?.id ?? crypto.randomUUID();
          expectedTab =
            input.tab ?? views.current.get(expectedId)?.tab ?? existing?.initialTab ?? "devices";
          expectedMachine =
            input.machineId === undefined
              ? (views.current.get(expectedId)?.machine ?? existing?.initialMachine ?? "project")
              : `machine:${input.machineId}`;
          const pane: ToolPane = {
            ...existing,
            ...context,
            id: expectedId,
            composerSessionId: context.sessionId,
            initialTab: expectedTab,
            initialMachine: expectedMachine,
            viewRequest: { id: crypto.randomUUID(), tab: expectedTab, machine: expectedMachine },
          };
          setPanes((previous) =>
            existing
              ? previous.map((entry) => (entry.id === existing.id ? pane : entry))
              : [...previous, pane],
          );
        } else if (action === "ui.tools.close")
          setPanes((previous) => previous.filter((pane) => !owns(pane)));
        else if (!live.current.panes.some(owns))
          throw new Error("Open this session's tools panel before placing it.");
        if (input.placement !== undefined) setPlacement(input.placement);
        const deadline = Date.now() + 10000;
        do {
          await new Promise<void>((done) => {
            const frame = requestAnimationFrame(() => {
              clearTimeout(timer);
              done();
            });
            const timer = window.setTimeout(() => {
              cancelAnimationFrame(frame);
              done();
            }, 100);
          });
          const state = snapshot();
          const pane = state.panels.find((entry) => entry.id === expectedId);
          const ready =
            action === "ui.tools.close"
              ? !state.open
              : action === "ui.tools.open"
                ? pane?.mounted && pane.tab === expectedTab && pane.machine === expectedMachine
                : state.open;
          if (ready && (input.placement === undefined || state.placement === input.placement))
            return state;
        } while (Date.now() < deadline);
        throw new Error(
          "Tools panel did not finish rendering. Read ui.tools.status before retrying.",
        );
      }),
    [],
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const pane = (event as CustomEvent<ToolPane>).detail;
      setPanes((previous) => {
        const existing = previous.find(
          (item) =>
            item.cwd === pane.cwd &&
            item.sessionId === pane.sessionId &&
            item.onlyTab === pane.onlyTab,
        );
        return existing ? previous : [...previous, pane];
      });
    };
    window.addEventListener(OPEN_EVENT, receive);
    return () => window.removeEventListener(OPEN_EVENT, receive);
  }, []);
  const close = (id: string) => setPanes((previous) => previous.filter((pane) => pane.id !== id));
  return (
    <div
      className="tools-workspace font-sans"
      data-placement={placement}
      data-open={!!panes.length}
    >
      <div className="tools-workspace-main">{children}</div>
      {panes.length ? (
        <ToolDock placement={placement}>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          <div className="tools-workspace-panes">
            {panes.map((pane) => (
              <section className="tools-workspace-pane" key={pane.id}>
                <header className="tools-workspace-toolbar">
                  <Wrench className="size-4 tools-workspace-kind" aria-hidden />
                  <div className="tools-workspace-title" title={`${pane.title}\n${pane.cwd}`}>
                    <strong>{pane.onlyTab ? t("Logs") : t("Conversation tools")}</strong>
                    <span>{pane.title}</span>
                  </div>
                  <PlacementButton value={placement} onChange={setPlacement} />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="tools-workspace-icon"
                    aria-label={t("Open in new window")}
                    title={t("Open in new window")}
                    onClick={async () => {
                      try {
                        const current = views.current.get(pane.id);
                        await openHostToolsWindow({
                          ...pane,
                          initialTab: current?.tab ?? pane.initialTab,
                          initialMachine: current?.machine ?? pane.initialMachine,
                        }, pane.onlyTab);
                        close(pane.id);
                      } catch (cause) {
                        setError(String(cause));
                      }
                    }}
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </Button>
                  {panes.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="tools-workspace-icon"
                      aria-label={t("Close panels")}
                      title={t("Close panels")}
                      onClick={() => setPanes([])}
                    >
                      <CircleX className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="tools-workspace-icon"
                    onClick={() => close(pane.id)}
                    aria-label={t("Close panel")}
                    title={t("Close panel")}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </header>
                <SessionHostTools
                  {...pane}
                  hidePresentation
                  hideHeading
                  onViewChange={(view) => {
                    views.current.set(pane.id, view);
                  }}
                />
              </section>
            ))}
          </div>
        </ToolDock>
      ) : null}
    </div>
  );
}
