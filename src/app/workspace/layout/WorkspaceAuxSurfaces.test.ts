// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const seen = vi.hoisted(() => ({
  embedded: false,
  targeted: false,
  globalQuote: undefined as boolean | undefined,
  sshTarget: undefined as string | undefined,
}));
vi.mock("./LiveSearchView", () => ({ LiveSearchView: () => null }));
vi.mock("../../../features/sessions/ui/SessionPane", () => ({
  SessionPane: (props: {
    embedded: boolean;
    receiveTargetedQuotes: boolean;
    addToChatTarget?: boolean;
    sshActivityServerId?: string;
    session: { id: string };
    onSubmit: (id: string, text: string, files: unknown[]) => void;
    onStop: (id: string) => void;
  }) => {
    seen.embedded = props.embedded;
    seen.targeted = props.receiveTargetedQuotes;
    seen.globalQuote = props.addToChatTarget;
    seen.sshTarget = props.sshActivityServerId;
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => props.onSubmit(props.session.id, "Manage this account", []) },
        "Send",
      ),
      createElement("button", { onClick: () => props.onStop(props.session.id) }, "Stop"),
    );
  },
}));
import { WorkspaceAuxSurfaces } from "./WorkspaceAuxSurfaces";

it("ports the actual Social session pane with existing submit and stop owners", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const dock = document.createElement("div");
  document.body.append(container, dock);
  const root = createRoot(container);
  const onSubmit = vi.fn();
  const onStop = vi.fn();
  try {
    const props = {
      sessions: [{ id: "social-session" }],
      socialSessionIds: ["social-session"],
      socialSessionPortal: { sessionId: "social-session", host: dock },
      socialVisible: true,
      inboxViewOpen: false,
      inboxAskPortal: null,
      sessionPaneProps: { onSubmit, onStop },
      composerFocused: true,
    } as unknown as ComponentProps<typeof WorkspaceAuxSurfaces>;
    await act(async () => root.render(createElement(WorkspaceAuxSurfaces, props)));
    expect(seen.embedded).toBe(true);
    await act(async () => dock.querySelectorAll("button")[0]?.click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("social-session", "Manage this account", []);
    await act(async () => dock.querySelectorAll("button")[1]?.click());
    expect(onStop).toHaveBeenCalledExactlyOnceWith("social-session");
    await act(async () =>
      root.render(createElement(WorkspaceAuxSurfaces, { ...props, socialSessionPortal: null })),
    );
    expect(dock.querySelector("button")).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
    const workspaceHost = document.createElement("div");
    container.append(workspaceHost);
    const sendButton = container.querySelector("button");
    await act(async () =>
      root.render(
        createElement(WorkspaceAuxSurfaces, {
          ...props,
          socialVisible: false,
          socialWorkspaceTargets: {
            "social-session": {
              sessionId: "social-session",
              host: workspaceHost,
              visible: true,
              focused: true,
              inSplit: false,
            },
          },
        }),
      ),
    );
    expect(workspaceHost.querySelector("button")).toBe(sendButton);
    expect(document.querySelectorAll("button")).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dock.remove();
    vi.unstubAllGlobals();
  }
});

it("submits from the server's conversation and listens for selections only while visible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const dock = document.createElement("div");
  document.body.append(container, dock);
  const root = createRoot(container);
  const onSubmit = vi.fn();
  const props = {
    sessions: [{ id: "ssh-conversation" }],
    serverSessionIds: ["ssh-conversation"],
    serverSessionPortal: { sessionId: "ssh-conversation", host: dock, serverId: "saved-server" },
    serversVisible: true,
    sessionPaneProps: { onSubmit },
  } as unknown as ComponentProps<typeof WorkspaceAuxSurfaces>;
  try {
    await act(async () => root.render(createElement(WorkspaceAuxSurfaces, props)));
    expect(seen).toMatchObject({
      embedded: false,
      targeted: true,
      globalQuote: false,
      sshTarget: "saved-server",
    });
    await act(async () => dock.querySelector("button")?.click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("ssh-conversation", "Manage this account", []);
    await act(async () =>
      root.render(createElement(WorkspaceAuxSurfaces, { ...props, serversVisible: false })),
    );
    expect(dock.querySelector("button")).toBeNull();
    expect(seen.targeted).toBe(false);
    expect(seen.sshTarget).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dock.remove();
    vi.unstubAllGlobals();
  }
});
