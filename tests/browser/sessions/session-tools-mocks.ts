import type { ToolsHubMessage } from "../../../src/features/host-tools/toolsHubTransport";
const channel = new BroadcastChannel("session-tools-fixture");
const role = new URLSearchParams(location.search).get("role");
export const label = role === "hub" ? "tools-hub" : "main";
export const TOOLS_HUB_LABEL = "tools-hub";
export const TOOLS_HUB_EVENT = "bycoda:tools-hub";
export const nativeToolsAvailable = () => true;
const subscribers = new Set<(message: ToolsHubMessage) => void>();
channel.onmessage = (event: MessageEvent<{ destination: string; message: ToolsHubMessage }>) => {
  if (event.data.destination === label)
    subscribers.forEach((receive) => receive(event.data.message));
};
export async function sendToolsHub(destination: string, message: ToolsHubMessage) {
  channel.postMessage({ destination, message });
}
export async function subscribeToolsHub(receive: (message: ToolsHubMessage) => void) {
  subscribers.add(receive);
  return () => subscribers.delete(receive);
}
export async function requestToolsSources() {
  await sendToolsHub("main", { kind: "request", destination: label });
  return new Set(["main", "tools-hub"]);
}
export async function waitToolsAcknowledgement(
  requestId: string,
  kind: "mounted" | "reattached",
  send: () => Promise<void>,
) {
  let release = () => {};
  let timer: ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture transfer timed out")), 10000);
      void subscribeToolsHub((message) => {
        if (message.kind === kind && message.requestId === requestId) resolve();
      })
        .then((cleanup) => {
          release = cleanup;
          return send();
        })
        .catch(reject);
    });
  } finally {
    clearTimeout(timer!);
    release();
  }
}
const currentWindow = {
  label,
  onCloseRequested: async () => () => {},
  hide: async () => {
    Object.assign(window, { sessionToolsHidden: true });
  },
  isVisible: async () => true,
  show: async () => {},
  setFocus: async () => {},
};
export const getCurrentWebviewWindow = () => currentWindow;
export const getAllWebviewWindows = async () => [
  { ...currentWindow, label: "main" },
  { ...currentWindow, label: "tools-hub" },
];
export class WebviewWindow {
  static async getByLabel(target: string) {
    return { ...currentWindow, label: target };
  }
}
export const retainToolsWindowGeometry = async () => () => {};

export const queryToolsPresentation = async () => undefined;

export async function invoke<T>(command: string): Promise<T> {
  if (command === "verify_session_window_owner") return true as T;
  throw new Error(`Unsupported fixture native command: ${command}`);
}
export async function focusSessionWindow() {
  /* Native owner routing is mocked only in this fixture. */
}

export const verifyToolsComposerOwner = async () => true;
