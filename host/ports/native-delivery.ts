import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import { createNativeDeliveryStore, type NativeDeliveryKind } from "../native-delivery-store";
import type {
  NativeDeliveryOwnerPorts,
  NativeBufferDeliveryBinding,
} from "../domains/native-delivery/ports";
import type { NativeWorkspaceOwnerScope } from "../domains/native-workspaces/ports";
import type { NativeServiceOwnerPorts } from "../domains/native-services/ports";
import { HostDomainAuthorizationError } from "../domains/context";
import {
  NativeDeliveryIdentitySchema,
  NativeDeliveryResultSourceSchema,
  NativeDeliveryConsumedResultSchema,
} from "../../src/shared/model/host-contracts/native-delivery-identity";
import { NativeBufferUpdateParamsSchema } from "../../src/shared/model/host-contracts/native-workspaces";
import { NativeServiceUploadTargetSchema } from "../../src/shared/model/host-contracts/native-service-upload";
import { NATIVE_SERVICES_RPC_SCHEMAS } from "../../src/shared/model/host-contracts/native-services";
import {
  NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS,
  NativeDeliveryEpochRefSchema,
  parseNativeDeliveryEpochCompactParams,
  parseNativeDeliveryEpochDescription,
  parseNativeDeliveryEpochOriginalId,
} from "../../src/shared/model/host-contracts/native-delivery-epochs";
import { nativeDeliveryMatchesEpochFence } from "../../src/shared/model/host-contracts/native-delivery";

/** One retained paired principal; request DTOs and stored rows never mint an owner. */
export function bindNativeDeliveryOwner(
  adapters: {
    store: HostStore;
    journal: ReturnType<typeof createNativeDeliveryStore>;
    workspaceOwner: NativeWorkspaceOwnerScope;
    services: NativeServiceOwnerPorts;
  },
  principal: string,
  authorized: () => Promise<boolean>,
): NativeDeliveryOwnerPorts {
  const { store, journal } = adapters;
  const authorize = async () => {
    if (!(await authorized())) throw new HostDomainAuthorizationError();
  };
  return {
    call: (method, params, retain) =>
      store.db.withAuthorization(authorized, async () => {
        await authorize();
        if (method.startsWith("native.delivery.epochs.")) {
          retain(authorized);
          const value = await (async () => {
            if (method === "native.delivery.epochs.open") {
              const request = NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS[method].params.parse(params);
              return journal.epochs.open(principal, request.openId);
            }
            if (method === "native.delivery.epochs.status")
              return journal.epochs.status(principal, NativeDeliveryEpochRefSchema.parse(params));
            const request = parseNativeDeliveryEpochCompactParams(params);
            if (method === "native.delivery.epochs.compact")
              return journal.epochs.compact(principal, request);
            if (method === "native.delivery.epochs.close")
              return journal.epochs.close(principal, request);
            throw new HostDomainAuthorizationError();
          })();
          parseNativeDeliveryEpochDescription(value);
          retain(async () => {
            if (!(await authorized())) return false;
            const current = await journal.epochs.status(principal, {
              ownerId: value.ownerId,
              generation: value.generation,
            });
            return (
              current.openId === value.openId &&
              current.through === value.through &&
              current.closed === value.closed &&
              current.highWater >= value.highWater
            );
          });
          await authorize();
          return value;
        }
        const identity = NativeDeliveryIdentitySchema.parse({
          originalId: params.originalId,
          sha256: params.sha256,
          byteLength: params.byteLength,
        });
        const buffer = method.startsWith("native.buffers."),
          applying = method.endsWith(".apply"),
          kind: NativeDeliveryKind = buffer
            ? "buffer"
            : NativeServiceUploadTargetSchema.parse(params.target);
        const binding: NativeBufferDeliveryBinding = {
          ...identity,
          principalId: principal,
          environmentId: store.environmentId,
        };
        retain(authorized);
        if (parseNativeDeliveryEpochOriginalId(identity.originalId)) {
          const existing = await journal.readMetadata(principal, kind, identity);
          if (existing?.state === "fenced") {
            if (method.endsWith(".ack") || method.endsWith(".result.read"))
              throw new Error("Native delivery original is covered by a permanent epoch fence");
            const epoch = existing.epoch;
            retain(async () => {
              if (!(await authorized())) return false;
              const current = await journal.readMetadata(principal, kind, identity);
              return (
                current?.state === "fenced" &&
                current.epoch.ownerId === epoch.ownerId &&
                current.epoch.generation === epoch.generation &&
                current.epoch.through >= epoch.through
              );
            });
            await authorize();
            const result = {
              ...(buffer ? identity : { ...identity, target: kind }),
              state: "fenced" as const,
              epoch,
            };
            if (!nativeDeliveryMatchesEpochFence(result))
              throw new Error("Invalid native delivery epoch fence");
            return result;
          }
        }
        if (method === "native.services.delivery.result.read") {
          if (kind === "buffer") throw new Error("Invalid native service delivery target");
          const resultSource = NativeDeliveryResultSourceSchema.parse(params.resultSource),
            offset = Number(params.offset);
          const data = await journal.readResult(
            principal,
            kind,
            identity,
            resultSource,
            offset,
            Number(params.limit),
          );
          retain(async () => {
            if (!(await authorized())) return false;
            const current = await journal.readMetadata(principal, kind, identity);
            return (
              current?.state === "recorded" &&
              current.resultSource?.sha256 === resultSource.sha256 &&
              current.resultSource.byteLength === resultSource.byteLength
            );
          });
          await authorize();
          return { ...identity, target: kind, resultSource, offset, data };
        }
        if (applying) {
          if (typeof params.paramsJson !== "string")
            throw new Error("Invalid native delivery original bytes");
          const bytes = Buffer.from(params.paramsJson, "utf8");
          if (
            bytes.length !== identity.byteLength ||
            createHash("sha256").update(bytes).digest("hex") !== identity.sha256 ||
            bytes.toString("utf8") !== params.paramsJson
          )
            throw new Error("Native delivery original bytes do not match identity");
          const request: Record<string, unknown> = (
            buffer
              ? NativeBufferUpdateParamsSchema
              : NATIVE_SERVICES_RPC_SCHEMAS[kind as Exclude<NativeDeliveryKind, "buffer">].params
          ).parse(JSON.parse(params.paramsJson));
          await authorize();
          await journal.execute(principal, kind, identity, async () => {
            let result: unknown;
            if (kind === "buffer") {
              result = await adapters.workspaceOwner(async (owner) => {
                if (!owner.nativeActivity.updateBuffersWithDelivery)
                  throw new Error("Native buffer delivery owner is unavailable");
                return owner.nativeActivity.updateBuffersWithDelivery!(request as never, {
                  binding,
                  prepared: (proof) => journal.prepareProof(principal, identity, proof),
                });
              });
              if (
                !result ||
                typeof result !== "object" ||
                !("acknowledged" in result) ||
                result.acknowledged !== true
              )
                throw new Error("Native buffer acknowledgement is unavailable");
              result = { acknowledged: true };
            } else if (kind === "native.services.conversation.desktop.finish") {
              result = await adapters.services.desktop.finish(
                String(request.id),
                request.result,
                typeof request.error === "string" ? request.error : undefined,
              );
              result = NATIVE_SERVICES_RPC_SCHEMAS[kind].result.parse(result);
            } else {
              result = NATIVE_SERVICES_RPC_SCHEMAS[kind].result.parse(
                await adapters.services.format(request),
              );
            }
            await authorize();
            return result;
          });
        }
        let row = method.endsWith(".ack")
          ? await journal.readMetadata(principal, kind, identity)
          : await journal.read(principal, kind, identity);
        await authorize();
        if (method.endsWith(".ack")) {
          const consumed = NativeDeliveryConsumedResultSchema.parse(params.consumedResult);
          let verifiedProof;
          if (kind === "buffer" && row?.state !== "retired") {
            verifiedProof = row?.proof;
            if (
              !verifiedProof ||
              !(await adapters.workspaceOwner(
                async (owner) =>
                  !!owner.nativeActivity.verifyBufferDelivery &&
                  owner.nativeActivity.verifyBufferDelivery(binding, verifiedProof!),
              ))
            )
              throw new Error(
                "Native buffer delivery ACK requires exact current or archived proof",
              );
          }
          await authorize();
          await journal.retire(principal, kind, identity, consumed, verifiedProof);
          row = await journal.readMetadata(principal, kind, identity);
          await authorize();
        }
        if (!row) return { state: "absent" as const };
        const scope = buffer ? identity : { ...identity, target: kind };
        if (row.state === "retired") {
          const consumedResult = row.consumedResult!;
          retain(async () => {
            if (!(await authorized())) return false;
            const current = await journal.readMetadata(principal, kind, identity);
            return (
              current?.state === "retired" &&
              current.consumedResult?.sha256 === consumedResult.sha256 &&
              current.consumedResult.byteLength === consumedResult.byteLength
            );
          });
          await authorize();
          return { ...scope, state: "retired" as const, consumedResult };
        }
        if (kind === "buffer") {
          const proof = row.proof;
          const verify = async () => {
            await authorize();
            if (!proof) return false;
            return adapters.workspaceOwner(async (owner) => {
              if (!owner.nativeActivity.verifyBufferDelivery) return false;
              return owner.nativeActivity.verifyBufferDelivery(binding, proof);
            });
          };
          if (proof && (await verify())) {
            retain(async () => (await authorized()) && (await verify()));
            await authorize();
            return {
              ...identity,
              state: "recorded" as const,
              result: { acknowledged: true as const },
            };
          }
        } else if (row.state === "recorded") {
          const resultSource = row.resultSource;
          if (!resultSource) throw new Error("Native delivery recorded result is corrupt");
          retain(async () => {
            if (!(await authorized())) return false;
            const current = await journal.readMetadata(principal, kind, identity);
            return (
              current?.state === "recorded" &&
              current.resultSource?.sha256 === resultSource.sha256 &&
              current.resultSource.byteLength === resultSource.byteLength
            );
          });
          await authorize();
          if (!Object.hasOwn(row, "result"))
            return { ...scope, state: "recorded" as const, resultSource };
          const result = NATIVE_SERVICES_RPC_SCHEMAS[kind].result.parse(row.result);
          return { ...scope, state: "recorded" as const, result };
        }
        if (kind === "native.services.workspace.format" && row.resultUnavailable) {
          // This proves only that the exact original can never publish a result.
          // Its execution remains unknown and cannot be replayed or ACKed.
          retain(async () => {
            if (!(await authorized())) return false;
            const current = await journal.read(principal, kind, identity);
            return current?.state === "admitted" && current.resultUnavailable === true;
          });
          await authorize();
          return { ...scope, state: "unknown" as const, resultUnavailable: true as const };
        }
        await authorize();
        return { ...scope, state: "unknown" as const };
      }),
  };
}
