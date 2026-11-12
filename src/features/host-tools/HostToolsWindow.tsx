import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
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
import { Badge, type BadgeTone } from "../../shared/ui/Badge";
import { retainToolsWindowGeometry } from "../../app/model/hostToolsWindowGeometry";
import { restoreBrowserDraftTransfer } from "./browserDraftTransfer";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HostToolsWindow as HostToolsWindowProps } from "../../app/model/hostToolsWindow";
import { SessionHostTools } from "./SessionHostTools";
import { Alert } from "../../shared/ui/Alert";
import { Button } from "../../shared/ui/Button";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { Folder, Link2, Pin, PanelRightClose, Wrench } from "../../shared/ui/icons";
import { t, useLocale } from "../../shared/i18n/technical";
import {
  mergeToolsSource,
  sameToolsSession,
  toolsProjectName,
  toolsSessionKey,
  toolsSessionMetadata,
  toolsSessionOptions,
  type ToolsRegistration,
  type ToolsSession,
  type ToolsSourceSnapshot,
} from "./toolsSessionRegistry";
import {
  nativeToolsAvailable,
  requestToolsSources,
  sendToolsHub,
  subscribeToolsHub,
  waitToolsAcknowledgement,
  type ToolsHubMessage,
} from "./toolsHubTransport";
import "./tools-workspace.css";

const STATUS_TONES: Record<string, BadgeTone> = {
  Working: "info",
  Interrupted: "warning",
  Failed: "danger",
  Idle: "neutral",
};
function sessionStatusBadge(status: string | undefined) {
  return status ? (
    <Badge size="xs" tone={STATUS_TONES[status] ?? "neutral"}>
      {t(status)}
    </Badge>
  ) : undefined;
}
const paneKey = (pane: ToolsSession) => `${toolsSessionKey(pane)}:${pane.onlyTab ?? "all"}`;
const FOLLOW_KEY = "bycoda.tools-hub.follow.v1";
function initialFollow() {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Selection changes presentation only; each panel retains its originating composer. */
export default function HostToolsWindow(props: HostToolsWindowProps) {
  useLocale();
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    if (props.browserDraft)
      restoreBrowserDraftTransfer(
        props.cwd,
        props.sessionId,
        props.initialMachine ?? "project",
        props.browserDraft,
      );
  }
  const [sources, setSources] = useState<ReadonlyMap<string, ToolsSourceSnapshot>>(new Map());
  const [selected, setSelected] = useState<ToolsSession | null>(props);
  const [follow, setFollow] = useState(initialFollow);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const followRef = useRef(follow);
  followRef.current = follow;
  const latestSelection = useRef<{ revision: number; session: ToolsSession | null }>({
    revision: 0,
    session: props,
  });
  const [retained, setRetained] = useState<ToolsRegistration[]>([
    { ...props, initialUrl: undefined, id: toolsSessionKey(props), detached: true },
  ]);
  const retainedRef = useRef(retained);
  retainedRef.current = retained;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [availableWindows, setAvailableWindows] = useState<ReadonlySet<string> | null>(null);
  const windowLabel = useRef("");
  const transferReceipts = useRef(new ToolsTransferLedger<ToolsHubMessage>());
  const pendingReturns = useRef(
    new Map<
      string,
      {
        requestId: string;
        fingerprint: string;
        editFingerprint: string;
        session: ToolsSession;
        drafts: ToolsWorkspaceTransfer;
      }
    >(),
  );
  const acknowledgements = useRef(new Map<string, { requestId: string; sourceWindow: string }>());
  const mounted = useRef(new Set<string>());
  const mountedDomains = useRef(new Set<string>());
  const views = useRef(
    new Map<string, { tab: import("./toolsUiControl").ToolsTab; machine: string }>(),
  );
  const sourceRevisions = useRef(new Map<string, { epoch: number; revision: number }>());
  useEffect(() => {
    const keys = new Set(retained.map(paneKey));
    for (const key of mounted.current) if (!keys.has(key)) mounted.current.delete(key);
    for (const key of mountedDomains.current)
      if (!keys.has(JSON.parse(key)[0])) mountedDomains.current.delete(key);
  }, [retained]);
  const [ready, setReady] = useState(0);
  const presentationRevision = useRef(0);
  const receive = (message: ToolsHubMessage) => {
    if (message.kind === "presentation-query") {
      const pane = retainedRef.current.find(
        (entry) =>
          sameToolsSession(entry, message.session) &&
          entry.onlyTab === message.session.onlyTab &&
          entry.composerWindow === message.sourceWindow,
      );
      if (!pane) return;
      const key = paneKey(pane);
      const view = views.current.get(key);
      const isSelected =
        sameToolsSession(selectedRef.current, pane) &&
        selectedRef.current?.onlyTab === pane.onlyTab;
      void import("@tauri-apps/api/webviewWindow")
        .then(async ({ getCurrentWebviewWindow }) => {
          const window = getCurrentWebviewWindow();
          const visible = await window.isVisible().catch(() => undefined);
          await sendToolsHub(message.sourceWindow, {
            kind: "presentation",
            requestId: message.requestId,
            presentation: {
              version: 1,
              revision: ++presentationRevision.current,
              hubWindow: window.label,
              session: toolsSessionMetadata(pane),
              tab: view?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
              machine: view?.machine ?? pane.initialMachine ?? "project",
              mounted: mountedDomains.current.has(
                JSON.stringify([
                  key,
                  view?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
                  view?.machine ?? pane.initialMachine ?? "project",
                ]),
              ),
              visible: !isSelected ? false : visible,
            },
          });
        })
        .catch(() => {});
    } else if (message.kind === "snapshot") {
      const next = message.snapshot;
      const previous = sourceRevisions.current.get(next.sourceWindow);
      const epoch = next.sourceEpoch ?? 0;
      if (
        previous &&
        (epoch < previous.epoch || (epoch === previous.epoch && next.revision <= previous.revision))
      )
        return;
      sourceRevisions.current.set(next.sourceWindow, { epoch, revision: next.revision });
      setSources((previous) => mergeToolsSource(previous, next));
      if (next.selectionRevision > latestSelection.current.revision) {
        latestSelection.current = { revision: next.selectionRevision, session: next.active };
        if (followRef.current) setSelected(next.active);
      }
      setSelected((previous) =>
        previous &&
        retainedRef.current.some(
          (pane) => sameToolsSession(pane, previous) && pane.composerWindow === next.sourceWindow,
        ) &&
        !next.panes.some((pane) => sameToolsSession(pane, previous))
          ? null
          : previous,
      );
      setRetained((previous) => {
        const nextPanes = next.panes.map((pane) => ({
          ...toolsSessionMetadata(pane),
          id: pane.id,
          detached: pane.detached,
          viewRequest: pane.viewRequest,
          initialUrl: undefined,
          composerWindow: next.sourceWindow,
        }));
        return [
          ...previous.filter(
            (pane) =>
              pane.composerWindow !== next.sourceWindow &&
              !nextPanes.some((entry) => paneKey(entry) === paneKey(pane)),
          ),
          ...nextPanes,
        ];
      });
    } else if (message.kind === "transfer") {
      let reserved = false;
      void (async () => {
        const fingerprint = await toolsTransferFingerprint(
          toolsTransferContent(message.pane, message.drafts),
        );
        const scope = toolsTransferScope(message.pane);
        const receipt = transferReceipts.current.find(
          message.requestId,
          message.sourceWindow,
          scope,
          fingerprint,
        );
        if (receipt) {
          if (receipt.ack) await sendToolsHub(message.sourceWindow, receipt.ack);
          return;
        }
        transferReceipts.current.begin(message.requestId, message.sourceWindow, scope, fingerprint);
        reserved = true;
        if (message.drafts) restoreWorkspaceTransfer(message.pane, message.drafts);
        if (message.pane.browserDraft)
          restoreBrowserDraftTransfer(
            message.pane.cwd,
            message.pane.sessionId,
            message.pane.initialMachine ?? "project",
            message.pane.browserDraft,
          );
        const pane = {
          ...toolsSessionMetadata(message.pane),
          id: message.pane.id,
          detached: message.pane.detached,
          viewRequest: message.pane.viewRequest,
          initialUrl: undefined,
          composerWindow: message.sourceWindow,
        };
        acknowledgements.current.set(paneKey(pane), {
          requestId: message.requestId,
          sourceWindow: message.sourceWindow,
        });
        setRetained((previous) => [
          ...previous.filter((entry) => paneKey(entry) !== paneKey(pane)),
          pane,
        ]);
        setSelected(pane);
        setReady((value) => value + 1);
      })().catch((cause) => {
        if (reserved) transferReceipts.current.abandon(message.requestId);
        setError(toolsTransferError(cause));
        void sendToolsHub(message.sourceWindow, {
          kind: "transfer-error",
          requestId: message.requestId,
          error: toolsTransferError(cause),
        }).catch(() => {});
      });
    }
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    if (!nativeToolsAvailable()) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void retainToolsWindowGeometry()
      .then((cleanup) => {
        if (disposed) cleanup();
        else release = cleanup;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      release?.();
    };
  }, []);
  useEffect(() => {
    if (!nativeToolsAvailable()) return;
    let stopped = false;
    let release: (() => void) | undefined;
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        windowLabel.current = getCurrentWebviewWindow().label;
        const unlisten = await subscribeToolsHub((message) => receiveRef.current(message));
        if (stopped) {
          unlisten();
          return;
        }
        const view = getCurrentWebviewWindow();
        const closeRelease = await view.onCloseRequested((event) => {
          event.preventDefault();
          void view.hide().catch((cause) => setError(toolsTransferError(cause)));
        });
        if (stopped) {
          closeRelease();
          unlisten();
          return;
        }
        release = () => {
          closeRelease();
          unlisten();
        };
        if (props.transferRequestId && props.composerWindow)
          await sendToolsHub(props.composerWindow, {
            kind: "ready",
            requestId: props.transferRequestId,
            hubWindow: windowLabel.current,
          });
        setAvailableWindows(await requestToolsSources());
      })
      .catch((cause) => {
        if (!stopped) setError(toolsTransferError(cause));
      });
    return () => {
      stopped = true;
      release?.();
    };
  }, []);
  useEffect(() => {
    if (!nativeToolsAvailable()) return;
    let disposed = false;
    const refresh = () => {
      void requestToolsSources()
        .then((windows) => {
          if (disposed) return;
          setAvailableWindows(windows);
          setSources((previous) => new Map([...previous].filter(([owner]) => windows.has(owner))));
        })
        .catch((cause) => {
          if (!disposed) setError(toolsTransferError(cause));
        });
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  // Mount acknowledgement follows actual domain-view readiness, never window creation.
  const acknowledge = (key: string) => {
    mounted.current.add(key);
    const transfer = acknowledgements.current.get(key);
    if (!transfer) return;
    const pane = retainedRef.current.find((entry) => paneKey(entry) === key);
    if (
      !pane ||
      !mountedDomains.current.has(
        JSON.stringify([
          key,
          pane.viewRequest?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
          pane.viewRequest?.machine ?? pane.initialMachine ?? "project",
        ]),
      )
    )
      return;
    acknowledgements.current.delete(key);
    const ack: ToolsHubMessage = {
      kind: "mounted",
      requestId: transfer.requestId,
      paneId: key,
      hubWindow: windowLabel.current,
      session: { cwd: pane.cwd, sessionId: pane.sessionId, title: pane.title },
      tab: pane.viewRequest?.tab ?? pane.onlyTab ?? pane.initialTab ?? "devices",
      machine: pane.viewRequest?.machine ?? pane.initialMachine ?? "project",
    };
    transferReceipts.current.complete(transfer.requestId, ack);
    void sendToolsHub(transfer.sourceWindow, ack).catch((cause) =>
      setError(toolsTransferError(cause)),
    );
  };
  useEffect(() => {
    for (const key of mounted.current) acknowledge(key);
  }, [ready]);
  const options = useMemo(() => toolsSessionOptions(sources, selected), [sources, selected]);
  const current = selected
    ? {
        ...(options.find((session) => sameToolsSession(session, selected)) ?? selected),
        onlyTab: selected.onlyTab,
      }
    : null;
  const retainedPane = current
    ? retained.find((pane) => sameToolsSession(pane, current) && pane.onlyTab === current.onlyTab)
    : undefined;
  const ownerUnavailable =
    !!retainedPane?.composerWindow &&
    !!availableWindows &&
    !availableWindows.has(retainedPane.composerWindow);
  const currentPane = ownerUnavailable ? undefined : retainedPane;
  const toggleFollow = () => {
    const next = !follow;
    setFollow(next);
    try {
      localStorage.setItem(FOLLOW_KEY, String(next));
    } catch {
      /* Session choice still applies. */
    }
    if (next) setSelected(latestSelection.current.session);
  };
  const reattach = async () => {
    if (!currentPane?.composerWindow || pending) return;
    setPending(true);
    setError("");
    try {
      const session: ToolsSession = {
        ...currentPane,
        browserDraft: undefined,
        initialTab: views.current.get(paneKey(currentPane))?.tab ?? currentPane.initialTab,
        initialMachine:
          views.current.get(paneKey(currentPane))?.machine ?? currentPane.initialMachine,
      };
      const drafts = readWorkspaceTransfer(session);
      const editFingerprint = await toolsTransferFingerprint(toolsTransferEdits(session, drafts));
      const previous = pendingReturns.current.get(paneKey(currentPane));
      if (previous && previous.editFingerprint !== editFingerprint)
        throw new Error(
          t("Tools changed after an uncertain transfer. Both workspaces retained for review."),
        );
      const operation = previous ?? {
        requestId: crypto.randomUUID(),
        editFingerprint,
        fingerprint: await toolsTransferFingerprint(toolsTransferContent(session, drafts)),
        session: structuredClone(session),
        drafts: structuredClone(drafts),
      };
      pendingReturns.current.set(paneKey(currentPane), operation);
      await waitToolsAcknowledgement(
        operation.requestId,
        "reattached",
        () =>
          sendToolsHub(currentPane.composerWindow!, {
            kind: "reattach",
            requestId: operation.requestId,
            destination: windowLabel.current,
            session: operation.session,
            drafts: operation.drafts,
          }),
        () => ({
          window: currentPane.composerWindow,
          session: operation.session,
          tab: operation.session.onlyTab ?? operation.session.initialTab ?? "devices",
          machine: operation.session.initialMachine ?? "project",
        }),
      );
      pendingReturns.current.delete(paneKey(currentPane));
      const [{ focusSessionWindow }, { remoteSessionOwnershipKey }, { getCurrentWebviewWindow }] =
        await Promise.all([
          import("../../app/model/windowNavigation"),
          import("../../app/model/sessionWindowOwnership"),
          import("@tauri-apps/api/webviewWindow"),
        ]);
      const ownershipId = currentPane.cwd.startsWith("remote://")
        ? remoteSessionOwnershipKey(currentPane.cwd, currentPane.sessionId)
        : (currentPane.composerSessionId ?? currentPane.sessionId);
      await focusSessionWindow(currentPane.composerWindow, ownershipId);
      await getCurrentWebviewWindow().hide();
      setRetained((previous) => previous.filter((pane) => !sameToolsSession(pane, currentPane)));
      setSelected(null);
    } catch (cause) {
      setError(toolsTransferError(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <Text
      as="div"
      size="inherit"
      tone="primary"
      {...surfaceAttributes(
        { variant: "canvas-surface" },
        "host-tools-window body-glass tools-hub font-sans",
      )}
    >
      <header {...surfaceAttributes({ frame: "stroke", edge: "block-end" }, "tools-hub-header")}>
        <Wrench className="icon-sm" aria-hidden />
        <Text size="caption" tone="secondary" leading="inherit" className="tools-hub-title">
          {t("Conversation tools")}
        </Text>
        <div className="tools-hub-identity">
          <SearchableSelect
            hideLabel
            label={t("Tool conversations")}
            variant="transparent"
            value={current ? toolsSessionKey(current) : ""}
            placeholder={t("Conversation tools")}
            searchable
            align="end"
            options={options.map((session) => ({
              value: toolsSessionKey(session),
              label: `${toolsProjectName(session)} · ${session.title}`,
              description: session.cwd,
              disabled:
                !!session.composerWindow &&
                !!availableWindows &&
                !availableWindows.has(session.composerWindow),
              meta: sessionStatusBadge(session.status),
              icon: <Folder className="icon-sm" aria-hidden />,
            }))}
            tooltip={
              current
                ? {
                    label: current.title,
                    details: [
                      toolsProjectName(current),
                      current.cwd,
                      current.worktreeCwd,
                      current.branch,
                      current.model,
                      sessionStatusBadge(current.status),
                    ].filter((value) => value !== undefined),
                    wide: true,
                  }
                : undefined
            }
            onChange={(key) => {
              const session = options.find((entry) => toolsSessionKey(entry) === key);
              if (session) setSelected(session);
            }}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-pressed={follow}
          selected={follow}
          tone={follow ? "accent" : "neutral"}
          label={t(follow ? "Follow active conversation" : "Keep this conversation")}
          onClick={toggleFollow}
        >
          {follow ? (
            <Link2 className="icon-sm" aria-hidden />
          ) : (
            <Pin className="icon-sm" aria-hidden />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Return to conversation")}
          disabled={!currentPane?.composerWindow || pending}
          loading={pending}
          onClick={() => {
            void reattach().catch((cause) => setError(toolsTransferError(cause)));
          }}
        >
          <PanelRightClose className="icon-sm" aria-hidden />
        </Button>
      </header>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="tools-hub-body">
        {retained.map((pane) => {
          const active = !!currentPane && paneKey(pane) === paneKey(currentPane);
          return (
            <section key={paneKey(pane)} className="tools-hub-pane" hidden={!active}>
              <SessionHostTools
                {...pane}
                active={active}
                hideHeading
                hidePresentation
                onMounted={(view) => {
                  mountedDomains.current.add(
                    JSON.stringify([paneKey(pane), view.tab, view.machine]),
                  );
                  acknowledge(paneKey(pane));
                }}
                onViewChange={(view) => {
                  views.current.set(paneKey(pane), view);
                }}
              />
            </section>
          );
        })}
        {!currentPane ? (
          <Text
            size="caption"
            tone="secondary"
            leading="inherit"
            as="div"
            className="tools-hub-empty"
          >
            {current ? (
              <Text size="inherit" tone="primary" weight="medium" leading="inherit" as="strong">
                {toolsProjectName(current)} · {current.title}
              </Text>
            ) : null}
            <span>
              {t(
                ownerUnavailable
                  ? "Conversation tools owner unavailable"
                  : "No tools in this conversation",
              )}
            </span>
          </Text>
        ) : null}
      </div>
    </Text>
  );
}
