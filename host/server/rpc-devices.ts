import {
  desktopActorId,
  desktopOperationId,
  openDesktopResource,
  openDesktopReview,
  sealDesktopResource,
  sealDesktopReview,
  type DesktopReviewScope,
} from "../desktop/reviewed-desktop-scope";
import { readHostAccess } from "../security/access/access-center";
import { inlineSessionSync } from "../sessions/inlineSessionSync";
import { previewRewindHistory } from "../sessions/transcriptPage";
import { RemoteChanges } from "../workspaces/remoteChanges";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { WATCH_STAMP_MS } from "./support";
export async function handleDevicesRpc(
  dependencies: Pick<
    ServerBindings,
    | "nativeDevicesService"
    | "tasks"
    | "mobilePairing"
    | "engine"
    | "mobileLan"
    | "mobileAccess"
    | "tunnels"
    | "workspace"
    | "diagnostics"
    | "sharedBrowser"
    | "conversationPreviews"
    | "heldPolls"
    | "remoteChanges"
    | "desktop"
    | "sessionSourceEpoch"
    | "projectChangeSnapshot"
    | "taskChangeEtag"
    | "gitWatches"
    | "desktopRecheckMs"
    | "desktopWatch"
    | "desktopSigningSecret"
    | "scopedDesktopCall"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "devices.preview.mobile.start":
    case "devices.preview.mobile.status":
    case "devices.preview.impact":
    case "devices.setup":
    case "devices.stop":
    case "devices.status":
    case "devices.preflight":
    case "devices.preview":
    case "devices.preview.status":
    case "devices.start":
    case "devices.list":
    case "devices.boot":
    case "devices.capture":
    case "devices.control.status":
    case "devices.control.claim":
    case "devices.control.release":
    case "devices.control.renew":
    case "devices.inspect":
    case "devices.action":
      request.result = await dependencies.nativeDevicesService.call(
        request.input.method,
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;
    case "host.settings.get":
      request.result = await dependencies.tasks.limits.state();
      break;
    case "host.settings.save":
      await dependencies.tasks.limits.save(request.params.settings);
      request.result = await dependencies.tasks.limits.state();
      void dependencies.tasks
        .tick()
        .catch((error) => console.warn("Task scheduler tick failed", error));
      break;
    case "mobile.pairing.create":
      request.result = await dependencies.mobilePairing.create(request.token, request.params);
      break;
    case "mobile.pairing.status":
      request.result = await dependencies.mobilePairing.status(
        request.token,
        request.params.pairingId,
      );
      break;
    case "mobile.pairing.cancel":
      request.result = await dependencies.mobilePairing.cancel(
        request.token,
        request.params.pairingId,
      );
      break;
    case "host.access.read":
      request.result = await readHostAccess(dependencies.engine.store.environmentId, {
        devices: async () => await dependencies.engine.store.pairedDevices(request.token),
        lan: async () => await dependencies.mobileLan.status(),
        privateNetwork: async () => await dependencies.mobileAccess.status(),
        tunnels: async () => await dependencies.tunnels.status(),
      });
      break;
    case "devices.revokeOther":
      if (
        Object.keys(request.params).some((key) => key !== "id") ||
        typeof request.params.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(request.params.id)
      )
        throw new Error("Invalid paired device identity");
      request.result = {
        revoked: await dependencies.engine.store.revokeOtherDevice(
          String(request.params.id),
          request.token,
        ),
      };
      break;
    case "mobile.access.status":
      if (
        request.params.mode !== undefined &&
        !["lan", "tailscale"].includes(String(request.params.mode))
      )
        throw new Error("Invalid phone connection mode.");
      request.result =
        request.params.mode === "lan"
          ? await dependencies.mobileLan.status()
          : await dependencies.mobileAccess.status();
      break;
    case "mobile.access.enable":
      if (
        request.params.mode !== undefined &&
        !["lan", "tailscale"].includes(String(request.params.mode))
      )
        throw new Error("Invalid phone connection mode.");
      request.result =
        request.params.mode === "lan"
          ? await dependencies.mobileLan.enable(request.params.address)
          : await dependencies.mobileAccess.enable();
      break;
    case "mobile.access.disable":
      if (request.params.mode !== "lan")
        throw new Error("Only local network access can be disabled here.");
      request.result = await dependencies.mobileLan.disable();
      break;
    case "tunnels.status":
      request.result = await dependencies.tunnels.status();
      break;
    case "tunnels.start":
      request.result = await dependencies.tunnels.start(request.params);
      break;
    case "tunnels.stop":
      request.result = await dependencies.tunnels.stop(request.params);
      break;
    case "tunnels.credential":
      request.result = await dependencies.tunnels.credential(request.params);
      break;
    case "devices.revokeSelf":
      dependencies.workspace.cancelSearches(request.tokenHash);
      dependencies.diagnostics.revoke(request.token);
      dependencies.sharedBrowser.revoke(request.token);
      dependencies.conversationPreviews.revoke(request.tokenHash);
      // Only the caller's own credential. Sessions and other devices
      // are unaffected; the host keeps running.
      request.result = {
        revoked: await dependencies.engine.store.revokeToken(request.token),
      };
      break;
    case "machine.changes": {
      dependencies.heldPolls.set(request.pollState, request.token);
      request.response.once("close", () => {
        dependencies.heldPolls.delete(request.pollState);
      });
      const inlineSessionIds = request.params.inlineSessionIds;
      if (
        inlineSessionIds !== undefined &&
        (!Array.isArray(inlineSessionIds) ||
          inlineSessionIds.length > 64 ||
          inlineSessionIds.some(
            (id) => typeof id !== "string" || id.length === 0 || id.length > 1024,
          ))
      )
        throw new Error("Invalid inline session selection");
      request.result = await dependencies.remoteChanges.read(
        {
          inlineSync: request.params.inlineSync === true,
          instanceId:
            typeof request.params.instanceId === "string" ? request.params.instanceId : undefined,
          sessions: Array.isArray(request.params.sessions)
            ? (request.params.sessions as {
                sessionId: string;
                revision: number;
                sourceEpoch?: string;
              }[])
            : [],
          projects: Array.isArray(request.params.projects)
            ? (request.params.projects as { projectId: string; known?: string }[])
            : [],
          tasksKnown:
            typeof request.params.tasksKnown === "string" ? request.params.tasksKnown : undefined,
          git: Array.isArray(request.params.git)
            ? (request.params.git as { cwd: string; known?: string }[])
            : undefined,
          waitMs: Number(request.params.waitMs),
          demandChanged: request.params.demandChanged === true,
        },
        async (sessionId) => {
          const known = await dependencies.engine.store.sessionStateMetadata(sessionId);
          if (!known && !(await dependencies.desktop.stampAsync(sessionId, WATCH_STAMP_MS)))
            return undefined;
          const epoch = await dependencies.sessionSourceEpoch(sessionId);
          const host = await dependencies.engine.store.sessionStateMetadata(sessionId);
          if (host && (!host.desktop || host.status === "running")) {
            if (epoch !== (await dependencies.sessionSourceEpoch(sessionId)))
              throw new Error("Session read owner changed; retry");
            return { revision: host.revision, sourceEpoch: epoch };
          }
          // A change-poll tick: a fraction-of-a-second old read is fine.
          const stamp = await dependencies.desktop.stampAsync(sessionId, WATCH_STAMP_MS);
          if (!host && !stamp) return undefined;
          if (host && (!stamp || !stamp.running)) {
            if (epoch !== (await dependencies.sessionSourceEpoch(sessionId)))
              throw new Error("Session read owner changed; retry");
            return { revision: host.revision, sourceEpoch: epoch };
          }
          const overlay = dependencies.desktop.live.overlay(sessionId);
          const revision = Math.max(
            stamp?.updatedAt ?? host?.revision ?? 0,
            overlay?.changedAt ?? 0,
          );
          if (epoch !== (await dependencies.sessionSourceEpoch(sessionId)))
            throw new Error("Session read owner changed; retry");
          return { revision, sourceEpoch: epoch };
        },
        dependencies.projectChangeSnapshot,
        () => request.closing || request.response.destroyed || request.pollState.revoked,
        dependencies.taskChangeEtag,
        async (cwd) => await dependencies.gitWatches.read(cwd),
        async () =>
          Array.isArray(request.params.sessions) &&
          (
            await Promise.all(
              request.params.sessions.map(
                async (entry: { sessionId: string }) =>
                  await dependencies.desktopRecheckMs(entry.sessionId),
              ),
            )
          ).some((duration) => duration === WATCH_STAMP_MS)
            ? WATCH_STAMP_MS
            : 1000,
        request.tokenHash,
        () => dependencies.engine.store.authenticated(request.token),
      );
      request.result = await inlineSessionSync(
        {
          inlineSync: request.params.inlineSync === true,
          inlineSessionIds: inlineSessionIds as string[] | undefined,
          sessions: request.params.sessions as {
            sessionId: string;
            revision: number;
            sourceEpoch?: string;
          }[],
          projects: [],
        },
        request.result as Awaited<ReturnType<RemoteChanges["read"]>>,
        async (id, revision) => {
          // Desktop rows may require transcript IO. Keep those on sessions.sync.
          const metadata = await dependencies.engine.store.sessionStateMetadata(id);
          if (!metadata || (await dependencies.desktopWatch(id, true))) return undefined;
          const sourceEpoch = await dependencies.sessionSourceEpoch(id);
          const sync = await dependencies.engine.store.sync(id, revision);
          if (sourceEpoch !== (await dependencies.sessionSourceEpoch(id))) return undefined;
          return sync.kind === "delta"
            ? {
                ...sync,
                value: {
                  ...sync.value,
                  sourceEpoch,
                  session: {
                    ...sync.value.session,
                    ...previewRewindHistory(sync.value.session),
                  },
                },
              }
            : undefined;
        },
      );
      if (!(await dependencies.engine.store.authenticated(request.token)))
        throw new Error("Device authorization was revoked");
      break;
    }
    case "ssh.workspace.catalog.read":
    case "ssh.workspace.review":
    case "ssh.workspace.approve":
    case "ssh.workspace.status":
    case "ssh.workspace.close.review":
    case "ssh.workspace.close.approve": {
      const mode = request.input.method.slice("ssh.workspace.".length);
      const secret = await dependencies.desktopSigningSecret();
      const scope: DesktopReviewScope = {
        environmentId: dependencies.engine.store.environmentId,
        projectId: String(request.params.projectId ?? ""),
        sessionId: String(request.params.sessionId ?? ""),
        feature: "ssh-workspace",
      };
      const fields =
        mode === "catalog.read"
          ? []
          : mode === "review"
            ? ["connectionId"]
            : mode === "close.review"
              ? ["workspaceId"]
              : mode === "status"
                ? ["requestId", "workspaceId"]
                : ["reviewId", "requestId"];
      if (
        mode === "status" &&
        Object.hasOwn(request.params, "requestId") === Object.hasOwn(request.params, "workspaceId")
      )
        throw new Error("SSH status requires exactly one owned identity");
      const bound = { ...request.params };
      if (Object.hasOwn(request.params, "requestId"))
        bound.requestId = desktopOperationId(
          secret,
          request.token,
          scope,
          request.params.requestId,
        );
      if (Object.hasOwn(request.params, "reviewId"))
        bound.reviewId = openDesktopReview(secret, request.token, scope, request.params.reviewId);
      if (Object.hasOwn(request.params, "workspaceId"))
        bound.workspaceId = openDesktopResource(
          secret,
          request.token,
          scope,
          "workspace",
          request.params.workspaceId,
        );
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        request.input.method,
        bound,
        fields,
        {
          actorId: desktopActorId(secret, request.token, scope),
        },
      );
      if (!request.result || typeof request.result !== "object" || Array.isArray(request.result))
        throw new Error("Invalid SSH workspace response");
      const response = { ...(request.result as Record<string, unknown>) };
      if (mode === "review" || mode === "close.review")
        response.reviewId = sealDesktopReview(
          secret,
          request.token,
          scope,
          response.reviewId,
          response.expiresAt,
        );
      if (Object.hasOwn(response, "workspaceId"))
        response.workspaceId = sealDesktopResource(
          secret,
          request.token,
          scope,
          "workspace",
          response.workspaceId,
        );
      request.result = response;
      break;
    }
  }
}
