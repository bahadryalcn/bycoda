import { surfaceAttributes } from "../../shared/ui/Surface";
import {
  readWorkspaceTransfer,
  restoreWorkspaceTransfer,
  toolsTransferContent,
  toolsTransferFingerprint,
  toolsTransferEdits,
  toolsTransferError,
  toolsTransferScope,
  ToolsTransferLedger,
  type ToolsWorkspaceTransfer,
} from "./toolsTransferLedger";
import { restoreBrowserDraftTransfer } from "./browserDraftTransfer";
import { Alert } from "../../shared/ui/Alert";
import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../shared/i18n/technical";
import type { ConversationTools } from "./SessionHostTools";
import { lazySurface } from "../../shared/ui/lazySurface";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { PaneHeader } from "../../shared/ui/PaneHeader";
import { Sash } from "../../shared/ui/Sash";
import { Tooltip } from "../../shared/ui/Tooltip";
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
import {
  registerToolsUiControl,
  type ToolsUiState,
  type ToolsTab,
  type RoomToolsUiContext,
} from "./toolsUiControl";
import { BrowserPanel } from "./BrowserPanel";
import { subscribeGroupLock } from "../group-lock/model/groupLock";
import {
  getRoomPrivacyStatus,
  subscribeRoomPrivacyStatus,
} from "../group-lock/model/roomPrivacyProjection";
import { sameProjectPath } from "../projects/model/recents";
import { elapsedSince, monotonicNow } from "../../shared/lib/time/timestamps";
import {
  sameToolsSession,
  toolsSessionKey,
  toolsSessionMetadata,
  type ToolsSession,
  type ToolsSourceSnapshot,
} from "./toolsSessionRegistry";
import {
  nativeToolsAvailable,
  queryToolsPresentation,
  verifyToolsComposerOwner,
  type ToolsPresentation,
  sendToolsHub,
  subscribeToolsHub,
  TOOLS_HUB_LABEL,
  waitToolsAcknowledgement,
} from "./toolsHubTransport";
import { listHostToolMachines } from "../connections/model/hostFeatureClient";

const SessionHostTools = lazySurface(async () => {
  const module = await import("./SessionHostTools");
  return { default: module.SessionHostTools };
});

type ToolPane = ConversationTools & { id: string; onlyTab?: "logs"; detached?: boolean };
type Placement = "left" | "right" | "top" | "bottom";
const OPEN_EVENT = "bycoda:open-tool-pane";
const LAYOUT_KEY = "bycoda.tools-dock.placement.v1";
function readPlacements(): Record<string, Placement> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, placement]) =>
        ["left", "right", "top", "bottom"].includes(String(placement)),
      ),
    ) as Record<string, Placement>;
  } catch {
    return {};
  }
}
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
        iconOnly
        ref={trigger}
        type="button"
        className="tools-workspace-icon"
        label={`${t("Placement")}: ${t(label)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon className="icon-sm" aria-hidden />
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
              icon: <option.Icon className="icon-sm" aria-hidden />,
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

const transferRequests = new Map<
  string,
  {
    requestId: string;
    fingerprint: string;
    editFingerprint: string;
    pane: import("./toolsSessionRegistry").ToolsRegistration;
    drafts: ToolsWorkspaceTransfer;
  }
>();

export async function openHostToolsWindow(tools: ConversationTools, onlyTab?: "logs") {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const payload = {
    cwd: tools.cwd,
    sessionId: tools.sessionId,
    composerSessionId: tools.composerSessionId,
    title: tools.title,
    projectName: tools.projectName,
    branch: tools.branch,
    worktreeCwd: tools.worktreeCwd,
    model: tools.model,
    status: tools.status,
    onlyTab,
    initialMachine: tools.initialMachine,
    initialTab: tools.initialTab,
    initialUrl: tools.initialUrl,
    composerWindow: tools.composerWindow ?? getCurrentWebviewWindow().label,
  };
  const native = nativeToolsAvailable();
  const currentDrafts = readWorkspaceTransfer({ ...tools, onlyTab });
  const transferKey = JSON.stringify([
    payload.composerWindow,
    toolsTransferScope({ ...tools, onlyTab }),
  ]);
  const editFingerprint = await toolsTransferFingerprint(
    toolsTransferEdits(payload, currentDrafts),
  );
  const previous = transferRequests.get(transferKey);
  if (previous && previous.editFingerprint !== editFingerprint)
    throw new Error(
      t("Tools changed after an uncertain transfer. Both workspaces retained for review."),
    );
  if (!previous && transferRequests.size >= 8)
    throw new Error(t("Too many unresolved tools transfers. Keep the original workspace open."));
  const pending = previous ?? {
    requestId: crypto.randomUUID(),
    editFingerprint,
    fingerprint: await toolsTransferFingerprint(toolsTransferContent(payload, currentDrafts)),
    pane: { ...payload, id: crypto.randomUUID(), detached: true },
    drafts: structuredClone(currentDrafts),
  };
  pending.pane.viewRequest ??= {
    id: pending.requestId,
    tab: payload.initialTab,
    machine: payload.initialMachine,
  };
  transferRequests.set(transferKey, pending);
  const { requestId, pane, drafts } = pending;
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { ...pane, initialUrl: undefined, registerOnly: true } }),
  );
  let destinationWindow = TOOLS_HUB_LABEL;
  const transfer = async () => {
    const existing = native
      ? ((await WebviewWindow.getByLabel(TOOLS_HUB_LABEL)) ??
        (
          await import("@tauri-apps/api/webviewWindow").then(({ getAllWebviewWindows }) =>
            getAllWebviewWindows(),
          )
        ).find((view) => view.label.startsWith("tools-")))
      : null;
    if (existing) {
      destinationWindow = existing.label;
      await sendToolsHub(existing.label, {
        kind: "transfer",
        requestId,
        sourceWindow: payload.composerWindow,
        pane,
        drafts,
      });
      await existing.show();
      await existing.setFocus();
      return;
    }
    const create = async () => {
      const view = new WebviewWindow(TOOLS_HUB_LABEL, {
        url: `index.html?hostTools=${encodeURIComponent(JSON.stringify({ ...payload, transferRequestId: native ? requestId : undefined }))}`,
        title: t("Conversation tools"),
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
    };
    if (native) {
      const reusedWindow = new Error("Tools hub already exists");
      try {
        await waitToolsAcknowledgement(
          requestId,
          "ready",
          async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const created = await invoke<boolean>("open_host_tools_window", {
              title: t("Conversation tools"),
              payload: { ...payload, transferRequestId: requestId },
            });
            // An existing destination has already booted; release the ready listener
            // and send the immutable transfer under the outer mounted acknowledgement.
            if (!created) throw reusedWindow;
          },
          () => ({ window: TOOLS_HUB_LABEL }),
        );
      } catch (error) {
        if (error !== reusedWindow) throw error;
      }
      await sendToolsHub(TOOLS_HUB_LABEL, {
        kind: "transfer",
        requestId,
        sourceWindow: payload.composerWindow,
        pane,
        drafts,
      });
    } else await create();
  };
  if (native)
    await waitToolsAcknowledgement(requestId, "mounted", transfer, () => ({
      window: destinationWindow,
      session: tools,
      tab: onlyTab ?? tools.initialTab ?? "devices",
      machine: tools.initialMachine ?? "project",
    }));
  else await transfer();
  transferRequests.delete(transferKey);
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { ...pane, initialUrl: undefined, detached: true } }),
  );
}

function ToolDock({
  placement,
  children,
  layoutKey,
}: {
  placement: Placement;
  children: ReactNode;
  layoutKey: string;
}) {
  const dock = useRef<HTMLElement | null>(null);
  const vertical = placement === "top" || placement === "bottom";
  const sizeKey = `bycoda.tools-dock.size.v1:${layoutKey}:${vertical ? "vertical" : "horizontal"}`;
  const defaultSize = vertical ? 300 : 420;
  const readSize = () => {
    try {
      const value = Number(localStorage.getItem(sizeKey));
      return Number.isFinite(value) && value >= 100 && value <= 10000 ? value : defaultSize;
    } catch {
      return defaultSize;
    }
  };
  const restoringSize = useRef(true);
  const previousSizeKey = useRef(sizeKey);
  if (previousSizeKey.current !== sizeKey) {
    previousSizeKey.current = sizeKey;
    restoringSize.current = true;
  }
  const resize = useDragResize({
    axis: vertical ? "vertical" : "horizontal",
    direction: placement === "right" || placement === "bottom" ? "left" : "right",
    min: vertical ? 160 : 260,
    max: () => {
      const parent = dock.current?.closest(".tools-workspace") as HTMLElement | null;
      const available = vertical ? parent?.clientHeight : parent?.clientWidth;
      return Math.max(
        0,
        (available ?? (vertical ? window.innerHeight : window.innerWidth)) -
          6 -
          (vertical ? 180 : 320),
      );
    },
    defaultWidth: vertical ? 300 : 420,
    initial: readSize(),
    onCommit: (value) => {
      if (!restoringSize.current)
        try {
          localStorage.setItem(sizeKey, String(value));
        } catch {
          /* Keep current size. */
        }
    },
  });
  useEffect(() => {
    const restore = () => {
      restoringSize.current = true;
      resize.setWidth(readSize());
      restoringSize.current = false;
    };
    restore();
    window.addEventListener("resize", restore);
    return () => window.removeEventListener("resize", restore);
  }, [sizeKey]);
  return (
    <>
      <Sash {...resize.sashProps} label={t("Tool panels")} />
      <Text
        as="aside"
        size="inherit"
        tone="primary"
        ref={(element) => {
          dock.current = element;
          resize.setPaneRef(element);
        }}
        {...surfaceAttributes({ variant: "canvas" }, "tools-workspace-dock")}
        aria-label={t("Tool panels")}
      >
        {children}
      </Text>
    </>
  );
}

/** Tools share the application's content region and leave its shell intact. */
export function ToolsWorkspace({
  children,
  activeConversation,
  accessibleSessions,
  followEligible = true,
}: {
  children: ReactNode;
  activeConversation?: ToolsSession | null;
  accessibleSessions?: readonly ToolsSession[];
  followEligible?: boolean;
}) {
  useLocale();
  const activeRef = useRef(activeConversation);
  activeRef.current = activeConversation;
  const eligibleRef = useRef(followEligible);
  eligibleRef.current = followEligible;
  const accessibleRef = useRef(accessibleSessions);
  accessibleRef.current = accessibleSessions;
  const [panes, setPanes] = useState<ToolPane[]>([]);
  const [roomPane, setRoomPane] = useState<{ id: string; context: RoomToolsUiContext }>();
  const roomPaneRef = useRef(roomPane);
  roomPaneRef.current = roomPane;
  const roomMounted = useRef<string | undefined>(undefined);
  useEffect(() => {
    const check = () => {
      const current = roomPaneRef.current;
      const privacy = getRoomPrivacyStatus();
      if (current && (!current.context.valid() || privacy.pending || privacy.error)) {
        roomPaneRef.current = undefined;
        roomMounted.current = undefined;
        setRoomPane(undefined);
      }
    };
    const a = subscribeGroupLock(check),
      b = subscribeRoomPrivacyStatus(check);
    return () => {
      a();
      b();
    };
  }, []);
  const paneOwner = useRef({});
  useEffect(() => {
    const owner = paneOwner.current;
    setDockedToolPanes(
      owner,
      panes.filter((pane) => !pane.detached),
    );
    return () => setDockedToolPanes(owner, []);
  }, [panes]);
  const [sessionPlacements, setSessionPlacements] = useState(readPlacements);
  const placementsRef = useRef(sessionPlacements);
  placementsRef.current = sessionPlacements;
  const presentationSession =
    activeConversation ?? (activeConversation === undefined ? panes[0] : undefined);
  const placement = presentationSession
    ? (sessionPlacements[toolsSessionKey(presentationSession)] ?? "right")
    : "right";
  const setSessionPlacement = (
    session: Pick<ToolsSession, "cwd" | "sessionId">,
    value: Placement,
  ) => {
    const next = { ...placementsRef.current, [toolsSessionKey(session)]: value };
    placementsRef.current = next;
    setSessionPlacements(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* Current layout remains usable. */
    }
  };
  const [error, setError] = useState("");
  const [detaching, setDetaching] = useState<string>();
  const transfers = useRef(new Set<string>());
  const live = useRef({ panes, placement, activeConversation });
  live.current = { panes, placement, activeConversation };
  const views = useRef(new Map<string, { tab: ToolsTab; machine: string }>());
  const mountedPanes = useRef(new Set<string>());
  const mountedDomains = useRef(new Set<string>());
  const detachedPresentations = useRef(new Map<string, ToolsPresentation>());
  useEffect(() => {
    for (const key of mountedDomains.current)
      if (!panes.some((pane) => pane.id === JSON.parse(key)[0])) mountedDomains.current.delete(key);
    for (const id of views.current.keys())
      if (!panes.some((pane) => pane.id === id)) {
        views.current.delete(id);
        mountedPanes.current.delete(id);
      }
  }, [panes]);
  useEffect(
    () =>
      registerToolsUiControl(async (requestedContext, action, input) => {
        if (requestedContext.kind === "room") {
          const owns = (pane: typeof roomPane) =>
            !!pane &&
            pane.context.threadId === requestedContext.threadId &&
            pane.context.projectId === requestedContext.projectId &&
            pane.context.environmentId === requestedContext.environmentId &&
            sameProjectPath(pane.context.cwd, requestedContext.cwd);
          const snapshot = (): ToolsUiState => {
            const pane = roomPaneRef.current;
            const open = owns(pane) && requestedContext.valid();
            return {
              open,
              visible: open,
              presentation: "docked",
              placement: "right",
              panels:
                open && pane
                  ? [
                      {
                        id: pane.id,
                        tab: "browser",
                        machine: "project",
                        mounted: roomMounted.current === pane.id,
                        visible: true,
                        presentationKnown: true,
                      },
                    ]
                  : [],
            };
          };
          if (action === "ui.tools.status") return snapshot();
          if (action !== "ui.tools.open" || !requestedContext.valid())
            throw new Error("Room browser source is unavailable.");
          const existing = roomPaneRef.current;
          const pane =
            owns(existing) && existing
              ? { ...existing, context: requestedContext }
              : { id: crypto.randomUUID(), context: requestedContext };
          if (!existing || existing.id !== pane.id) roomMounted.current = undefined;
          roomPaneRef.current = pane;
          setRoomPane(pane);
          const startedAt = monotonicNow();
          while (elapsedSince(startedAt) < 10000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
            if (!requestedContext.valid()) throw new Error("Room browser source changed.");
            if (roomMounted.current === pane.id) return snapshot();
          }
          throw new Error("Room browser panel did not finish rendering.");
        }
        const context =
          accessibleRef.current?.find(
            (session) =>
              sameToolsSession(session, requestedContext) ||
              (session.composerSessionId === requestedContext.sessionId &&
                sameToolsSession({ ...requestedContext, sessionId: session.sessionId }, session)),
          ) ?? requestedContext;
        const owns = (pane: ToolPane) => sameToolsSession(pane, context);
        const readDetached = async () => {
          await Promise.all(
            live.current.panes
              .filter((pane) => owns(pane) && pane.detached)
              .map(async (pane) => {
                const presentation = await queryToolsPresentation(pane);
                if (presentation) detachedPresentations.current.set(pane.id, presentation);
                else detachedPresentations.current.delete(pane.id);
              }),
          );
        };
        const snapshot = (): ToolsUiState => {
          const owned = live.current.panes.filter(owns);
          const panels = owned.map((pane) => {
            const detached = pane.detached ? detachedPresentations.current.get(pane.id) : undefined;
            const sourceView = views.current.get(pane.id);
            return {
              id: pane.id,
              tab:
                detached?.tab ??
                sourceView?.tab ??
                pane.onlyTab ??
                pane.initialTab ??
                ("devices" as ToolsTab),
              machine: detached?.machine ?? sourceView?.machine ?? pane.initialMachine ?? "project",
              mounted: pane.detached
                ? detached?.mounted
                : mountedDomains.current.has(
                    JSON.stringify([
                      pane.id,
                      sourceView?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
                      sourceView?.machine ?? pane.initialMachine ?? "project",
                    ]),
                  ),
              visible: pane.detached
                ? detached?.visible
                : live.current.activeConversation === undefined ||
                  sameToolsSession(pane, live.current.activeConversation),
              presentationKnown: !pane.detached || !!detached,
            };
          });
          return {
            open: owned.length > 0,
            visible: panels.some((panel) => panel.visible === true)
              ? true
              : panels.some((panel) => panel.visible === undefined)
                ? undefined
                : false,
            presentation: owned.some((pane) => pane.detached) ? "detached" : "docked",
            placement: placementsRef.current[toolsSessionKey(context)] ?? "right",
            panels,
          };
        };
        if (action === "ui.tools.status") {
          await readDetached();
          return snapshot();
        }
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
            input.projectHost === true
              ? "project"
              : input.machineId === undefined
                ? (views.current.get(expectedId)?.machine ?? existing?.initialMachine ?? "project")
                : `machine:${input.machineId}`;
          const pane: ToolPane = {
            ...existing,
            ...context,
            id: expectedId,
            composerSessionId:
              existing?.composerSessionId ??
              accessibleRef.current?.find((session) => sameToolsSession(context, session))
                ?.composerSessionId ??
              (sameToolsSession(context, live.current.activeConversation)
                ? live.current.activeConversation?.composerSessionId
                : undefined),
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
        if (input.placement !== undefined) setSessionPlacement(context, input.placement);
        const startedAt = monotonicNow();
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
          await readDetached();
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
        } while (elapsedSince(startedAt) < 10000);
        throw new Error(
          "Tools panel did not finish rendering. Read ui.tools.status before retrying.",
        );
      }),
    [],
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const pane = (event as CustomEvent<ToolPane & { registerOnly?: boolean }>).detail;
      setPanes((previous) => {
        const existing = previous.find(
          (item) => sameToolsSession(item, pane) && item.onlyTab === pane.onlyTab,
        );
        if (existing && pane.registerOnly) return previous;
        return existing
          ? previous.map((entry) =>
              entry.id === existing.id ? { ...entry, detached: pane.detached === true } : entry,
            )
          : [...previous, pane];
      });
    };
    window.addEventListener(OPEN_EVENT, receive);
    return () => window.removeEventListener(OPEN_EVENT, receive);
  }, []);
  const sourceRevision = useRef(0);
  const sourceEpoch = useRef(Date.now());
  const selectionRevision = useRef(0);
  const lastSelection = useRef<ToolsSession | null | undefined>(undefined);
  const sourceWindow = useRef("");
  const reattachReceipts = useRef(
    new ToolsTransferLedger<import("./toolsHubTransport").ToolsHubMessage>(),
  );
  const pendingReattach = useRef<
    { destination: string; requestId: string; session: ToolsSession }[]
  >([]);
  const makeSnapshot = (): ToolsSourceSnapshot => ({
    sourceWindow: sourceWindow.current,
    sourceEpoch: sourceEpoch.current,
    revision: ++sourceRevision.current,
    selectionRevision: selectionRevision.current,
    active: live.current.activeConversation
      ? toolsSessionMetadata(live.current.activeConversation)
      : null,
    panes: live.current.panes
      .filter(
        (pane) =>
          !accessibleRef.current ||
          accessibleRef.current.some((session) => sameToolsSession(session, pane)),
      )
      .map((pane) => ({
        ...toolsSessionMetadata(pane),
        id: pane.id,
        detached: pane.detached,
        viewRequest: pane.viewRequest,
        ...toolsSessionMetadata(
          accessibleRef.current?.find((session) => sameToolsSession(session, pane)) ?? pane,
        ),
        onlyTab: pane.onlyTab,
        initialTab: views.current.get(pane.id)?.tab ?? pane.initialTab,
        initialMachine: views.current.get(pane.id)?.machine ?? pane.initialMachine,
        composerWindow: pane.composerWindow ?? sourceWindow.current,
      })),
  });
  const publish = () => {
    if (nativeToolsAvailable() && sourceWindow.current)
      void import("@tauri-apps/api/webviewWindow")
        .then(async ({ getAllWebviewWindows }) => {
          const snapshot = makeSnapshot();
          const hubs = (await getAllWebviewWindows()).filter((view) =>
            view.label.startsWith("tools-"),
          );
          await Promise.all(
            hubs.map((view) => sendToolsHub(view.label, { kind: "snapshot", snapshot })),
          );
        })
        .catch(() => {});
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;
  useEffect(() => {
    if (!nativeToolsAvailable()) return;
    let disposed = false;
    let focusRevision = 0;
    const focus = () => {
      const session = activeRef.current;
      if (!session || !eligibleRef.current || !sourceWindow.current || !document.hasFocus()) return;
      const revision = ++focusRevision;
      void verifyToolsComposerOwner(session)
        .then((owns) => {
          if (
            disposed ||
            !owns ||
            revision !== focusRevision ||
            !document.hasFocus() ||
            !eligibleRef.current ||
            !sameToolsSession(session, activeRef.current)
          )
            return;
          selectionRevision.current = Math.max(Date.now(), selectionRevision.current + 1);
          publishRef.current();
        })
        .catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      ++focusRevision;
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    if (!nativeToolsAvailable()) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        sourceWindow.current = getCurrentWebviewWindow().label;
        const unlisten = await subscribeToolsHub((message) => {
          if (message.kind === "request") {
            void sendToolsHub(message.destination, {
              kind: "snapshot",
              snapshot: makeSnapshot(),
            }).catch(() => {});
          } else if (message.kind === "reattach") {
            const pane = live.current.panes.find((entry) =>
              sameToolsSession(entry, message.session),
            );
            if (!pane || !views.current.has(pane.id)) return;
            let reserved = false;
            void (async () => {
              const fingerprint = await toolsTransferFingerprint(
                toolsTransferContent(message.session, message.drafts),
              );
              const scope = toolsTransferScope(message.session);
              const receipt = reattachReceipts.current.find(
                message.requestId,
                message.destination,
                scope,
                fingerprint,
              );
              if (receipt) {
                if (receipt.ack) await sendToolsHub(message.destination, receipt.ack);
                return;
              }
              if (disposed || !(await verifyToolsComposerOwner(pane)))
                throw new Error(t("Conversation tools owner unavailable."));
              reattachReceipts.current.begin(
                message.requestId,
                message.destination,
                scope,
                fingerprint,
              );
              reserved = true;
              if (message.drafts) restoreWorkspaceTransfer(pane, message.drafts);
              if (message.session.browserDraft)
                restoreBrowserDraftTransfer(
                  pane.cwd,
                  pane.sessionId,
                  message.session.initialMachine ?? pane.initialMachine ?? "project",
                  message.session.browserDraft,
                );
              pendingReattach.current.push({
                destination: message.destination,
                requestId: message.requestId,
                session: {
                  ...pane,
                  initialTab: message.session.initialTab,
                  initialMachine: message.session.initialMachine,
                },
              });
              setPanes((previous) =>
                previous.map((entry) =>
                  entry.id === pane.id
                    ? {
                        ...entry,
                        detached: false,
                        viewRequest: {
                          id: message.requestId,
                          tab: message.session.initialTab,
                          machine: message.session.initialMachine,
                        },
                      }
                    : entry,
                ),
              );
            })().catch((cause) => {
              if (reserved) reattachReceipts.current.abandon(message.requestId);
              void sendToolsHub(message.destination, {
                kind: "transfer-error",
                requestId: message.requestId,
                error: toolsTransferError(cause),
              }).catch(() => {});
            });
          }
        });
        if (disposed) unlisten();
        else {
          release = unlisten;
          publishRef.current();
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      release?.();
    };
  }, []);
  useEffect(() => {
    // Status/title updates are not navigation. Focus inside the hub cannot emit here.
    if (
      !sameToolsSession(lastSelection.current, activeConversation) &&
      lastSelection.current !== activeConversation
    ) {
      if (!nativeToolsAvailable() || document.hasFocus())
        selectionRevision.current = Math.max(Date.now(), selectionRevision.current + 1);
      lastSelection.current = activeConversation;
    }
    publishRef.current();
  }, [activeConversation, panes]);
  useEffect(() => {
    if (!accessibleSessions) return;
    setPanes((previous) => {
      const next = previous.filter((pane) =>
        accessibleSessions.some((session) => sameToolsSession(session, pane)),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [accessibleSessions]);
  const visiblePanes = panes.filter(
    (pane) =>
      !pane.detached &&
      (activeConversation === undefined || sameToolsSession(pane, activeConversation)),
  );
  const close = (id: string) => setPanes((previous) => previous.filter((pane) => pane.id !== id));
  return (
    <div
      className="tools-workspace font-sans"
      data-placement={placement}
      data-open={!!visiblePanes.length || !!roomPane}
    >
      <div className="tools-workspace-main">{children}</div>
      {panes.length || roomPane ? (
        <div
          className="tools-workspace-dock"
          data-visible={!!visiblePanes.length || !!roomPane}
          aria-hidden={!visiblePanes.length && !roomPane}
        >
          <ToolDock
            placement={placement}
            layoutKey={presentationSession ? toolsSessionKey(presentationSession) : "none"}
          >
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="tools-workspace-panes">
              {roomPane && (
                <section
                  {...surfaceAttributes(
                    { frame: "stroke", edge: "block-end" },
                    "tools-workspace-pane",
                  )}
                  key={roomPane.id}
                >
                  <PaneHeader
                    as="header"
                    {...surfaceAttributes(
                      { variant: "workspace-panel" },
                      "tools-workspace-toolbar",
                    )}
                    icon={<Wrench className="icon-sm" aria-hidden />}
                    titleAs="div"
                    title={t("Browser")}
                    meta={roomPane.context.title}
                    actions={
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        label={t("Close panel")}
                        onClick={() => {
                          roomPaneRef.current = undefined;
                          roomMounted.current = undefined;
                          setRoomPane(undefined);
                        }}
                      >
                        <X className="icon-sm" aria-hidden />
                      </Button>
                    }
                  />
                  <BrowserPanel
                    cwd={roomPane.context.cwd}
                    roomSubject={roomPane.context}
                    onMounted={() => {
                      roomMounted.current = roomPane.id;
                    }}
                    annotationsAllowed={false}
                  />
                </section>
              )}
              {panes.map((pane) => (
                <section
                  {...surfaceAttributes(
                    { frame: "stroke", edge: "block-end" },
                    "tools-workspace-pane",
                  )}
                  key={pane.id}
                  data-visible={visiblePanes.includes(pane)}
                  aria-hidden={!visiblePanes.includes(pane)}
                >
                  <PaneHeader
                    as="header"
                    bordered={false}
                    {...surfaceAttributes(
                      { variant: "workspace-panel" },
                      "tools-workspace-toolbar",
                    )}
                    icon={<Wrench className="icon-sm" aria-hidden />}
                    titleAs="div"
                    title={pane.onlyTab ? t("Logs") : t("Conversation tools")}
                    meta={
                      <Tooltip label={pane.title} details={[pane.cwd]}>
                        <span>{pane.title}</span>
                      </Tooltip>
                    }
                    actions={
                      <>
                        <PlacementButton
                          value={placement}
                          onChange={(next) => setSessionPlacement(pane, next)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          type="button"
                          className="tools-workspace-icon"
                          label={t("Open in new window")}
                          loading={detaching === pane.id}
                          disabled={detaching === pane.id}
                          onClick={async () => {
                            if (transfers.current.has(pane.id)) return;
                            transfers.current.add(pane.id);
                            setDetaching(pane.id);
                            setError("");
                            try {
                              const current = views.current.get(pane.id);
                              await openHostToolsWindow(
                                {
                                  ...pane,
                                  initialTab: current?.tab ?? pane.initialTab,
                                  initialMachine: current?.machine ?? pane.initialMachine,
                                },
                                pane.onlyTab,
                              );
                              setPanes((previous) =>
                                previous.map((entry) =>
                                  entry.id === pane.id ? { ...entry, detached: true } : entry,
                                ),
                              );
                            } catch (cause) {
                              setError(toolsTransferError(cause));
                            } finally {
                              transfers.current.delete(pane.id);
                              setDetaching(undefined);
                            }
                          }}
                        >
                          <ExternalLink className="icon-sm" aria-hidden />
                        </Button>
                        {visiblePanes.length > 1 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            type="button"
                            className="tools-workspace-icon"
                            label={t("Close panels")}
                            onClick={() =>
                              setPanes((previous) =>
                                previous.filter((entry) => !visiblePanes.includes(entry)),
                              )
                            }
                          >
                            <CircleX className="icon-sm" aria-hidden />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          type="button"
                          className="tools-workspace-icon"
                          label={t("Close panel")}
                          onClick={() => close(pane.id)}
                        >
                          <X className="icon-sm" aria-hidden />
                        </Button>
                      </>
                    }
                  />
                  <SessionHostTools
                    {...pane}
                    active={visiblePanes.includes(pane)}
                    hidePresentation
                    hideHeading
                    onMounted={(view) => {
                      mountedPanes.current.add(pane.id);
                      mountedDomains.current.add(JSON.stringify([pane.id, view.tab, view.machine]));
                      const pending = pendingReattach.current.filter(
                        (transfer) =>
                          sameToolsSession(transfer.session, pane) &&
                          (transfer.session.initialTab ??
                            pane.onlyTab ??
                            pane.initialTab ??
                            "devices") === view.tab &&
                          (transfer.session.initialMachine ?? pane.initialMachine ?? "project") ===
                            view.machine,
                      );
                      pendingReattach.current = pendingReattach.current.filter(
                        (transfer) => !pending.includes(transfer),
                      );
                      for (const transfer of pending) {
                        const ack: import("./toolsHubTransport").ToolsHubMessage = {
                          kind: "reattached",
                          requestId: transfer.requestId,
                          session: {
                            cwd: transfer.session.cwd,
                            sessionId: transfer.session.sessionId,
                            title: transfer.session.title,
                          },
                          sourceWindow: sourceWindow.current,
                          tab: view.tab,
                          machine: view.machine,
                        };
                        reattachReceipts.current.complete(transfer.requestId, ack);
                        void sendToolsHub(transfer.destination, ack).catch(() => {});
                      }
                    }}
                    onViewChange={(view) => {
                      views.current.set(pane.id, view);
                      publishRef.current();
                    }}
                  />
                </section>
              ))}
            </div>
          </ToolDock>
        </div>
      ) : null}
    </div>
  );
}
