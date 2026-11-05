import { t } from "../../shared/i18n/technical";
import type { ToolsWorkspaceTransfer } from "./toolsTransferLedger";
import { listenWindowAsync } from "../../platform/tauri/listenWindow";
import { sameToolsSession, toolsSessionMetadata } from "./toolsSessionRegistry";
import type { ToolsTab } from "./toolsUiControl";
import type { ToolsRegistration, ToolsSession, ToolsSourceSnapshot } from "./toolsSessionRegistry";

export const TOOLS_HUB_LABEL = "tools-hub";
export const TOOLS_HUB_EVENT = "bycoda:tools-hub";
export type ToolsPresentation = {
  version: 1;
  revision: number;
  hubWindow: string;
  session: ToolsSession;
  tab: ToolsTab;
  machine: string;
  mounted: boolean;
  visible?: boolean;
};
export type ToolsHubMessage =
  | { kind: "presentation-query"; requestId: string; sourceWindow: string; session: ToolsSession }
  | { kind: "presentation"; requestId: string; presentation: ToolsPresentation }
  | { kind: "request"; destination: string }
  | { kind: "snapshot"; snapshot: ToolsSourceSnapshot }
  | {
      kind: "transfer";
      requestId: string;
      sourceWindow: string;
      pane: ToolsRegistration;
      drafts?: ToolsWorkspaceTransfer;
    }
  | { kind: "ready"; requestId: string; hubWindow: string }
  | { kind: "transfer-error"; requestId: string; error: string }
  | {
      kind: "mounted";
      requestId: string;
      paneId: string;
      hubWindow: string;
      session: ToolsSession;
      tab: ToolsTab;
      machine: string;
    }
  | {
      kind: "reattach";
      requestId: string;
      destination: string;
      session: ToolsSession;
      drafts?: ToolsWorkspaceTransfer;
    }
  | {
      kind: "reattached";
      requestId: string;
      session: ToolsSession;
      sourceWindow: string;
      tab: ToolsTab;
      machine: string;
    };

export function nativeToolsAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function sendToolsHub(destination: string, message: ToolsHubMessage) {
  if (!destination) throw new Error(t("Conversation tools owner unavailable."));
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo(destination, TOOLS_HUB_EVENT, message);
}

export async function subscribeToolsHub(receive: (message: ToolsHubMessage) => void) {
  return listenWindowAsync<ToolsHubMessage>(TOOLS_HUB_EVENT, (event) => receive(event.payload));
}

export async function requestToolsSources() {
  const { getAllWebviewWindows, getCurrentWebviewWindow } =
    await import("@tauri-apps/api/webviewWindow");
  const destination = getCurrentWebviewWindow().label;
  const windows = await getAllWebviewWindows();
  await Promise.all(
    windows
      .filter(
        (view) =>
          view.label !== destination &&
          !view.label.startsWith("tools-") &&
          !view.label.startsWith("popup-"),
      )
      .map((view) => sendToolsHub(view.label, { kind: "request", destination })),
  );
  return new Set(windows.map((view) => view.label));
}

/** Register acknowledgement before sending; creation is not a mounted presentation. */
export async function waitToolsAcknowledgement(
  requestId: string,
  kind: "ready" | "mounted" | "reattached",
  send: () => Promise<void>,
  expected?: () => { window?: string; session?: ToolsSession; tab?: ToolsTab; machine?: string },
) {
  let finished = false;
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(t("Tools transfer not acknowledged. Original workspace retained."))),
        10000,
      );
      void subscribeToolsHub((message) => {
        if (message.kind === kind && message.requestId === requestId) {
          const target = expected?.();
          const window = message.kind === "reattached" ? message.sourceWindow : message.hubWindow;
          if (target?.window && target.window !== window) return;
          if (message.kind !== "ready") {
            if (target?.session && !sameToolsSession(target.session, message.session)) return;
            if (
              (target?.tab && target.tab !== message.tab) ||
              (target?.machine && target.machine !== message.machine)
            )
              return;
          }
          resolve();
        } else if (message.kind === "transfer-error" && message.requestId === requestId)
          reject(new Error(message.error));
      })
        .then((unlisten) => {
          if (finished) {
            unlisten();
            return;
          }
          release = unlisten;
          return send();
        })
        .catch(reject);
    });
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    release?.();
  }
}

/** Fresh, bounded, targeted readback. Missing reply means unknown, never foreground success. */
export async function queryToolsPresentation(
  session: ToolsSession,
): Promise<ToolsPresentation | undefined> {
  if (!nativeToolsAvailable()) return;
  const { getAllWebviewWindows, getCurrentWebviewWindow } =
    await import("@tauri-apps/api/webviewWindow");
  const sourceWindow = getCurrentWebviewWindow().label;
  const hubs = (await getAllWebviewWindows()).filter((view) => view.label.startsWith("tools-"));
  if (!hubs.length) return;
  const requestId = crypto.randomUUID();
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  try {
    return await new Promise<ToolsPresentation | undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 1500);
      void subscribeToolsHub((message) => {
        if (
          message.kind === "presentation" &&
          message.requestId === requestId &&
          message.presentation.version === 1 &&
          hubs.some((view) => view.label === message.presentation.hubWindow) &&
          sameToolsSession(message.presentation.session, session) &&
          message.presentation.session.onlyTab === session.onlyTab
        )
          resolve(message.presentation);
      })
        .then(async (unlisten) => {
          if (finished) {
            unlisten();
            return;
          }
          release = unlisten;
          await Promise.all(
            hubs.map((hub) =>
              sendToolsHub(hub.label, {
                kind: "presentation-query",
                requestId,
                sourceWindow,
                session: toolsSessionMetadata(session),
              }),
            ),
          );
        })
        .catch(() => resolve(undefined));
    });
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    release?.();
  }
}

export async function verifyToolsComposerOwner(session: ToolsSession): Promise<boolean> {
  const [{ invoke }, { remoteSessionOwnershipKey }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("../../app/model/sessionWindowOwnership"),
  ]);
  const sessionId = session.cwd.startsWith("remote://")
    ? remoteSessionOwnershipKey(session.cwd, session.sessionId)
    : (session.composerSessionId ?? session.sessionId);
  return invoke<boolean>("verify_session_window_owner", { sessionId });
}
