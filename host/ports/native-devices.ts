import { createHash } from "node:crypto";
import type { DeviceHost } from "../devices/device-host";
import { deviceActionArgs } from "../devices/device-host";
import type { DevicePreviews } from "../devices/device-preview";
import type { HostStore } from "../store";
import { validateConversationTool } from "../conversation/conversation-tools";
import { HostDomainAuthorizationError } from "../domains/context";
import type { NativeDeviceOwnerPorts } from "../domains/native-devices/ports";
import type {
  DeviceAction,
  DevicePreviewInput,
  DevicePreviewImpact,
} from "../../src/shared/model/host-contracts/native-devices";

export function bindNativeDevicesOwner(
  adapters: { store: HostStore; host: DeviceHost; previews: DevicePreviews },
  principal: string,
  authorized: () => Promise<boolean>,
): NativeDeviceOwnerPorts {
  const { store, host, previews } = adapters;
  // No caller-supplied owner/deadline can broaden this original paired grant.
  return {
    call: (method, params, retain, effectAdmitted) =>
      store.db.withAuthorization(authorized, async () => {
        if (!(await authorized())) throw new HostDomainAuthorizationError();
        const project =
          params.projectId === undefined
            ? undefined
            : await store.project(String(params.projectId ?? ""));
        const effect = { authorized };
        let result: unknown;
        if (
          method === "devices.preview.mobile.start" ||
          method === "devices.preview.mobile.status" ||
          method === "devices.preview.impact"
        ) {
          const starting = method === "devices.preview.mobile.start",
            impact = method === "devices.preview.impact";
          const allowed = [
            "projectId",
            ...(starting
              ? ["requestId", "deviceId", "url", "installExpoGo", "expectedText"]
              : impact
                ? []
                : ["id", "requestId", "includeFrame"]),
          ];
          if (
            typeof params.projectId !== "string" ||
            !project ||
            Object.keys(params).some((key) => !allowed.includes(key))
          )
            throw new Error("Invalid mobile device preview scope");
          // Preserve the existing paired-owner namespace across HTTP and WS.
          // SQL registration is cwd continuity, not a desktop visibility proof.
          const owner = `mobile:${principal}:${project.id}`;
          const live = async () => {
            try {
              return (await authorized()) && (await store.project(project.id)).cwd === project.cwd;
            } catch {
              return false;
            }
          };
          const originals: Array<() => Promise<boolean>> = [];
          if (!(await live())) throw new HostDomainAuthorizationError();
          if (impact) {
            const snapshot = previews.stopImpact(owner),
              owned: DevicePreviewImpact["owned"] = [];
            for (const row of snapshot.owned) {
              const original = previews.resultAuthority(row.id, owner);
              if ((await original()) && (row.state === "queued" || row.state === "running")) {
                owned.push({ ...row, state: row.state });
                originals.push(original);
              }
            }
            result = {
              activeCount: snapshot.activeCount,
              owned,
              otherActiveCount: snapshot.activeCount - owned.length,
            };
          } else {
            const { projectId: _projectId, ...args } = params;
            if (starting) {
              validateConversationTool("devices.preview", args);
              result = previews.start(args as DevicePreviewInput, owner, live);
              effectAdmitted?.();
            } else {
              const id = (value: unknown) =>
                typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
              if (
                (!id(args.id) && !id(args.requestId)) ||
                (args.id !== undefined && !id(args.id)) ||
                (args.requestId !== undefined && !id(args.requestId)) ||
                (args.includeFrame !== undefined && typeof args.includeFrame !== "boolean")
              )
                throw new Error("Invalid mobile device preview identity");
              // Resolve only a small summary before checking original authority.
              const summary = previews.mobileStatus(
                owner,
                {
                  ...(args.id === undefined ? {} : { id: args.id as string }),
                  ...(args.requestId === undefined ? {} : { requestId: args.requestId as string }),
                },
                false,
              );
              result = await previews.authorizedStatus(
                summary.id,
                owner,
                args.includeFrame === true,
                live,
              );
            }
            originals.push(previews.resultAuthority((result as { id: string }).id, owner));
          }
          const resultAuthority = !impact
            ? originals[0]
            : async () => {
                if (!(await live())) return false;
                for (const check of originals) if (!(await check())) return false;
                // Recheck original callbacks after current-project async lookups too.
                if (!(await live())) return false;
                for (const check of originals) if (!(await check())) return false;
                return true;
              };
          retain(resultAuthority);
          if (!(await resultAuthority())) throw new HostDomainAuthorizationError();
        } else if (method === "devices.preview" || method === "devices.preview.status") {
          const { previewOwner, previewExpiresAt, projectId: _projectId, ...args } = params;
          if (
            previewOwner !== undefined &&
            (typeof previewOwner !== "string" || previewOwner.length > 1024)
          )
            throw new Error("Invalid preview owner hint");
          if (
            previewExpiresAt !== undefined &&
            (!Number.isSafeInteger(previewExpiresAt) || Number(previewExpiresAt) < 0)
          )
            throw new Error("Invalid preview expiry");
          validateConversationTool(method, args);
          const owner =
            "paired:" +
            createHash("sha256")
              .update(
                JSON.stringify([store.environmentId, principal, previewOwner ?? "native-owner"]),
              )
              .digest("hex");
          const live = async () =>
            (await authorized()) &&
            (previewExpiresAt === undefined || Date.now() < Number(previewExpiresAt));
          if (!(await live())) throw new HostDomainAuthorizationError();
          result =
            method === "devices.preview"
              ? previews.start(args as DevicePreviewInput, owner, live)
              : await previews.authorizedStatus(
                  String(args.id),
                  owner,
                  args.includeFrame === true,
                  live,
                );
          if (method === "devices.preview") effectAdmitted?.();
          const original = previews.resultAuthority((result as { id: string }).id, owner);
          // A caller may further shorten its own result; original authority is checked last.
          retain(
            previewExpiresAt === undefined
              ? original
              : async () => (await live()) && (await original()),
          );
          if (!(await original()) || !(await live())) throw new HostDomainAuthorizationError();
        } else {
          retain(authorized);
          if (method === "devices.setup" && typeof params.agentAccess !== "boolean")
            throw new Error("Choose whether agents may control devices");
          if (
            method === "devices.boot" ||
            method === "devices.capture" ||
            method === "devices.control.status" ||
            method === "devices.control.claim" ||
            method === "devices.control.release" ||
            method === "devices.control.renew" ||
            method === "devices.inspect" ||
            method === "devices.action"
          ) {
            const id = String(params.deviceId ?? "");
            if (!id || id.length > 200) throw new Error("Invalid device ID");
            if (method === "devices.action") deviceActionArgs(params.action as DeviceAction);
          }
          if (
            method === "devices.setup" ||
            method === "devices.start" ||
            method === "devices.boot" ||
            method === "devices.capture"
          )
            effectAdmitted?.();
          if (method === "devices.status") result = await host.status(effect);
          else if (method === "devices.list") result = await host.list(effect);
          else if (method === "devices.preflight")
            result = await host.preflight(params.deviceId as string | undefined, effect);
          else if (method === "devices.start") result = await host.start(effect);
          else if (method === "devices.setup") {
            if (typeof params.agentAccess !== "boolean")
              throw new Error("Choose whether agents may control devices");
            result = await host.setup(params.agentAccess, effect);
          } else if (method === "devices.stop")
            result = await previews.stopIdle(() => {
              effectAdmitted?.();
              return host.stop(effect);
            });
          else if (method === "devices.boot")
            result = await host.boot(String(params.deviceId ?? ""), effect);
          else if (method === "devices.capture")
            result = await host.capture(String(params.deviceId ?? ""), effect);
          else if (method === "devices.control.status")
            result = await host.control.status(String(params.deviceId));
          else if (method === "devices.inspect") {
            const deviceId = String(params.deviceId),
              owner = `paired:${principal}`,
              leaseId = String(params.leaseId ?? "");
            const leasedEffect = {
              authorized: async () => {
                if (!(await authorized())) return false;
                try {
                  await host.control.assert(deviceId, owner, leaseId);
                  return true;
                } catch {
                  return false;
                }
              },
            };
            await host.control.assert(deviceId, owner, leaseId);
            result = await host.inspect(deviceId, `${owner}:${leaseId}`, leasedEffect);
          } else if (method === "devices.control.claim") {
            result = await host.control.claim(
              String(params.deviceId),
              `paired:${principal}`,
              String(params.requestId ?? ""),
              authorized,
            );
            effectAdmitted?.();
          } else if (method === "devices.control.release") {
            result = await host.control.release(
              String(params.deviceId),
              `paired:${principal}`,
              String(params.leaseId ?? ""),
            );
            effectAdmitted?.();
          } else if (method === "devices.control.renew") {
            result = await host.control.renew(
              String(params.deviceId),
              `paired:${principal}`,
              String(params.leaseId ?? ""),
            );
            effectAdmitted?.();
          } else {
            const deviceId = String(params.deviceId ?? ""),
              owner = `paired:${principal}`,
              leaseId = String(params.leaseId ?? "");
            result = await host.control.execute(
              deviceId,
              owner,
              leaseId,
              String(params.requestId ?? ""),
              params.action,
              async (track) => {
                const leasedEffect = {
                  track,
                  authorized: async () => {
                    if (!(await authorized())) return false;
                    try {
                      await host.control.assert(deviceId, owner, leaseId);
                      return true;
                    } catch {
                      return false;
                    }
                  },
                };
                effectAdmitted?.();
                return host.action(
                  deviceId,
                  params.action as DeviceAction,
                  leasedEffect,
                  `${owner}:${leaseId}`,
                );
              },
              effectAdmitted,
            );
          }
        }
        if (!(await authorized())) throw new HostDomainAuthorizationError();
        return result;
      }),
  };
}
