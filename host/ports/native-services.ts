import { basename } from "node:path";
import type { HostStore } from "../store";
import type { SocialService } from "../social/social";
import type { SocialPeers } from "../social/social-peers";
import type { RuntimeLogAccess } from "../execution/runtime-log-tools";
import type { RuntimeTerminalLogs } from "../execution/runtime-terminal-logs";
import type { ConversationDesktopRelay } from "../conversation/conversation-tools";
import type { HostDesktopControl } from "../desktop/desktop-control-host";
import type { WorkspaceCommands } from "../workspaces/workspace-commands";
import type {
  NativeServiceKind,
  NativeServiceOwnerPorts,
  NativeAssistantPresence,
} from "../domains/native-services/ports";
import { HostDomainAuthorizationError } from "../domains/context";
import { assertNativeDeliveryEffect } from "../native-delivery/native-delivery-epochs";

export interface NativeServicesAdapters {
  browserPanel?(input: Record<string, unknown>): Promise<unknown>;
  observationsIngest?(input: Record<string, unknown>): Promise<unknown>;
  delegation?(
    action:
      | "publicKey"
      | "origin"
      | "nativeChallenge"
      | "attest"
      | "issue"
      | "issue.status"
      | "challenge"
      | "call"
      | "revoke",
    input: Record<string, unknown>,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  visibilityEpoch?(): Promise<{ epoch: number }>;
  visibilityRevoke?(): Promise<{ epoch: number }>;
  visibilityReopen?(
    input: Record<string, unknown>,
    authorized: () => Promise<boolean>,
  ): Promise<{ epoch: number }>;
  authorizeAssistantNotification?(input: {
    threadId: string;
    notificationId: string;
    operationHash: string;
  }): Promise<boolean>;
  authorizeAssistantWorkspace?(input: {
    threadId: string;
    requestId: string;
    operationHash: string;
  }): Promise<boolean>;
  store: HostStore;
  social: SocialService;
  peers: SocialPeers;
  conversation: RuntimeLogAccess;
  runtimeLogs: RuntimeLogAccess;
  terminalLogs: RuntimeTerminalLogs;
  desktop: ConversationDesktopRelay;
  desktopControl?: Pick<HostDesktopControl, "request" | "indicatorStatus"> &
    Partial<Pick<HostDesktopControl, "statusChanges">>;
  assistantName?(): Promise<string>;
  assistantPresence?(): Promise<NativeAssistantPresence>;
  setAssistantPresence?(state: "present" | "away" | "dnd"): Promise<void>;
  workspace: WorkspaceCommands;
  inHost(sessionId: string): Promise<boolean>;
  desktopProjectCwd(sessionId: string): Promise<string | null | undefined>;
  describe(kind: NativeServiceKind): Promise<unknown>;
}

/** Device identity and the real grant are captured by authenticated composition.
 * Neither RPC params nor a scoped-tool principal can manufacture these ports. */
export function bindNativeServicesOwner(
  adapters: NativeServicesAdapters,
  deviceHash: string,
  authorized: () => Promise<boolean>,
): NativeServiceOwnerPorts {
  const guarded = <T>(action: () => Promise<T>): Promise<T> =>
    adapters.store.db.withAuthorization(authorized, async () => {
      if (!(await authorized())) throw new HostDomainAuthorizationError();
      const value = await action();
      if (!(await authorized())) throw new HostDomainAuthorizationError();
      return value;
    });
  const sessionProject = async (sessionId: string) => {
    if (!(await adapters.inHost(sessionId))) {
      const cwd = await adapters.desktopProjectCwd(sessionId);
      if (cwd) await adapters.store.addProject(cwd, basename(cwd));
    }
  };
  const presence = async () => {
    if (!adapters.assistantPresence) throw new Error("Native assistant presence is unavailable.");
    const { state, choice, setupComplete, assistantName } = await adapters.assistantPresence();
    return {
      state,
      ...(choice ? { choice } : {}),
      setupComplete,
      ...(assistantName ? { assistantName: assistantName.slice(0, 80) } : {}),
    };
  };
  return {
    delegation: async (action, input) => {
      if (!adapters.delegation || !(await authorized())) throw new HostDomainAuthorizationError();
      const value = await adapters.delegation(action, input, authorized);
      if (!(await authorized())) throw new HostDomainAuthorizationError();
      return value;
    },
    // These callbacks never acquire the SQL owner: revoke must drain effects
    // which may themselves be waiting on that owner.
    visibilityEpoch: async () => {
      if (!(await authorized()) || !adapters.visibilityEpoch)
        throw new HostDomainAuthorizationError();
      return adapters.visibilityEpoch();
    },
    visibilityRevoke: async () => {
      if (!(await authorized()) || !adapters.visibilityRevoke)
        throw new HostDomainAuthorizationError();
      return adapters.visibilityRevoke();
    },
    visibilityReopen: async (input) => {
      if (!(await authorized()) || !adapters.visibilityReopen)
        throw new HostDomainAuthorizationError();
      return adapters.visibilityReopen(input, authorized);
    },
    authorizeAssistantNotification: async (input) => {
      if (!(await authorized()) || !adapters.authorizeAssistantNotification)
        throw new HostDomainAuthorizationError();
      return {
        authorized: (await adapters.authorizeAssistantNotification(input)) && (await authorized()),
      };
    },
    browserPanel: async (input) => {
      if (!adapters.browserPanel)
        throw new Error("Room browser panel requires a scoped native response transport.");
      return guarded(() => adapters.browserPanel!(input));
    },
    observationsIngest: async (input) => {
      if (!adapters.observationsIngest) throw new Error("Native observation owner is unavailable.");
      return guarded(() => adapters.observationsIngest!(input));
    },
    authorizeAssistantWorkspace: async (input) => {
      if (!(await authorized()) || !adapters.authorizeAssistantWorkspace)
        throw new HostDomainAuthorizationError();
      return {
        authorized: (await adapters.authorizeAssistantWorkspace(input)) && (await authorized()),
      };
    },
    assistantPresence: () => guarded(presence),
    setAssistantPresence: (state) =>
      guarded(async () => {
        if (!adapters.setAssistantPresence)
          throw new Error("Native assistant presence is unavailable.");
        await adapters.setAssistantPresence(state);
        return presence();
      }),
    describe: (kind) => guarded(() => adapters.describe(kind)),
    issue: (kind, sessionId, expectedScope) =>
      guarded(async () => {
        if (
          kind === "social" &&
          expectedScope !== undefined &&
          (await adapters.social.isDelegated?.())
        )
          throw new Error("Delegated social grants require an explicit reconnect.");
        await sessionProject(sessionId);
        const delegated =
          kind === "social" ? await adapters.social.remoteAccess?.(sessionId) : undefined;
        const access = delegated ?? {
          ...(await (
            kind === "social"
              ? adapters.social
              : kind === "conversation"
                ? adapters.conversation
                : adapters.runtimeLogs
          ).issueSessionGrant(sessionId, deviceHash, expectedScope)),
          environmentId: adapters.store.environmentId,
        };
        return { ...access, command: process.execPath, args: [process.argv[1]] };
      }),
    terminalDemand: (params) =>
      guarded(async () => {
        const cwd = String(params.cwd ?? "");
        if (!cwd || cwd.length > 4096) throw new Error("Terminal project directory is required");
        if (
          typeof params.terminalId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(params.terminalId)
        )
          throw new Error("Invalid terminal log stream");
        const project = (await adapters.store.projects()).find((entry) => entry.cwd === cwd);
        return adapters.terminalLogs.demand(project?.id ?? "");
      }),
    appendTerminal: (params) =>
      guarded(async () => {
        const cwd = String(params.cwd ?? "");
        if (!cwd || cwd.length > 4096) throw new Error("Terminal project directory is required");
        const project =
          (await adapters.store.projects()).find((entry) => entry.cwd === cwd) ??
          (await adapters.store.addProject(cwd, basename(cwd)));
        return adapters.terminalLogs.append(project.id, params);
      }),
    desktopStatus: () =>
      guarded(async () => {
        if (!adapters.desktopControl) throw new Error("Native desktop status is unavailable.");
        const { enabled, active, stopped, currentAction } =
          await adapters.desktopControl.indicatorStatus(
            { kind: "owner", id: deviceHash },
            authorized,
          );
        const assistantName = (await adapters.assistantName?.())?.slice(0, 80);
        return {
          enabled,
          active,
          stopped,
          ...(currentAction
            ? {
                currentAction: {
                  app: currentAction.app.slice(0, 200),
                  action: currentAction.action.slice(0, 80),
                },
              }
            : {}),
          ...(assistantName ? { assistantName } : {}),
        };
      }),
    waitDesktopStatus: async (afterRevision, timeoutMs, signal) => {
      const changes = adapters.desktopControl?.statusChanges;
      if (!changes || !(await authorized())) throw new HostDomainAuthorizationError();
      const revision = await changes.wait(afterRevision, timeoutMs, signal, deviceHash);
      if (signal?.aborted || !(await authorized())) throw new HostDomainAuthorizationError();
      return { revision };
    },
    stopDesktop: () =>
      guarded(async () => {
        if (!adapters.desktopControl) throw new Error("Native desktop Stop is unavailable.");
        await adapters.desktopControl.request(
          { op: "stop" },
          { kind: "owner", id: deviceHash },
          authorized,
        );
        return { stopped: true as const };
      }),
    desktop: {
      take: () => guarded(() => adapters.desktop.take(deviceHash)),
      finish: (id, result, error) =>
        guarded(async () => {
          await assertNativeDeliveryEffect(
            adapters.store,
            deviceHash,
            "native.services.conversation.desktop.finish",
          );
          return adapters.desktop.finish(id, result, error, deviceHash);
        }),
      authorize: (id, action) => guarded(() => adapters.desktop.authorize(id, action, deviceHash)),
    },
    social: {
      status: () => guarded(() => adapters.peers.status()),
      enroll: (environmentId) => guarded(() => adapters.peers.enroll(environmentId, deviceHash)),
      register: (params) => guarded(() => adapters.peers.register(params, deviceHash)),
      authority: (params) => guarded(() => adapters.peers.useAuthority(params)),
      reset: () => guarded(() => adapters.peers.resetAuthority()),
    },
    format: (params) =>
      guarded(async () => {
        await assertNativeDeliveryEffect(
          adapters.store,
          deviceHash,
          "native.services.workspace.format",
        );
        return (await adapters.workspace.run("format_text_file", params.args, deviceHash)) ?? null;
      }),
  };
}
