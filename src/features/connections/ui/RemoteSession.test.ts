// @vitest-environment happy-dom
import { act, createElement, useCallback, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SessionPane, type SessionPaneProps } from "../../sessions/ui/SessionPane";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { PaneTree } from "../../workspace/ui/PaneTree";
import { leaf } from "../../workspace/model/layout";
import { TitleBar } from "../../../app/shell/TitleBar";
import { remoteSessionState } from "../model/remoteSessionState";
import type { Block, Session } from "../../sessions/model/session";
import { rewindConversationBeforeMessage } from "../../sessions/model/conversationRewind";
import { SHELL_FOLLOW_UP_PROMPT } from "../../sessions/model/shellRun";
import type { AgentModel } from "../../sessions/model/models";
import {
  resetHarnessModelOverlays,
  resetDisabledModels,
  saveModelEnabled,
} from "../../sessions/model/models";
import { rememberRemoteProject, remoteProjectFor } from "../model/remoteProjects";
import {
  RemoteSession,
  type RemoteSessionOverrides,
  preloadRemoteSession,
  resetRemoteSessionCachesForTests,
} from "./RemoteSession";
import {
  pendingRemoteCommand,
  rememberRemoteSession,
  remoteSessionFor,
  resetRemoteSessionReadsForTests,
} from "../model/connections";
import "../model/remoteCommands";
import { notifyRemoteRecovered, resetRemoteHealth } from "../model/remoteHealth";
import { resetAutoContinueForTests } from "../../sessions/model/autoContinue";
import { resetRemoteQueuesForTests } from "../model/useRemoteQueue";
import { resetRemoteMachineChannelsForTests } from "../model/remoteMachineChannel";
import { readRemotePageCache, writeRemotePageCache } from "../model/remotePageCache";
import { watchKey, watchRun, watchedRun } from "../model/remoteTurnWatch";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import type {
  HostCommand,
  HostDescriptor,
  HostModelCatalog,
  HostSession,
  SessionSync,
  RemoteMachine,
} from "../model/protocol";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: async () => {} }),
}));
vi.mock("../model/remotePageCache", () => ({
  readRemotePageCache: vi.fn(),
  writeRemotePageCache: vi.fn(),
  deleteRemotePageCache: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../sessions/ui/AgentTranscript", () => ({
  AgentTranscript: ({
    blocks,
    busy,
    remoteHistoryHasMore,
    onLoadRemoteHistory,
    onSendDraft,
    onRemoveDraft,
    onOpenFile,
    onOpenDiff,
  }: {
    blocks: Block[];
    busy: boolean;
    onSendDraft?: (block: Block) => void;
    onRemoveDraft?: (block: Block) => void;
    onOpenFile?: (path: string) => void;
    onOpenDiff?: (path: string) => void;
  }) =>
    createElement(
      "ol",
      {
        "aria-label": "Transcript",
        "data-busy": busy,
        "data-history": String(!!remoteHistoryHasMore),
      },
      createElement("button", {
        "aria-label": "Open transcript file",
        onClick: () => onOpenFile?.("src/app.ts"),
      }),
      remoteHistoryHasMore
        ? createElement("button", {
            "aria-label": "Load earlier messages",
            onClick: () => void onLoadRemoteHistory?.(),
          })
        : null,
      createElement("button", {
        "aria-label": "Open transcript diff",
        onClick: () => onOpenDiff?.("src/app.ts"),
      }),
      blocks.map((block) =>
        createElement(
          "li",
          { key: block.id },
          block.text,
          block.draft && onSendDraft
            ? createElement(
                "button",
                {
                  "aria-label": "Send remote draft",
                  onClick: () => onSendDraft(block),
                },
                "Send draft",
              )
            : null,
          block.draft && onRemoveDraft
            ? createElement(
                "button",
                {
                  "aria-label": "Remove remote draft",
                  onClick: () => onRemoveDraft(block),
                },
                "Remove draft",
              )
            : null,
        ),
      ),
    ),
}));

const machine: RemoteMachine = {
  id: "machine",
  name: "Home server",
  endpoint: "ssh://me@home",
  environmentId: "env",
};
const effort = (id: string, value: string) => ({
  id,
  label: "Reasoning",
  kind: "select" as const,
  value,
  options: ["low", "medium", "high"].map((option) => ({
    value: option,
    label: option[0].toUpperCase() + option.slice(1),
  })),
});
const gpt: AgentModel = {
  id: "codex:gpt-test",
  harness: "codex",
  name: "GPT Test",
  nativeId: "gpt-test",
  settings: [effort("reasoningEffort", "medium")],
};
const cursor: AgentModel = {
  id: "cursor:composer-test",
  harness: "cursor",
  name: "Composer Test",
  nativeId: "composer-test",
  settings: [],
};

let root: Root;
let container: HTMLDivElement;
let host: HostSession | undefined;
let catalog: HostModelCatalog | Error;
let providers: HostDescriptor["providers"];
let harnessSwitchSupported = false;
let steerSupported = false;
let lazyHistorySupported = false;
let inlineSyncSupported = false;
let inlineDelta: SessionSync | undefined;
let conversationRewindSupported = false;
let machineSessionDeleted = false;
let machineSessionRevisionHint: number | undefined;
let machineChangesFailure: string | undefined;
let machineChangesReset = false;
let historyReadDelay: Promise<void> | undefined;
let tailReadDelay: Promise<void> | undefined;
let commands: HostCommand[];
let projectKey: string;
let syncDelay: Promise<void> | undefined;
let dispatchDelay: Promise<void> | undefined;
let attachmentReadDelay: Promise<void> | undefined;
let describeDelay: Promise<void> | undefined;
let steerFailure: string | undefined;
let receiptRunId: string | undefined;
let queueReadFailed = false;
let branchFailure: string | undefined;
let branchActionFailure: string | undefined;
let currentBranch: string;
let createdBranch: string | undefined;
let createdWorktree: string | undefined;
let deletedSessions: string[];
/** What the session store holds for a host chat's queue, and what the app wrote to it. */
let savedQueue: unknown;
let queueWrites: { sessionId: string; queue: unknown }[];
/** While set, every request to the machine fails with this error. */
let machineDown: string | undefined;
const unreachable = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(readRemotePageCache).mockReset().mockResolvedValue(undefined);
  vi.mocked(writeRemotePageCache).mockReset().mockResolvedValue(undefined);
  resetRemoteMachineChannelsForTests();
  resetRemoteQueuesForTests();
  resetAutoContinueForTests();
  resetRemoteSessionCachesForTests();
  resetRemoteSessionReadsForTests();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearComposerDraft("shell");
  resetDisabledModels();
  resetHarnessModelOverlays();
  harnessSwitchSupported = false;
  steerSupported = false;
  lazyHistorySupported = false;
  conversationRewindSupported = false;
  machineSessionDeleted = false;
  machineSessionRevisionHint = undefined;
  inlineSyncSupported = false;
  inlineDelta = undefined;
  machineChangesFailure = undefined;
  machineChangesReset = false;
  historyReadDelay = undefined;
  tailReadDelay = undefined;
  localStorage.setItem("bycoda.modelControls", "beside");
  commands = [];
  host = undefined;
  syncDelay = undefined;
  dispatchDelay = undefined;
  attachmentReadDelay = undefined;
  describeDelay = undefined;
  steerFailure = undefined;
  receiptRunId = undefined;
  queueReadFailed = false;
  branchFailure = undefined;
  branchActionFailure = undefined;
  currentBranch = "main";
  createdBranch = undefined;
  createdWorktree = undefined;
  deletedSessions = [];
  savedQueue = null;
  queueWrites = [];
  machineDown = undefined;
  resetRemoteHealth();
  catalog = { models: { codex: [gpt] }, errors: {} };
  providers = ["codex"];
  projectKey = rememberRemoteProject("env", {
    id: "project",
    name: "repo",
    cwd: "/home/me/repo",
  }).key;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_machines") return [machine];
    if (command === "session_get_queue") {
      if (queueReadFailed) throw new Error("queue storage unavailable");
      return savedQueue;
    }
    if (command === "read_file_base64") {
      if (attachmentReadDelay) await attachmentReadDelay;
      return "eA==";
    }
    if (command === "read_attachment_chunk") {
      if (attachmentReadDelay) await attachmentReadDelay;
      const { size, offset, length } = input as { size: number; offset: number; length: number };
      const end = Math.min(size, offset + length);
      return { data: btoa("x".repeat(end - offset)), offset: end, size };
    }
    if (command === "session_set_queue") {
      queueWrites.push(input as { sessionId: string; queue: unknown });
      return undefined;
    }
    if (command !== "remote_request") return undefined;
    if (machineDown) throw machineDown;
    const { method, params } = input as {
      method: string;
      params: HostCommand & { sessionId?: string };
    };
    const workspace =
      method === "workspace.run"
        ? (params as unknown as {
            command: string;
            args: Record<string, unknown>;
          })
        : undefined;
    const operation = workspace?.command ?? method;
    const commandParams = workspace?.args ?? params;
    if (operation === "list_project_files" || operation === "list_claude_commands") return [];
    if (method === "environment.describe") {
      if (describeDelay) await describeDelay;
      return {
        protocolVersion: 1,
        environmentId: "env",
        name: "home",
        providers,
        capabilities: [
          "attachments.upload",
          "sessions.plan",
          "sessions.draft",
          ...(steerSupported ? ["sessions.steer"] : []),
          ...(harnessSwitchSupported ? ["sessions.harnessSwitch"] : []),
          ...(lazyHistorySupported ? ["sessions.lazyHistory", "machine.changes"] : []),
          ...(inlineSyncSupported ? ["machine.changes", "machine.changes.inlineSync"] : []),
          ...(conversationRewindSupported ? ["sessions.rewind"] : []),
          ...(shellSupported ? ["sessions.shell"] : []),
        ],
      };
    }
    if (method === "machine.changes") {
      if (machineChangesFailure) {
        const failure = machineChangesFailure;
        machineChangesFailure = undefined;
        throw new Error(failure);
      }
      const reset = machineChangesReset;
      machineChangesReset = false;
      const request = params as { sessions?: { sessionId: string; revision: number }[] };
      return {
        instanceId: "test-host",
        reset,
        sessions: machineSessionDeleted
          ? (request.sessions ?? [])
              .filter((entry) => entry.sessionId === "host-session")
              .map((entry) => ({
                sessionId: entry.sessionId,
                revision: entry.revision,
                deleted: true,
              }))
          : machineSessionRevisionHint === undefined
            ? []
            : (request.sessions ?? [])
                .filter((entry) => entry.sessionId === "host-session")
                .map((entry) => ({
                  sessionId: entry.sessionId,
                  revision: machineSessionRevisionHint!,
                  ...(inlineDelta ? { sync: inlineDelta } : {}),
                })),
        projects: [],
      };
    }
    if (method === "models.list") {
      if (catalog instanceof Error) throw catalog.message;
      return catalog;
    }
    if (operation === "git.branches" || operation === "git_branches") {
      if (branchFailure) throw new Error(branchFailure);
      if (workspace)
        return {
          current: currentBranch,
          detached: false,
          branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])].map((name) => ({
            name,
            current: name === currentBranch,
            remote: null,
          })),
        };
      return {
        current: currentBranch,
        branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])],
      };
    }
    if (operation === "git.worktrees" || operation === "git_worktrees")
      return {
        defaultRoot: "/home/me/repo-worktrees",
        worktrees: [
          {
            path: "/home/me/repo",
            branch: "main",
            head: "abc",
            isMain: true,
            missing: false,
          },
          {
            path: "/home/me/repo-worktrees/dev",
            branch: "dev",
            head: "def",
            isMain: false,
            missing: false,
          },
          ...(createdWorktree
            ? [
                {
                  path: createdWorktree,
                  branch: createdBranch,
                  head: "abc",
                  isMain: false,
                  missing: false,
                },
              ]
            : []),
        ],
      };
    if (method === "git.worktreeCreate") {
      createdBranch = params.branch;
      createdWorktree = `/home/me/repo-worktrees/wt-${params.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      return {
        path: createdWorktree,
        branch: createdBranch,
        head: "abc",
        isMain: false,
        missing: false,
      };
    }
    if (
      operation === "git.switch" ||
      operation === "git.createBranch" ||
      operation === "git_checkout" ||
      operation === "git_create_branch"
    ) {
      if (branchActionFailure) throw new Error(branchActionFailure);
      currentBranch = String(operation.startsWith("git_") ? commandParams.name : params.branch);
      if (operation === "git.createBranch" || operation === "git_create_branch")
        createdBranch = currentBranch;
      if (workspace) return currentBranch;
      return {
        current: params.branch,
        branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])],
      };
    }
    if (method === "sessions.sync") {
      if (syncDelay) await syncDelay;
      return {
        kind: "snapshot",
        value:
          params.partial && lazyHistorySupported
            ? {
                ...host!,
                history: {
                  revision: host!.revision,
                  totalBlocks: host!.session.blocks.length,
                  before: 1,
                },
              }
            : host,
      };
    }
    if (method === "sessions.page") {
      const value = host!;
      if (params.before !== undefined && historyReadDelay) await historyReadDelay;
      if (params.before === undefined && tailReadDelay) await tailReadDelay;
      return params.before === undefined
        ? { sync: { kind: "snapshot", value }, before: 1, totalBlocks: 2, revision: value.revision }
        : {
            sync: {
              kind: "snapshot",
              value: {
                ...value,
                session: {
                  ...value.session,
                  blocks: [
                    { id: "older", role: "assistant", text: "Earlier reply" },
                    ...value.session.blocks,
                  ],
                },
              },
            },
            totalBlocks: 2,
            revision: value.revision,
          };
    }
    if (method === "attachments.upload") return { offset: (params as { size: number }).size };
    if (method === "commands.dispatch") {
      if (dispatchDelay && params.type !== "cancel") await dispatchDelay;
      if (params.type === "steer" && steerFailure) throw new Error(steerFailure);
      return dispatch(params);
    }
    if (method === "sessions.delete") {
      deletedSessions.push(params.sessionId!);
      host = undefined;
      return { deleted: true };
    }
    throw new Error(`Unexpected method ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await settle();
  resetRemoteMachineChannelsForTests();
  resetRemoteQueuesForTests();
  resetAutoContinueForTests();
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Whether the host in a test advertises `!command` support. */
let shellSupported = false;

/** A minimal host engine: persists commands the way the real one does. */
function dispatch(command: HostCommand) {
  commands.push(command);
  if (command.type === "create") {
    host = {
      projectId: command.projectId,
      revision: 1,
      status: "idle",
      updatedAt: 0,
      session: {
        id: "host-session",
        cwd: command.worktreeCwd ?? "/home/me/repo",
        harness: command.harness,
        model: command.model,
        modelSettings: command.modelSettings ?? {},
        runtimeMode: command.runtimeMode,
        title: "New remote session",
        blocks: [],
      },
    };
  } else if (host && command.type === "configure") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        ...(command.harness ? { harness: command.harness } : {}),
        model: command.model,
        modelSettings: command.modelSettings,
        runtimeMode: command.runtimeMode,
      },
    };
  } else if (host && command.type === "steer") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks,
          { id: command.commandId, role: "user", text: command.text },
        ],
      },
    };
  } else if (host && command.type === "send") {
    host = {
      ...host,
      revision: host.revision + 1,
      status: "idle",
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks.filter((block) => block.id !== command.draftBlockId),
          { id: command.commandId, role: "user", text: command.text },
          { id: `${command.commandId}-reply`, role: "assistant", text: "Done" },
        ],
      },
    };
  } else if (host && command.type === "shell") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks,
          {
            id: command.commandId,
            role: "system",
            text: "",
            shell: { command: command.line, output: "on host", exitCode: 0 },
          },
        ],
      },
    };
  } else if (host && command.type === "draft") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks,
          {
            id: command.commandId,
            role: "user",
            text: command.text,
            draft: true,
          },
        ],
      },
    };
  } else if (host && command.type === "removeDraft") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: host.session.blocks.filter((block) => block.id !== command.draftBlockId),
      },
    };
  } else if (host && command.type === "rewind") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: rewindConversationBeforeMessage(host.session, command.blockId),
    };
  }
  return {
    commandId: command.commandId,
    sessionId: "host-session",
    revision: host?.revision ?? 1,
    ...(command.type === "send" && receiptRunId ? { runId: receiptRunId } : {}),
  };
}

const shell = (): Session => ({
  id: "shell",
  cwd: projectKey,
  harness: "claude",
  model: "claude:sonnet-5",
  modelSettings: { reasoningEffort: "high" },
  runtimeMode: "supervised",
  title: "New session",
  blocks: [],
});

it.each(["codex", "cursor"] as const)(
  "shows the host's %s icon in the workspace tab when the local default is Claude",
  async (harness) => {
    providers = ["codex", "cursor"];
    catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
    dispatch({
      type: "create",
      commandId: "existing-session",
      projectId: "project",
      harness,
      model: harness === "codex" ? gpt.id : cursor.id,
      runtimeMode: "supervised",
    });
    host!.session.title = "Remote conversation";
    rememberRemoteSession("shell", "host-session");
    const publish = vi.fn();
    const noop = () => {};

    function Workspace() {
      const [session, setSession] = useState(shell);
      const onSnapshot = useCallback((shellId: string, snapshot?: HostSession) => {
        publish(shellId, snapshot);
        if (snapshot)
          setSession((current) =>
            remoteSessionState(current, snapshot, remoteProjectFor(current.cwd)!),
          );
      }, []);
      return createElement(
        "div",
        null,
        createElement(TitleBar, {
          tabs: [
            {
              id: "remote-tab",
              project: "repo",
              title: session.title,
              more: [],
              sessionCount: 1,
              harnesses: [session.harness],
              busyHarnesses: [],
              files: [],
            },
          ],
          activeId: "remote-tab",
          cwd: session.cwd,
          onToggleSidebar: noop,
          onNew: noop,
          onSelect: noop,
          onClose: noop,
          onCloseMany: noop,
          onReorder: noop,
        }),
        createElement(PaneTree, {
          layout: leaf(session.id),
          sessions: [session],
          editorPanes: [],
          dirtyFileIds: new Set<string>(),
          fileErrorCounts: new Map<string, number>(),
          focusedId: session.id,
          visible: true,
          composerFocused: false,
          recents: [],
          onFocus: noop,
          onClose: noop,
          onRemoteSnapshot: onSnapshot,
        } as unknown as ComponentProps<typeof PaneTree>),
      );
    }

    await act(async () => root.render(createElement(Workspace)));
    await settle();
    expect(container.textContent).toContain("Remote conversation");
    expect(publish).toHaveBeenCalledWith(
      "shell",
      expect.objectContaining({
        session: expect.objectContaining({ harness }),
      }),
    );
    const icon = container.querySelector(
      '[data-title-tab-id="remote-tab"] [data-harness-status="idle"]',
    );
    const expected = document.createElement("div");
    expected.innerHTML = renderToStaticMarkup(
      createElement(HarnessIcon, { harness, className: "size-3.5 shrink-0" }),
    );
    expect(icon?.firstElementChild?.isEqualNode(expected.firstElementChild)).toBe(true);
  },
);

async function render(session = shell(), extra: Partial<SessionPaneProps> = {}) {
  const props = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    onFocus: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  } as unknown as SessionPaneProps;
  await act(async () => root.render(createElement(SessionPane, props)));
  await settle();
}
let remoteOverrides: RemoteSessionOverrides;
async function renderRemoteProbe() {
  await act(async () =>
    root.render(
      createElement(RemoteSession, {
        shell: shell(),
        visible: true,
        onOpenFile: vi.fn(),
        onOpenDiff: vi.fn(),
        onOpenPlan: vi.fn(),
        render: (overrides: RemoteSessionOverrides) => {
          remoteOverrides = overrides;
          return null;
        },
      }),
    ),
  );
  await settle();
}
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
const byLabel = (prefix: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`);
const remoteDataPhase = () =>
  container.querySelector("[data-remote-data-state]")?.getAttribute("data-remote-data-state");
async function type(text: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      text,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(text: string) {
  await type(text);
  await act(async () => byLabel("Send")!.click());
  await settle();
}
// The combined picker opens a settings menu; its "Model" row shows the model list.
async function openModels(triggerLabel: string) {
  await act(async () => byLabel(triggerLabel)!.click());
  const modelRow = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.startsWith("Model"),
  );
  if (modelRow)
    await act(async () => {
      modelRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
}
// Effort lives in the combined model picker: open it, hover the setting row,
// then pick the option from its submenu.
async function chooseEffort(label: string) {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"][aria-keyshortcuts]',
  )!;
  await act(async () => trigger.click());
  const row = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.startsWith("Reasoning"),
  )!;
  await act(async () => {
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  const option = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
  await act(async () => option.click());
  if (trigger.getAttribute("aria-expanded") === "true") await act(async () => trigger.click());
  await settle();
}

it("uses the normal composer with the host branch in its top row", async () => {
  await render();
  expect(container.querySelector("textarea")).not.toBeNull();
  // The machine is named in the project rail, not the composer.
  expect(container.textContent).not.toContain("Home server");
  expect(byLabel("Branch main")).not.toBeNull();
  expect(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Changes"),
  ).toBe(false);
  // The host's model, keeping the tab's effort where the model supports it.
  expect(byLabel("Codex GPT Test")?.getAttribute("aria-label")).toBe("Codex GPT Test, effort High");
  expect(container.textContent).toContain("GPT Test");
  // Nothing from the old standalone remote view or local-only tools.
  expect(container.textContent).not.toContain("New remote session");
  expect(container.textContent).not.toContain("Apply settings");
  expect(byLabel("Add files or choose a mode")?.closest(".hidden")).toBeNull();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  expect(document.body.textContent).toContain("Upload file");
  expect(document.body.textContent).toContain("Plan mode");
  expect(document.body.textContent).toContain("Draft");
  expect(document.body.textContent).not.toContain("Operator");
  // No local project picker; host project actions are allowed.
  expect(
    container.querySelector('button[aria-label^="Project "]:not([aria-label="Project actions"])'),
  ).toBeNull();
});

it("opens transcript files and diffs through the shared remote tabs", async () => {
  const onOpenFile = vi.fn();
  const onOpenDiff = vi.fn();
  await render(shell(), { onOpenFile, onOpenDiff });
  await send("Inspect files");
  await act(async () => byLabel("Open transcript file")!.click());
  await act(async () => byLabel("Open transcript diff")!.click());
  expect(onOpenFile).toHaveBeenCalledWith("remote://env/home/me/repo/src/app.ts");
  expect(onOpenDiff).toHaveBeenCalledWith("remote://env/home/me/repo/src/app.ts", undefined);
});

it("opens a host conversation in an already mounted empty tab", async () => {
  await render();
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      title: "Codex · Existing conversation",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  commands = [];
  await act(async () => rememberRemoteSession("shell", "host-session"));
  await settle();
  expect(container.textContent).toContain("Earlier message");
  await send("Continue here");
  expect(commands.some((command) => command.type === "create")).toBe(false);
  expect(commands.some((command) => command.type === "send")).toBe(true);
});

it("keeps an unopened remote conversation docked while its transcript loads", async () => {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      id: "unopened-session",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  rememberRemoteSession("shell", "unopened-session");
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });

  await render();
  const composer = container.querySelector("[data-session-composer]");
  expect(composer?.classList.contains("max-w-4xl")).toBe(true);
  // Says it is loading instead of a blank pane, and never offers a new chat.
  expect(container.textContent).toContain("Loading conversation…");
  expect(container.textContent).not.toContain("Work on repo.");

  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(container.textContent).toContain("Earlier message");
  expect(container.textContent).not.toContain("Loading conversation…");
  expect(container.querySelector("[data-session-composer]")).toBe(composer);
});

it("shows a preloaded conversation's transcript on its first render", async () => {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      id: "preloaded-session",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  await preloadRemoteSession(machine.id, "preloaded-session");
  rememberRemoteSession("shell", "preloaded-session");
  // Hold every later sync: what shows must come from the preload alone.
  syncDelay = new Promise<void>(() => {});

  await act(async () =>
    root.render(
      createElement(SessionPane, {
        session: shell(),
        visible: true,
        focused: true,
        inSplit: false,
        composerFocused: false,
        recents: [],
        onFocus: vi.fn(),
        onClose: vi.fn(),
      } as unknown as SessionPaneProps),
    ),
  );
  expect(container.textContent).toContain("Earlier message");
  expect(container.textContent).not.toContain("Work on repo.");
});

it("shows an unavailable branch when Git lookup fails", async () => {
  branchFailure = "fatal: not a git repository";
  // A remote project keeps the branches it last had, so use one never looked up.
  const unlisted = rememberRemoteProject("env", {
    id: "project",
    name: "unlisted",
    cwd: "/home/me/unlisted",
  });
  await render({ ...shell(), cwd: unlisted.key });
  const picker = byLabel("No git repository");
  expect(picker).not.toBeNull();
  expect((picker as HTMLButtonElement).disabled).toBe(true);
});

it("creates the host session with the chosen settings on the first message", async () => {
  await render();
  await chooseEffort("Medium");
  expect(commands).toHaveLength(0);
  await send("Fix the tests");
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  expect(commands[0]).toMatchObject({
    projectId: "project",
    harness: "codex",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "medium" },
  });
  expect(commands[1]).toMatchObject({
    sessionId: "host-session",
    text: "Fix the tests",
  });
  expect(remoteSessionFor("shell")).toBe("host-session");
  expect(container.textContent).toContain("Fix the tests");
});

it("keeps a new session on its selected remote provider", async () => {
  providers = ["codex", "cursor"];
  catalog = {
    models: { codex: [gpt], cursor: [cursor] },
    errors: {},
  };
  await render({
    ...shell(),
    harness: "cursor",
    model: cursor.id,
    modelSettings: {},
  });
  await send("Use Cursor remotely");
  expect(commands[0]).toMatchObject({
    type: "create",
    harness: "cursor",
    model: cursor.id,
  });
});

it("lets an existing Claude host session select another installed provider", async () => {
  providers = ["claude", "codex"];
  harnessSwitchSupported = true;
  const claude = {
    id: "claude:opus-5",
    name: "Opus",
    harness: "claude" as const,
  };
  catalog = { models: { claude: [claude], codex: [gpt] }, errors: {} };
  host = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 0,
    session: {
      id: "host-session",
      cwd: "/home/me/repo",
      harness: "claude",
      model: claude.id,
      runtimeMode: "supervised",
      title: "Earlier Claude chat",
      blocks: [{ id: "earlier", role: "user", text: "Earlier work" }],
    },
  };
  rememberRemoteSession("shell", "host-session");
  await render();
  await openModels("Claude Code Opus");
  const codexTab = document.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Codex"]');
  expect(codexTab).not.toBeNull();
  await act(async () => codexTab!.click());
  const option = document.querySelector<HTMLButtonElement>('[role="option"]');
  await act(async () => option!.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({
    type: "configure",
    harness: "codex",
    model: gpt.id,
  });
  expect(host?.session.harness).toBe("codex");
  expect(container.textContent).toContain("Earlier work");
});

it("applies the local model visibility settings to a historical host chat", async () => {
  const visible = {
    id: "claude:sonnet-5",
    name: "Sonnet",
    harness: "claude" as const,
  };
  const disabled = {
    id: "claude:opus-4-6",
    name: "Opus 4.6",
    harness: "claude" as const,
  };
  providers = ["claude"];
  catalog = { models: { claude: [visible, disabled] }, errors: {} };
  saveModelEnabled("claude:opus-4.6", false);
  host = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 0,
    session: {
      id: "host-session",
      cwd: "/home/me/repo",
      harness: "claude",
      model: visible.id,
      runtimeMode: "supervised",
      title: "Earlier chat",
      blocks: [{ id: "earlier", role: "user", text: "Work" }],
    },
  };
  rememberRemoteSession("shell", "host-session");
  await render();
  await openModels("Claude Code Sonnet");
  expect(
    [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
  ).toEqual(["Sonnet"]);
});

it("drops settings from the tab that the host's model does not offer", async () => {
  await render({
    ...shell(),
    harness: "codex",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "high", serviceTier: "fast" },
  });
  await send("Fix the tests");
  expect(commands[0]).toMatchObject({
    type: "create",
    model: "codex:gpt-test",
  });
  expect(commands[0]).toHaveProperty("modelSettings", {
    reasoningEffort: "high",
  });
});

it("sends a remote plan turn from the plus menu", async () => {
  await render();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const plan = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Plan mode"),
  )!;
  await act(async () => plan.click());
  await send("Plan the migration");
  expect(commands.at(-1)).toMatchObject({
    type: "send",
    text: "Plan the migration",
    intent: "plan",
  });
});

async function saveDraft(text: string) {
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const draft = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Save this message without starting"),
  )!;
  await act(async () => draft.click());
  await type(text);
  await act(async () => byLabel("Save draft")!.click());
  await settle();
}
const transcriptItems = (text: string) =>
  [...container.querySelectorAll("ol[aria-label='Transcript'] li")].filter((item) =>
    item.textContent?.includes(text),
  );

it("saves and sends a remote draft", async () => {
  await render();
  await saveDraft("Review this later");
  expect(commands.map((command) => command.type)).toEqual(["create", "draft"]);
  expect(commands.at(-1)).toMatchObject({
    type: "draft",
    text: "Review this later",
  });
  expect(byLabel("Send remote draft")).not.toBeNull();
  await act(async () => byLabel("Send remote draft")!.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({
    type: "send",
    text: "Review this later",
    draftBlockId: commands[1].commandId,
  });
});

it("keeps a new draft on screen while the host confirms it", async () => {
  await render();
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await saveDraft("Review this later");
  expect(commands.map((command) => command.type)).toEqual(["create", "draft"]);
  expect(transcriptItems("Review this later")).toHaveLength(1);
  expect(container.textContent).not.toContain("Work on repo.");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-busy")).toBe(
    "false",
  );
  expect(byLabel("Send remote draft")).not.toBeNull();
  expect(byLabel("Remove remote draft")).not.toBeNull();
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(transcriptItems("Review this later")).toHaveLength(1);
});

it("replaces a sent draft with its message at once", async () => {
  await render();
  await saveDraft("Review this later");
  syncDelay = new Promise<void>(() => {});
  await act(async () => byLabel("Send remote draft")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "send" });
  expect(transcriptItems("Review this later")).toHaveLength(1);
  expect(byLabel("Send remote draft")).toBeNull();
});

it("removes a draft-only conversation with its draft, as a local one", async () => {
  await render();
  await saveDraft("Review this later");
  const sessionId = remoteSessionFor("shell");
  expect(sessionId).toBe("host-session");
  await act(async () => byLabel("Remove remote draft")!.click());
  expect(transcriptItems("Review this later")).toHaveLength(0);
  await settle();
  expect(deletedSessions).toEqual([sessionId]);
  expect(commands.some((command) => command.type === "removeDraft")).toBe(false);
  expect(remoteSessionFor("shell")).toBeUndefined();
  expect(container.textContent).toContain("Work on repo.");
});

it("keeps a sent message visible until the host sync confirms it", async () => {
  await render();
  await send("First");
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await type("Second");
  await act(async () => byLabel("Send")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });
  const secondMessages = () =>
    [...container.querySelectorAll("ol[aria-label='Transcript'] li")].filter(
      (item) => item.textContent === "Second",
    );
  expect(secondMessages()).toHaveLength(1);
  expect(container.querySelector("ol[aria-label='Transcript']")?.getAttribute("data-busy")).toBe(
    "true",
  );
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(secondMessages()).toHaveLength(1);
});

it("does not flash a status banner while an ordinary message is in flight", async () => {
  await render();
  await send("First");
  let releaseDispatch = () => {};
  dispatchDelay = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });

  await type("Second");
  await act(async () => byLabel("Send")!.click());
  expect(container.textContent).toContain("Second");
  expect(container.textContent).not.toContain("Waiting for the host to confirm");

  await act(async () => {
    releaseDispatch();
    dispatchDelay = undefined;
  });
  await settle();
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });
});

it("keeps the first turn active while its accepted message awaits host sync", async () => {
  await render();
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await send("First remote turn");
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  const transcript = () => container.querySelector("ol[aria-label='Transcript']");
  expect(transcript()?.textContent).toContain("First remote turn");
  expect(transcript()?.getAttribute("data-busy")).toBe("true");
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(transcript()?.querySelectorAll("li")).toHaveLength(2);
  expect(transcript()?.getAttribute("data-busy")).toBe("false");
});

it("starts a remote session in the worktree chosen before its first message", async () => {
  await render();
  await act(async () => byLabel("Workspace Current checkout")!.click());
  const existing = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Existing worktree…",
  );
  await act(async () => existing!.click());
  await settle();
  const worktree = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.title === "remote://env/home/me/repo-worktrees/dev",
  );
  expect(worktree).toBeDefined();
  await act(async () => worktree!.click());
  await send("Work in dev");
  expect(commands[0]).toMatchObject({
    type: "create",
    worktreeCwd: "/home/me/repo-worktrees/dev",
  });
  expect(host?.session.cwd).toBe("/home/me/repo-worktrees/dev");
  expect(container.querySelector('[aria-label="Workspace Worktree"]')?.tagName).toBe("DIV");
  expect(byLabel("Workspace Worktree")).toBeNull();
});

it("creates a host worktree through the composer and selects it", async () => {
  await render();
  await act(async () => byLabel("Workspace Current checkout")!.click());
  expect(document.body.querySelector('[aria-label="Workspace"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Existing worktree…");
  expect(document.body.textContent).not.toContain("Worktree settings");
  expect(document.body.querySelector('[aria-label="Existing worktrees"]')).toBeNull();
  expect(document.body.querySelector('input[placeholder="Search working copies…"]')).toBeNull();
  const create = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "New worktree",
  );
  await act(async () => create!.click());
  expect(byLabel("Workspace New worktree")).not.toBeNull();
  expect(byLabel("Create worktree from main")).not.toBeNull();
  expect(byLabel("Branch main")).toBeNull();
  await act(async () => byLabel("Create worktree from main")!.click());
  const devBase = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.trim() === "dev",
  );
  await act(async () => devBase!.click());
  expect(byLabel("Create worktree from dev")).not.toBeNull();
  expect(invoke).not.toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({ method: "git.worktreeCreate" }),
  );
  await send("Work in new tree");
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      method: "git.worktreeCreate",
      params: expect.objectContaining({
        projectId: "project",
        cwd: "/home/me/repo",
        branch: expect.stringMatching(/^mc\/[a-z0-9]+$/),
        base: "dev",
        existing: false,
      }),
    }),
  );
  expect(commands[0]).toMatchObject({
    type: "create",
    worktreeCwd: createdWorktree,
    autoWorktreeBranch: createdBranch,
  });
});

it("searches and creates a host branch from the composer picker", async () => {
  await render();
  await act(async () => byLabel("Branch main")!.click());
  const search = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "feature/test",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Create and checkout feature/test"),
  );
  await act(async () => create!.click());
  await settle();
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      method: "workspace.run",
      params: expect.objectContaining({
        command: "git_create_branch",
        args: expect.objectContaining({
          name: "feature/test",
          cwd: "/home/me/repo",
        }),
      }),
    }),
  );
  expect(byLabel("Branch feature/test")).not.toBeNull();
});

it("keeps a failed host branch action in the picker", async () => {
  branchActionFailure = "Commit or stash changes on the host before switching branches";
  await render();
  await act(async () => byLabel("Branch main")!.click());
  const dev = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes("dev"),
  );
  await act(async () => dev!.click());
  await settle();
  expect(document.body.querySelector('[aria-label="Branch picker"]')).not.toBeNull();
  expect(document.body.textContent).toContain(branchActionFailure);
});

it("locks a started remote session to its worktree like a local session", async () => {
  host = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 0,
    session: {
      id: "host-session",
      cwd: "/home/me/repo",
      harness: "codex",
      model: "codex:gpt-test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Existing conversation",
      blocks: [{ id: "first", role: "user", text: "Earlier work" }],
    },
  };
  rememberRemoteSession("shell", "host-session");
  await render();
  expect(container.querySelector('[aria-label="Workspace Current checkout"]')?.tagName).toBe("DIV");
  expect(byLabel("Workspace Current checkout")).toBeNull();
  expect(byLabel("Branch main")).not.toBeNull();
  expect(commands).toHaveLength(0);
});

it("applies effort changes directly and uses them on the next turn", async () => {
  await render();
  await send("First");
  await chooseEffort("Low");
  expect(commands.at(-1)).toMatchObject({
    type: "configure",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "low" },
  });
  expect(host?.session.modelSettings).toEqual({ reasoningEffort: "low" });
  await settle();
  expect(commands.filter((command) => command.type === "configure")).toHaveLength(1);
  await send("Second");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });

  // Reopening the tab shows the saved setting.
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(byLabel("Codex GPT Test")?.getAttribute("aria-label")).toBe("Codex GPT Test, effort Low");
});

it("keeps a saved model's effort editable when the host catalog fails", async () => {
  await render();
  await send("First");
  catalog = new Error("Codex CLI is not authenticated");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("Couldn’t load models");
  expect(byLabel("Codex GPT Test")?.getAttribute("aria-label")).toBe("Codex GPT Test, effort High");
  await chooseEffort("Low");
  expect(commands.at(-1)).toMatchObject({
    type: "configure",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "low" },
  });
});

it("explains a dropped connection above the session and reconnects from there", async () => {
  machineDown = unreachable;
  await render();
  expect(container.textContent).toContain("Can’t reach Home server");
  expect(container.textContent).toContain("The machine did not answer");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("[data-remote-data-state]")).toBeNull();
  expect(container.querySelector("textarea")).not.toBeNull();
  const reconnect = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Reconnect",
  )!;
  machineDown = undefined;
  await act(async () => reconnect.click());
  await settle();
  await settle();
  expect(container.textContent).not.toContain("Can’t reach Home server");
});

it("puts the message back in the composer when Send cannot reconnect", async () => {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  commands = [];
  rememberRemoteSession("shell", "host-session");
  machineDown = unreachable;
  await render();
  await type("Fix the tests");
  expect(byLabel("Send")!.title).toContain("Can’t reach Home server");
  await act(async () => byLabel("Send")!.click());
  await settle();
  await settle();
  expect(container.querySelector("textarea")!.value).toBe("Fix the tests");
  expect(commands).toHaveLength(0);
  expect(container.textContent).toContain("Can’t reach Home server");
});

it("keeps a first message visible, with Try again, when Send cannot reconnect", async () => {
  machineDown = unreachable;
  await render();
  await type("Fix the tests");
  await act(async () => byLabel("Send")!.click());
  await settle();
  await settle();
  expect(commands).toHaveLength(0);
  expect(container.querySelector("ol[aria-label='Transcript']")?.textContent).toContain(
    "Fix the tests",
  );
  expect(container.textContent).toContain("Couldn’t send the message on Home server");
  expect(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Try again"),
  ).toBe(true);
});

it("reconnects first and then sends when Send is pressed while disconnected", async () => {
  machineDown = unreachable;
  await render();
  await type("Fix the tests");
  machineDown = undefined;
  await act(async () => byLabel("Send")!.click());
  for (let i = 0; i < 4; i++) await settle();
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  expect(commands[1]).toMatchObject({ text: "Fix the tests" });
  expect(container.querySelector("textarea")!.value).toBe("");
});

it("asks to connect the machine when it is not set up on this computer", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "remote_machines" ? [] : undefined,
  );
  await render();
  expect(container.textContent).toContain(
    "The machine for this project isn’t connected on this computer.",
  );
  expect(container.querySelector("textarea")).toBeNull();
});

it("çalışan turda Extras ayarını saklar ve tur bittikten sonra uygular", async () => {
  await render();
  await send("First");
  host = {
    ...host!,
    revision: host!.revision + 1,
    status: "running",
    runId: "run",
    session: { ...host!.session, busy: true },
  };
  await vi.waitFor(() => expect(byLabel("Stop")).not.toBeNull(), {
    timeout: 4_000,
  });
  await chooseEffort("Low");
  expect(byLabel("Stop")).not.toBeNull();
  expect(commands.some((command) => command.type === "configure")).toBe(false);

  await act(async () => byLabel("Stop")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "cancel", runId: "run" });

  host = {
    ...host!,
    revision: host!.revision + 1,
    status: "idle",
    runId: undefined,
    session: { ...host!.session, busy: false },
  };
  await vi.waitFor(
    () =>
      expect(commands.at(-1)).toMatchObject({
        type: "configure",
        modelSettings: { reasoningEffort: "low" },
      }),
    { timeout: 4_000 },
  );
});

it.each([false, true])(
  "retries a lost create response without duplicating the first turn (remount: %s)",
  async (remount) => {
    const original = vi.mocked(invoke).getMockImplementation()!;
    let accepted: ReturnType<typeof dispatch> | undefined;
    const attempts: HostCommand[] = [];
    vi.mocked(invoke).mockImplementation(async (command, input) => {
      const request = input as { method?: string; params?: HostCommand } | undefined;
      if (request?.method === "commands.dispatch" && request.params?.type === "create") {
        attempts.push(request.params);
        if (accepted) return accepted;
        accepted = dispatch(request.params);
        throw new Error("Response lost after host accepted the request");
      }
      return original(command, input);
    });
    await render();
    await send("Keep this first message");
    expect(commands.map((command) => command.type)).toEqual(["create"]);
    if (remount) {
      await act(async () => root.unmount());
      root = createRoot(container);
      await render();
    }
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    expect(retry).toBeTruthy();
    await act(async () => retry.click());
    await settle();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
    expect(commands[1]).toMatchObject({
      text: "Keep this first message",
      sessionId: "host-session",
    });
    expect(transcriptItems("Keep this first message")).toHaveLength(1);
  },
);

it("ignores a late create response after its tab has switched conversations", async () => {
  await render();
  let release!: () => void;
  dispatchDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await send("Pending first message");
  await act(async () => rememberRemoteSession("shell", "different-session"));
  await act(async () => {
    release();
    dispatchDelay = undefined;
  });
  await settle();
  expect(remoteSessionFor("shell")).toBe("different-session");
  expect(commands.map((command) => command.type)).toEqual(["create"]);
  expect(container.textContent).not.toContain("Pending first message");
});

// --- queue and recovery across a restart or a dropped connection -------------

/** These wait on the pane's real polling, which is slower when the machine is busy. */
const slow = (name: string, run: () => Promise<void>) => it(name, run, 20_000);

/** A host chat that already has one exchange and a provider thread, opened in the tab. */
function openExistingChat(patch: Partial<HostSession> = {}) {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    ...patch,
    session: {
      ...host!.session,
      providerSessionId: "thread-1",
      blocks: [
        { id: "old-user", role: "user", text: "Earlier message" },
        { id: "old-reply", role: "assistant", text: "Earlier reply" },
      ],
      ...patch.session,
    },
  };
  commands = [];
  rememberRemoteSession("shell", "host-session");
}

it("locks remote sends through rewind and waits for an authoritative snapshot before acknowledging", async () => {
  conversationRewindSupported = true;
  openExistingChat();
  host = {
    ...host!,
    session: {
      ...host!.session,
      blocks: [
        { id: "old-user", role: "user", text: "Earlier message" },
        { id: "old-reply", role: "assistant", text: "Earlier reply" },
        { id: "latest-user", role: "user", text: "Remove this turn" },
      ],
    },
  };
  await renderRemoteProbe();
  expect(remoteOverrides.onRewindMessage).toBeTypeOf("function");

  let releaseDispatch!: () => void;
  dispatchDelay = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  let releaseSync!: () => void;
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  const syncCalls = vi
    .mocked(invoke)
    .mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "sessions.sync",
    ).length;
  let completed = false;
  let rewind!: Promise<boolean>;
  await act(async () => {
    rewind = Promise.resolve(remoteOverrides.onRewindMessage!("host-session", "latest-user"));
    void rewind.then(() => {
      completed = true;
    });
  });
  expect(remoteOverrides.onSubmit!("shell", "Must wait", [])).toBe(false);
  expect(commands.filter((command) => command.type === "send")).toHaveLength(0);
  expect(commands.filter((command) => command.type === "rewind")).toHaveLength(0);

  await act(async () => {
    releaseDispatch();
    dispatchDelay = undefined;
  });
  await vi.waitFor(() =>
    expect(commands.filter((command) => command.type === "rewind")).toHaveLength(1),
  );
  expect(commands.find((command) => command.type === "rewind")).toMatchObject({
    blockId: "latest-user",
    expectedRevision: 1,
  });
  await vi.waitFor(() =>
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          (call) => (call[1] as { method?: string } | undefined)?.method === "sessions.sync",
        ).length,
    ).toBeGreaterThan(syncCalls),
  );
  expect(completed).toBe(false);
  expect(remoteOverrides.session?.providerSessionId).toBe("thread-1");

  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await expect(rewind).resolves.toBe(true);
  expect(remoteOverrides.session?.blocks.map((block) => block.id)).toEqual([
    "old-user",
    "old-reply",
  ]);
  expect(remoteOverrides.session?.providerSessionId).toBeUndefined();
  expect(host?.session.providerSessionId).toBeUndefined();

  await act(async () => {
    expect(remoteOverrides.onSubmit!("shell", "Fresh follow-up", [])).toBe(true);
  });
  await settle();
  expect(commands.some((command) => command.type === "send")).toBe(true);
  expect(host?.session.providerSessionId).toBeUndefined();
});

it("exposes rewind only when supported and permits it after lazy history is fully loaded", async () => {
  openExistingChat();
  await renderRemoteProbe();
  expect(remoteOverrides.onRewindMessage).toBeUndefined();

  conversationRewindSupported = true;
  lazyHistorySupported = true;
  await act(async () => root.unmount());
  resetRemoteSessionCachesForTests();
  resetRemoteSessionReadsForTests();
  root = createRoot(container);
  openExistingChat();
  host = {
    ...host!,
    session: {
      ...host!.session,
      blocks: [
        { id: "old-user", role: "user", text: "Earlier message" },
        { id: "old-reply", role: "assistant", text: "Earlier reply" },
        { id: "latest-user", role: "user", text: "Remove this turn" },
      ],
    },
  };
  await renderRemoteProbe();
  expect(remoteOverrides.session?.historyPartial).toBe(true);
  await act(async () => {
    expect(await remoteOverrides.onRewindMessage!("host-session", "latest-user")).toBe(false);
    await remoteOverrides.onLoadRemoteHistory?.();
  });
  expect(remoteOverrides.session?.historyPartial).toBe(false);
  await act(async () => {
    expect(await remoteOverrides.onRewindMessage!("host-session", "latest-user")).toBe(true);
  });
  expect(commands.filter((command) => command.type === "rewind")).toHaveLength(1);
});

slow("keeps Send and the composer usable while an older remote page is loading", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  let release!: () => void;
  historyReadDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await render();
  const composer = container.querySelector("textarea")!;
  await vi.waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.some((call) => {
        const input = call[1] as { method?: string; params?: { before?: number } } | undefined;
        return input?.method === "sessions.page" && input.params?.before === undefined;
      }),
    ).toBe(true),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-history")).toBe(
      "true",
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Load earlier messages"]')!.click(),
  );
  await vi.waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.some((call) => {
        const input = call[1] as { method?: string; params?: { before?: number } } | undefined;
        return input?.method === "sessions.page" && input.params?.before !== undefined;
      }),
    ).toBe(true),
  );
  await type("message during history load");
  await act(async () => byLabel("Send")!.click());
  expect(
    commands.some(
      (command) => command.type === "send" && command.text === "message during history load",
    ),
  ).toBe(true);
  expect(container.querySelector("textarea")).toBe(composer);
  await settle();
  expect(container.querySelector("ol[aria-label='Transcript']")?.textContent).toContain(
    "message during history load",
  );
  release();
  await settle();
  expect(container.querySelector("ol[aria-label='Transcript']")?.textContent).toContain(
    "message during history load",
  );
});

it("does not poll transcript content for a hidden machine.changes session", async () => {
  lazyHistorySupported = true;
  await render(shell(), { visible: false });
  expect(
    vi.mocked(invoke).mock.calls.some(([, input]) => {
      const method = (input as { method?: string } | undefined)?.method;
      return method === "sessions.sync" || method === "sessions.page";
    }),
  ).toBe(false);
});

it("shows loading until the initial owner tail is verified", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  let release!: () => void;
  tailReadDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await render();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("loading"));
  release();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  expect(
    container.querySelector('[data-remote-data-state] [title^="Last verified"]'),
  ).not.toBeNull();
});

it("re-reads the owner tail when a reset arrives during its initial read", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  let release!: () => void;
  tailReadDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: HostSession[] = [];
  await render(shell(), {
    onRemoteSnapshot: (_shellId, snapshot) => {
      published.push(snapshot);
    },
  });
  const tailReads = () =>
    vi.mocked(invoke).mock.calls.filter(([, input]) => {
      const request = input as { method?: string; params?: { before?: number } } | undefined;
      return request?.method === "sessions.page" && request.params?.before === undefined;
    }).length;
  await vi.waitFor(() => expect(tailReads()).toBe(1));
  // A replacement host can reuse the old revision. The one-shot reset, rather
  // than a later revision hint, must invalidate the old in-flight response.
  host = {
    ...host!,
    session: {
      ...host!.session,
      blocks: [
        { id: "fresh-user", role: "user", text: "Task prompt" },
        { id: "fresh-reply", role: "assistant", text: "Current task output" },
      ],
    },
  };
  machineChangesReset = true;
  await vi.waitFor(() => expect(machineChangesReset).toBe(false));
  await act(async () => {
    tailReadDelay = undefined;
    release();
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Current task output"));
  expect(container.textContent).not.toContain("Earlier reply");
  expect(remoteDataPhase()).toBe("ready");
  expect(tailReads()).toBe(2);
  expect(
    published.some((snapshot) =>
      snapshot.session.blocks.some((block) => block.text === "Earlier reply"),
    ),
  ).toBe(false);
});

it("coalesces revision hints received during a tail read into one follow-up", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  let release!: () => void;
  tailReadDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await render();
  host = {
    ...host!,
    revision: host!.revision + 1,
    session: {
      ...host!.session,
      blocks: [
        { id: "task-user", role: "user", text: "Task prompt" },
        { id: "task-reply", role: "assistant", text: "Live task output" },
      ],
    },
  };
  machineSessionRevisionHint = host.revision;
  // Let several channel replies race with the same blocked owner read.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  machineSessionRevisionHint = undefined;
  inlineSyncSupported = false;
  inlineDelta = undefined;
  await act(async () => {
    tailReadDelay = undefined;
    release();
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Live task output"));
  const contentReads = vi.mocked(invoke).mock.calls.filter(([, input]) => {
    const method = (input as { method?: string } | undefined)?.method;
    return method === "sessions.page" || method === "sessions.sync";
  });
  expect(contentReads).toHaveLength(2);
  expect(remoteDataPhase()).toBe("ready");
});

it("keeps the transcript on disconnect, shows one connection notice and reconnects to verified empty", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  await render();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  machineDown = unreachable;
  await act(async () => byLabel("Refresh conversation")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Can’t reach Home server"));
  expect(container.textContent).toContain("Earlier reply");
  expect(container.querySelector("[data-remote-data-state]")).toBeNull();
  expect(container.textContent).not.toContain("Couldn’t refresh conversation");
  machineDown = undefined;
  host = { ...host!, revision: host!.revision + 1, session: { ...host!.session, blocks: [] } };
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Reconnect")!
      .click(),
  );
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("empty"));
  expect(container.textContent).not.toContain("Earlier reply");
});

it("refreshes without remounting the composer or clearing its draft", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  await render();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  await type("keep this unsent draft");
  const composer = container.querySelector("textarea");
  let release!: () => void;
  syncDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await act(async () => byLabel("Refresh conversation")!.click());
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("refreshing"));
  expect(container.querySelector("textarea")).toBe(composer);
  expect(container.querySelector("textarea")!.value).toBe("keep this unsent draft");
  release();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  expect(container.querySelector("textarea")).toBe(composer);
  expect(container.querySelector("textarea")!.value).toBe("keep this unsent draft");
});

it("marks known revision updates refreshing and settles on the new owner snapshot", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  await render();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  let release!: () => void;
  syncDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  host = {
    ...host!,
    revision: host!.revision + 1,
    session: {
      ...host!.session,
      blocks: [
        ...host!.session.blocks,
        { id: "update-user", role: "user", text: "Updated on host" },
      ],
    },
  };
  machineSessionRevisionHint = host!.revision;
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("refreshing"));
  release();
  await vi.waitFor(() => expect(container.textContent).toContain("Updated on host"));
  expect(remoteDataPhase()).toBe("ready");
});

it("releases transcript demand and stops polling when the host deletes a session", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  await render();
  await vi.waitFor(() =>
    expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-history")).toBe(
      "true",
    ),
  );
  machineSessionDeleted = true;
  await vi.waitFor(() =>
    expect(container.textContent).toContain("This conversation was deleted on the host."),
  );
  await vi.waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.some((call) => {
        const input = call[1] as { method?: string; params?: { sessions?: unknown[] } } | undefined;
        return input?.method === "machine.changes" && input.params?.sessions?.length === 0;
      }),
    ).toBe(true),
  );
  const contentReads = vi.mocked(invoke).mock.calls.filter((call) => {
    const input = call[1] as { method?: string } | undefined;
    return input?.method === "sessions.sync" || input?.method === "sessions.page";
  }).length;
  const sessionDemands = vi.mocked(invoke).mock.calls.filter((call) => {
    const input = call[1] as { method?: string; params?: { sessions?: unknown[] } } | undefined;
    return input?.method === "machine.changes" && (input.params?.sessions?.length ?? 0) > 0;
  }).length;
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => notifyRemoteRecovered("env"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(
    vi.mocked(invoke).mock.calls.filter((call) => {
      const input = call[1] as { method?: string } | undefined;
      return input?.method === "sessions.sync" || input?.method === "sessions.page";
    }),
  ).toHaveLength(contentReads);
  expect(
    vi.mocked(invoke).mock.calls.filter((call) => {
      const input = call[1] as { method?: string; params?: { sessions?: unknown[] } } | undefined;
      return input?.method === "machine.changes" && (input.params?.sessions?.length ?? 0) > 0;
    }),
  ).toHaveLength(sessionDemands);
});

slow("uses the tail baseline when the control channel recovers with a reset", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  await render();
  await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
  const tailReads = () =>
    vi.mocked(invoke).mock.calls.filter((call) => {
      const input = call[1] as { method?: string; params?: { before?: number } } | undefined;
      return input?.method === "sessions.page" && input.params?.before === undefined;
    }).length;
  const previousTailReads = tailReads();

  await act(async () => {
    machineChangesFailure = "control channel unavailable";
    machineChangesReset = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  expect(remoteDataPhase()).toBe("stale");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 7_500));
  });
  expect(tailReads()).toBeGreaterThan(previousTailReads);
  expect(remoteDataPhase()).toBe("ready");
});

slow(
  "does not start a content read when a recovered control channel reports deletion",
  async () => {
    lazyHistorySupported = true;
    openExistingChat();
    await render();
    await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
    await act(async () => {
      machineChangesFailure = "control channel unavailable";
      machineSessionDeleted = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(remoteDataPhase()).toBe("stale");
    const contentReads = vi.mocked(invoke).mock.calls.filter((call) => {
      const input = call[1] as { method?: string } | undefined;
      return input?.method === "sessions.sync" || input?.method === "sessions.page";
    }).length;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 7_500));
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("This conversation was deleted on the host."),
    );
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 150)));
    expect(
      vi.mocked(invoke).mock.calls.filter((call) => {
        const input = call[1] as { method?: string } | undefined;
        return input?.method === "sessions.sync" || input?.method === "sessions.page";
      }),
    ).toHaveLength(contentReads);
  },
);

it("shows a saved tail offline but requires a fresh tail page before sending", async () => {
  lazyHistorySupported = true;
  openExistingChat();
  machineDown = unreachable;
  const cached = {
    ...host!,
    history: { revision: host!.revision, totalBlocks: 4, before: 3 },
    session: { ...host!.session, blocks: [host!.session.blocks.at(-1)!] },
  };
  vi.mocked(readRemotePageCache).mockResolvedValue(cached as HostSession);
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Earlier reply"));
  expect(byLabel("Send")!.title).toContain("saved transcript preview");
  await type("verified against host");
  await act(async () => byLabel("Send")!.click());
  expect(commands.some((command) => command.type === "send")).toBe(false);
  expect(container.querySelector("textarea")!.value).toBe("verified against host");

  machineDown = undefined;
  await act(async () => notifyRemoteRecovered("env"));
  await vi.waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.some((call) => {
        const input = call[1] as { method?: string; params?: { before?: number } } | undefined;
        return input?.method === "sessions.page" && input.params?.before === undefined;
      }),
    ).toBe(true),
  );
  await vi.waitFor(() => expect(byLabel("Send")!.title).not.toContain("saved transcript preview"));
  await act(async () => byLabel("Send")!.click());
  await settle();
  expect(
    commands.some((command) => command.type === "send" && command.text === "verified against host"),
  ).toBe(true);
});
const setHost = (patch: Partial<HostSession> & { busy?: boolean }) => {
  const { busy, ...rest } = patch;
  host = {
    ...host!,
    ...rest,
    revision: host!.revision + 1,
    session: { ...host!.session, ...(busy === undefined ? {} : { busy }) },
  };
};
const endTurn = () => setHost({ status: "idle", runId: undefined, busy: false });
const sends = () => commands.filter((command) => command.type === "send");
const sentTexts = () => sends().map((command) => (command as { text: string }).text);
const queueCard = () => container.querySelector("[data-message-queue]");
const openRunningChat = () => {
  openExistingChat({ status: "running", runId: "run-1" });
  host!.session.busy = true;
};

slow("configures the restored queued model and effort before dispatch", async () => {
  openExistingChat();
  providers = ["codex", "cursor"];
  harnessSwitchSupported = true;
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  host!.session = { ...host!.session, harness: "cursor", model: cursor.id };
  savedQueue = [
    {
      id: "saved-target",
      text: "use my original effort",
      attachments: [],
      modelTarget: {
        harness: "codex",
        model: gpt.id,
        modelSettings: { reasoningEffort: "high" },
      },
    },
  ];
  await render();
  await vi.waitFor(() => expect(queueCard()?.textContent).toContain("restored"));
  await act(async () =>
    [...queueCard()!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Send next"))!
      .click(),
  );
  await vi.waitFor(() => expect(sends()).toHaveLength(1), { timeout: 8_000 });
  expect(commands[0]).toMatchObject({
    type: "configure",
    harness: "codex",
    model: gpt.id,
    modelSettings: { reasoningEffort: "high" },
  });
  expect(commands[1]).toMatchObject({
    type: "send",
    text: "use my original effort",
  });
  expect(host!.session.modelSettings).toEqual({ reasoningEffort: "high" });
});
it("shows a host turn as running from its status without requiring the transcript busy flag", async () => {
  openExistingChat({ status: "running", runId: "run-1" });
  host!.session.busy = false;
  await render();
  expect(container.textContent).toContain("Working on Home server.");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-busy")).toBe(
    "true",
  );
  expect(byLabel("Stop")).not.toBeNull();
  setHost({ status: "idle", busy: true });
  await act(async () => notifyRemoteRecovered());
  await settle();
  expect(container.textContent).not.toContain("Working on Home server.");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-busy")).toBe(
    "false",
  );
});

it("shows host activity alongside a preserved local conversation conflict", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) =>
    command === "list_claude_commands" ? [] : original(command, input),
  );
  const session = {
    ...shell(),
    cwd: "/repo",
    continuingElsewhere: true,
    adoptedSyncConflict: true,
    blocks: [{ id: "u", role: "user", text: "local edit" } as Block],
  };
  await render(session);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "running in the background",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Your messages were kept",
  );
  expect(container.textContent).toContain("local edit");
  expect(byLabel("Stop")).toBeNull();
  await render({ ...session, continuingElsewhere: undefined });
  expect(container.textContent).not.toContain("running in the background");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Your messages were kept",
  );
});

it("refreshes an adopted conversation without remounting or clearing its unsent composer", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) =>
    command === "list_claude_commands" ? [] : original(command, input),
  );
  const session = {
    ...shell(),
    cwd: "/repo",
    continuingElsewhere: true,
    adoptedSyncConflict: true,
    blocks: [{ id: "u", role: "user", text: "local edit" } as Block],
  };
  const onRefreshAdoptedSession = vi.fn(async () => true);
  await render(session, { onRefreshAdoptedSession });
  await type("my unsent draft");
  const composer = container.querySelector("textarea")!;
  const refreshButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Sync conversation",
  )!;
  await act(async () => refreshButton.click());
  expect(onRefreshAdoptedSession).toHaveBeenCalledExactlyOnceWith(session.id);
  await render(
    {
      ...session,
      continuingElsewhere: undefined,
      adoptedSyncConflict: undefined,
      blocks: [{ id: "u", role: "user", text: "latest host conversation" } as Block],
    },
    { onRefreshAdoptedSession },
  );
  expect(container.querySelector("textarea")).toBe(composer);
  expect(composer.value).toBe("my unsent draft");
  expect(container.textContent).toContain("latest host conversation");
  expect(container.textContent).toContain("(local copy)");
  // Composer drafts survive mounts; leave the next test an empty composer.
  await type("");
});
const whenStopShown = () =>
  vi.waitFor(() => expect(byLabel("Stop")).not.toBeNull(), { timeout: 4_000 });

slow("runs a !command on the host instead of sending it as a message, even mid-turn", async () => {
  shellSupported = true;
  try {
    openRunningChat();
    await render();
    await whenStopShown();
    await type("!git status");
    await act(async () => {
      container
        .querySelector("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await vi.waitFor(() => expect(commands).toHaveLength(1), {
      timeout: 4_000,
    });
    expect(commands[0]).toMatchObject({
      type: "shell",
      sessionId: "host-session",
      line: "git status",
    });
    // The staged shell-followup behavior queues the agent's continuation while
    // its current turn is busy; the shell command itself was dispatched once.
    if (queueCard()) expect(queueCard()!.textContent).toContain(SHELL_FOLLOW_UP_PROMPT);
    expect(container.querySelector("textarea")!.value).toBe("");
    // The host's block reaches the transcript with the next sync.
    await vi.waitFor(
      () => expect(container.querySelectorAll("ol[aria-label='Transcript'] li")).toHaveLength(3),
      { timeout: 4_000 },
    );
  } finally {
    shellSupported = false;
  }
});

slow("keeps a !command in the composer when the host is too old to run it", async () => {
  openExistingChat();
  await render();
  await send("!git status");
  expect(commands).toHaveLength(0);
  expect(container.querySelector("textarea")!.value).toBe("!git status");
  expect(container.textContent).toContain("Update bycoda Host");
  // The draft is remembered across mounts; leave the composer empty.
  await type("");
});

slow("queues a message sent during a host turn and sends it when the turn ends", async () => {
  openRunningChat();
  await render();
  await whenStopShown();
  await type("Also update the docs");
  await act(async () => byLabel("Queue message")!.click());
  await settle();
  expect(commands).toHaveLength(0);
  expect(queueCard()?.textContent).toContain("Also update the docs");
  expect(queueCard()?.textContent).toContain("while bycoda is open");
  // A host turn cannot be steered.
  expect(queueCard()?.textContent).not.toContain("Steer");
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(queueWrites.at(-1)).toMatchObject({
    sessionId: "host-session",
    queue: [
      expect.objectContaining({
        text: "Also update the docs",
        modelTarget: {
          harness: "codex",
          model: gpt.id,
          modelSettings: { ...host!.session.modelSettings },
        },
      }),
    ],
  });

  endTurn();
  await vi.waitFor(() => expect(sends()).toHaveLength(1), { timeout: 5_000 });
  expect(sends()[0]).toMatchObject({
    text: "Also update the docs",
    sessionId: "host-session",
  });
  await settle();
  expect(queueCard()).toBeNull();
  expect(queueWrites.at(-1)).toMatchObject({ queue: null });
});

slow("queues a plain Send while the host turn runs, and sends the messages in order", async () => {
  openRunningChat();
  await render();
  await whenStopShown();
  await type("first follow-up");
  await act(async () => byLabel("Send")!.click());
  await type("second follow-up");
  await act(async () => byLabel("Send")!.click());
  await settle();
  expect(commands).toHaveLength(0);
  expect(queueCard()?.textContent).toContain("first follow-up");
  expect(queueCard()?.textContent).toContain("second follow-up");

  endTurn();
  // The dispatch stub finishes a turn at once, so the second goes out right
  // after the first, never together with it.
  await vi.waitFor(() => expect(sends()).toHaveLength(2), { timeout: 8_000 });
  expect(sentTexts()).toEqual(["first follow-up", "second follow-up"]);
});

slow("holds the queue while the machine is unreachable and sends after it reconnects", async () => {
  openRunningChat();
  await render();
  await whenStopShown();
  await type("when you are back");
  await act(async () => byLabel("Queue message")!.click());
  await settle();

  // The turn ends while the app cannot see the host.
  endTurn();
  machineDown = unreachable;
  await vi.waitFor(() => expect(container.textContent).toContain("Can’t reach Home server"), {
    timeout: 6_000,
  });
  await settle();
  expect(commands).toHaveLength(0);
  expect(queueCard()?.textContent).toContain("when you are back");

  machineDown = undefined;
  await act(async () => notifyRemoteRecovered("env"));
  await vi.waitFor(() => expect(sends()).toHaveLength(1), { timeout: 6_000 });
  expect(sentTexts()[0]).toBe("when you are back");
});

slow("brings a saved queue back after a restart and waits for Send next", async () => {
  savedQueue = [
    { id: "q1", text: "saved one", attachments: [] },
    { id: "q2", text: "saved two", attachments: [] },
  ];
  openExistingChat();
  await render();
  await settle();
  expect(queueCard()?.textContent).toContain("2 queued messages restored");
  expect(queueCard()?.textContent).toContain("saved one");
  // The chat is idle, yet nothing is sent on its own.
  await settle();
  expect(commands).toHaveLength(0);

  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("[data-message-queue] button")]
      .find((button) => button.textContent?.includes("Send next"))!
      .click(),
  );
  await vi.waitFor(() => expect(sends()).toHaveLength(2), { timeout: 5_000 });
  expect(sentTexts()).toEqual(["saved one", "saved two"]);
});

slow("keeps one chat's queue from showing on another", async () => {
  savedQueue = [{ id: "q1", text: "belongs to the first", attachments: [] }];
  openExistingChat();
  await render();
  await settle();
  expect(queueCard()?.textContent).toContain("belongs to the first");
  savedQueue = null;
  host = { ...host!, session: { ...host!.session, id: "other-session" } };
  await act(async () => rememberRemoteSession("shell", "other-session"));
  await settle();
  expect(queueCard()).toBeNull();
});

slow(
  "holds sends after a queue read failure and retries the saved queue without overwriting it",
  async () => {
    savedQueue = [{ id: "saved", text: "Keep this stored message", attachments: [] }];
    queueReadFailed = true;
    openExistingChat();
    await renderRemoteProbe();
    expect(remoteOverrides.sendBlockedReason).toContain("Could not load queued messages");
    await act(async () => {
      expect(remoteOverrides.onSubmit!("shell", "New message", [])).toBe(false);
    });
    expect(queueWrites).toEqual([]);
    expect(commands).toEqual([]);
    queueReadFailed = false;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(remoteOverrides.session?.queuedMessages).toEqual(savedQueue);
    expect(remoteOverrides.session?.queueStatus).toBe("restored");
    expect(remoteOverrides.sendBlockedReason).toBeUndefined();
    expect(queueWrites).toEqual([]);
  },
);

slow("steers an implicit remote follow-up despite the retired queue preference", async () => {
  localStorage.setItem("bycoda.followUpBehavior", "queue");
  steerSupported = true;
  openRunningChat();
  await renderRemoteProbe();
  await act(async () => {
    expect(remoteOverrides.onSubmit!("shell", "Please change direction", [])).toBe(true);
  });
  await settle();
  expect(commands.filter((command) => command.type === "steer")).toHaveLength(1);
  expect(queueWrites).toEqual([]);
});

slow("redirects a running host turn when steering is supported", async () => {
  steerSupported = true;
  openRunningChat();
  await render();
  await whenStopShown();
  await type("Please change direction");
  await act(async () => byLabel("Send")!.click());
  await settle();
  expect(commands.filter((command) => command.type === "steer")).toHaveLength(1);
  expect(commands.find((command) => command.type === "steer")).toMatchObject({
    text: "Please change direction",
    sessionId: "host-session",
    runId: host!.runId,
  });
  expect(sends()).toHaveLength(0);
  expect(queueCard()).toBeNull();
  expect(container.querySelector("[data-composer-tips]")).not.toBeNull();
});

slow(
  "retains rejected steering once in a paused queue with its attachment and model target",
  async () => {
    steerSupported = true;
    steerFailure = "Host rejected request: The turn ended before steering arrived";
    openRunningChat();
    await renderRemoteProbe();
    await act(async () => {
      expect(
        remoteOverrides.onSubmit!("shell", "Keep this follow-up", [
          {
            id: "rejected-file",
            name: "note.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            data: "eA==",
          },
        ]),
      ).toBe(true);
    });
    await settle();
    expect(remoteOverrides.session?.queueStatus).toBe("paused");
    expect(remoteOverrides.session?.queuedMessages).toHaveLength(1);
    expect(queueWrites.at(-1)).toMatchObject({
      queue: [
        {
          text: "Keep this follow-up",
          attachments: [{ id: "rejected-file", name: "note.txt" }],
          modelTarget: { harness: "codex", model: gpt.id },
        },
      ],
    });
    expect(pendingRemoteCommand(projectKey, "env", "host-session", "shell")).toBeUndefined();
    endTurn();
    await settle();
    expect(sends()).toHaveLength(0);
  },
);

slow(
  "reserves queue space for a rejected follow-up while its attachment is uploading",
  async () => {
    steerSupported = true;
    steerFailure = "Host rejected request: steering unavailable";
    savedQueue = Array.from({ length: 99 }, (_, index) => ({
      id: `saved-${index}`,
      text: `saved ${index}`,
      attachments: [],
    }));
    openRunningChat();
    await renderRemoteProbe();
    let release!: () => void;
    attachmentReadDelay = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => {
      expect(
        remoteOverrides.onSubmit!("shell", "Preserve the refused follow-up", [
          {
            id: "reserved-file",
            name: "note.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            path: "C:/fictional/note.txt",
          },
        ]),
      ).toBe(true);
    });
    await act(async () => {
      expect(remoteOverrides.onSubmit!("shell", "No room for this message", [])).toBe(false);
    });
    await act(async () => {
      attachmentReadDelay = undefined;
      release();
    });
    await settle();
    expect(remoteOverrides.session?.queuedMessages).toHaveLength(100);
    expect(remoteOverrides.session?.queuedMessages?.at(-1)?.text).toBe(
      "Preserve the refused follow-up",
    );
    expect(remoteOverrides.session?.queueStatus).toBe("paused");
  },
);

slow(
  "keeps ambiguous steering under its original outbox ID without creating a second queued send",
  async () => {
    steerSupported = true;
    steerFailure = "The host did not confirm the request";
    openRunningChat();
    await render();
    await whenStopShown();
    await send("Verify before sending again");
    expect(queueCard()).toBeNull();
    expect(pendingRemoteCommand(projectKey, "env", "host-session", "shell")).toMatchObject({
      type: "steer",
      text: "Verify before sending again",
      runId: "run-1",
    });
    expect(sends()).toHaveLength(0);
  },
);

slow(
  "holds host-owned pending follow-up drafts and retries an undelivered draft once after the run settles",
  async () => {
    steerSupported = true;
    openRunningChat();
    const followup: Block = {
      id: "pending-redirect",
      role: "user",
      text: "Accepted follow-up",
      draft: true,
      followUpDelivery: "pending",
    };
    host = { ...host!, session: { ...host!.session, blocks: [...host!.session.blocks, followup] } };
    await renderRemoteProbe();
    await act(async () => {
      expect(
        remoteOverrides.onSubmit!("shell", followup.text, [], { draftBlockId: followup.id }),
      ).toBe(false);
      expect(remoteOverrides.onRemoveDraft!("shell", followup.id)).toBe(false);
    });
    expect(remoteOverrides.session?.queuedMessages).toBeUndefined();
    expect(commands).toHaveLength(0);
    host = {
      ...host!,
      status: "idle",
      runId: undefined,
      revision: host!.revision + 1,
      session: {
        ...host!.session,
        busy: false,
        blocks: host!.session.blocks.map((block) =>
          block.id === followup.id ? { ...block, followUpDelivery: "undelivered" } : block,
        ),
      },
    };
    await act(async () => notifyRemoteRecovered("env"));
    await settle();
    expect(remoteOverrides.session?.busy).toBe(false);
    await act(async () => {
      expect(
        remoteOverrides.onSubmit!("shell", followup.text, [], { draftBlockId: followup.id }),
      ).toBe(true);
    });
    await settle();
    expect(sends()).toEqual([
      expect.objectContaining({ text: followup.text, draftBlockId: followup.id }),
    ]);
    expect(remoteOverrides.session?.queuedMessages).toBeUndefined();
  },
);

slow(
  "Stop invalidates attachment preparation and old cleanup cannot discard a newer manual send",
  async () => {
    let releaseOld!: () => void;
    attachmentReadDelay = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    await renderRemoteProbe();
    await act(async () => {
      expect(
        remoteOverrides.onSubmit!("shell", "Stopped during upload", [
          {
            id: "preparing-file",
            name: "note.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            path: "C:/fictional/note.txt",
          },
        ]),
      ).toBe(true);
    });
    expect(remoteOverrides.session?.busy).toBe(true);
    await act(async () => remoteOverrides.onStop!("shell"));
    attachmentReadDelay = undefined;
    await act(async () => {
      expect(remoteOverrides.onSubmit!("shell", "New manual message", [])).toBe(true);
    });
    await settle();
    await act(async () => releaseOld());
    await settle();
    expect(sentTexts()).toEqual(["New manual message"]);
    expect(commands.filter((command) => command.type === "create")).toHaveLength(1);
    expect(container.textContent).not.toContain("Couldn’t send the message");
  },
);

slow(
  "Stop invalidates reconnect preparation before any conversation or turn is launched",
  async () => {
    machineDown = unreachable;
    await render();
    let release!: () => void;
    describeDelay = new Promise<void>((resolve) => {
      release = resolve;
    });
    machineDown = undefined;
    await type("Stopped while reconnecting");
    await act(async () => byLabel("Send")!.click());
    await whenStopShown();
    await act(async () => byLabel("Stop")!.click());
    await act(async () => {
      describeDelay = undefined;
      release();
    });
    for (let i = 0; i < 4; i++) await settle();
    expect(commands).toHaveLength(0);
    expect(container.textContent).toContain("Stopped while reconnecting");
  },
);

slow("Stop cancels a late accepted send by its exact receipt run ID", async () => {
  openExistingChat();
  await render();
  let release!: () => void;
  dispatchDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  receiptRunId = "accepted-run";
  await type("Acknowledgment arrives after Stop");
  await act(async () => byLabel("Send")!.click());
  await whenStopShown();
  await act(async () => byLabel("Stop")!.click());
  // An unrelated snapshot run must not become the cancellation target.
  host = { ...host!, status: "running", runId: "newer-run" };
  await act(async () => {
    dispatchDelay = undefined;
    release();
  });
  await settle();
  expect(commands.filter((command) => command.type === "cancel")).toEqual([
    expect.objectContaining({ sessionId: "host-session", runId: "accepted-run" }),
  ]);
  expect(pendingRemoteCommand(projectKey, "env", "host-session", "shell")).toBeUndefined();
});

slow("Stop reaches an acknowledged run while its first host snapshot is still unseen", async () => {
  openExistingChat();
  await render();
  let release!: () => void;
  syncDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  receiptRunId = "acknowledged-run";
  await send("Awaiting host transcript");
  await whenStopShown();
  expect(pendingRemoteCommand(projectKey, "env", "host-session", "shell")).toBeUndefined();
  await act(async () => byLabel("Stop")!.click());
  expect(commands.filter((command) => command.type === "cancel")).toEqual([
    expect.objectContaining({ sessionId: "host-session", runId: "acknowledged-run" }),
  ]);
  await act(async () => {
    syncDelay = undefined;
    release();
  });
  await settle();
});

slow("sends Stop while a steering acknowledgement is pending", async () => {
  steerSupported = true;
  openRunningChat();
  await render();
  await whenStopShown();
  let release!: () => void;
  dispatchDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await type("Please change direction");
  await act(async () => byLabel("Send")!.click());
  await settle();
  await act(async () => byLabel("Stop")!.click());
  await settle();
  expect(commands.some((command) => command.type === "cancel")).toBe(true);
  release();
  dispatchDelay = undefined;
  await settle();
});

slow("pauses the queue when the user stops the turn", async () => {
  openRunningChat();
  await render();
  await whenStopShown();
  await type("after the stop");
  await act(async () => byLabel("Queue message")!.click());
  await settle();
  await act(async () => byLabel("Stop")!.click());
  endTurn();
  await settle();
  await settle();
  expect(queueCard()?.textContent).toContain("Queue paused");
  expect(sends()).toHaveLength(0);
});

slow("re-attaches to a turn still running on the host: working, nothing sent", async () => {
  openRunningChat();
  watchRun(watchKey("env", "host-session"), "run-1");
  await render();
  await whenStopShown();
  expect(container.querySelector("ol[aria-label='Transcript']")?.getAttribute("data-busy")).toBe(
    "true",
  );
  expect(commands).toHaveLength(0);
  expect(container.querySelector("[data-interrupted-turn]")).toBeNull();
  // Output produced while the app was away arrives with the next sync, in order.
  host = {
    ...host!,
    revision: host!.revision + 1,
    session: {
      ...host!.session,
      blocks: [
        ...host!.session.blocks,
        { id: "while-away", role: "assistant", text: "Edited three files" },
      ],
    },
  };
  await vi.waitFor(() => expect(container.textContent).toContain("Edited three files"), {
    timeout: 4_000,
  });
  expect(commands).toHaveLength(0);
});

slow("shows a turn that finished while the app was away, and sends nothing", async () => {
  openExistingChat({ status: "idle" });
  watchRun(watchKey("env", "host-session"), "run-1");
  await render();
  await settle();
  expect(container.textContent).toContain("Earlier reply");
  expect(byLabel("Stop")).toBeNull();
  expect(commands).toHaveLength(0);
  expect(container.querySelector("[data-interrupted-turn]")).toBeNull();
  expect(watchedRun(watchKey("env", "host-session"))).toBeUndefined();
});

const lostTurn = () => {
  openExistingChat({ status: "interrupted", runId: "run-1" });
  host!.session.blocks = [
    { id: "old-user", role: "user", text: "Earlier message" },
    {
      id: "note",
      role: "system",
      text: "Host restarted. This turn was interrupted; inspect its work before continuing.",
    },
  ];
};
const continues = () => sentTexts().filter((text) => text === "Continue from where you left off.");

slow("continues a turn the host lost, once, when this app was watching it", async () => {
  lostTurn();
  watchRun(watchKey("env", "host-session"), "run-1");
  await render();
  await vi.waitFor(() => expect(continues()).toHaveLength(1), {
    timeout: 5_000,
  });
  await settle();
  await settle();
  expect(continues()).toHaveLength(1);
  expect(watchedRun(watchKey("env", "host-session"))).toBeUndefined();
});

slow("offers Continue instead of sending when the setting is off", async () => {
  localStorage.setItem("bycoda.autoContinueInterrupted", "0");
  lostTurn();
  watchRun(watchKey("env", "host-session"), "run-1");
  await render();
  await settle();
  await settle();
  expect(commands).toHaveLength(0);
  const notice = container.querySelector("[data-interrupted-turn]");
  expect(notice?.textContent).toContain("The host stopped this turn before it finished");
  await act(async () =>
    [...notice!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Continue"))!
      .click(),
  );
  await vi.waitFor(() => expect(continues()).toHaveLength(1), {
    timeout: 5_000,
  });
});

slow("never continues on its own when messages are queued; it offers Continue", async () => {
  savedQueue = [{ id: "q1", text: "queued already", attachments: [] }];
  lostTurn();
  watchRun(watchKey("env", "host-session"), "run-1");
  await render();
  await settle();
  await settle();
  expect(commands).toHaveLength(0);
  expect(container.querySelector("[data-interrupted-turn]")).not.toBeNull();
  expect(queueCard()?.textContent).toContain("1 queued message restored");
});

slow("does not continue a lost turn it never saw running, only offers Continue", async () => {
  lostTurn();
  await render();
  await settle();
  await settle();
  expect(commands).toHaveLength(0);
  expect(container.querySelector("[data-interrupted-turn]")).not.toBeNull();
});

it.each(["inline", "mismatched", "legacy"] as const)(
  "uses %s change delivery with a verified full snapshot",
  async (mode) => {
    inlineSyncSupported = true;
    openExistingChat();
    await render();
    await vi.waitFor(() => expect(remoteDataPhase()).toBe("ready"));
    const syncReads = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([, input]) => (input as { method?: string })?.method === "sessions.sync",
        ).length;
    const before = syncReads();
    const base = host!.revision;
    host = {
      ...host!,
      revision: base + 1,
      session: {
        ...host!.session,
        blocks: [
          ...host!.session.blocks,
          { id: "inline-reply", role: "assistant", text: "Inline host update" },
        ],
      },
    };
    const {
      session: { blocks, ...session },
      blockRevisions: _blockRevisions,
      ...value
    } = host;
    inlineDelta =
      mode === "legacy"
        ? undefined
        : {
            kind: "delta",
            base: mode === "mismatched" ? base + 10 : base,
            value: { ...value, session },
            blocks: [blocks.at(-1)!],
            blockIds: blocks.map((block) => block.id),
          };
    machineSessionRevisionHint = host.revision;
    await vi.waitFor(() => expect(container.textContent).toContain("Inline host update"));
    expect(syncReads()).toBe(mode === "inline" ? before : before + 1);
    if (mode === "inline") {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      expect(syncReads()).toBe(before);
    }
  },
);
