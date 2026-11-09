import { type NativeBufferUploadMethod } from "../../src/shared/model/host-contracts/native-buffer-upload";
import { type NativeDeliveryMethod } from "../../src/shared/model/host-contracts/native-delivery";
import { type NativeServiceUploadMethod } from "../../src/shared/model/host-contracts/native-service-upload";
import { type NativeServiceMethod } from "../../src/shared/model/host-contracts/native-services";
import { type NativeWorkspaceMethod } from "../../src/shared/model/host-contracts/native-workspaces";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleNativeRpc(
  dependencies: Pick<
    ServerBindings,
    | "nativeWorkspacesService"
    | "nativeDeliveryService"
    | "nativeBufferUploads"
    | "nativeServiceUploads"
    | "nativeServicesService"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "native.turn.begin":

    case "native.turn.end":

    case "native.activity.start":

    case "native.activity.end":

    case "native.buffers.update":

    case "native.buffers.heartbeat":

    case "native.buffers.retire":

    case "native.buffers.reconcile":

    case "native.buffers.recovery.list":

    case "native.buffers.recovery.read":

    case "native.buffers.recovery.status":

    case "native.rewind.plan":

    case "native.rewind.prepare":

    case "native.rewind.apply":

    case "native.rewind.status":

    case "native.rewind.lookup":

    case "native.rewind.cancelPreparation":

    case "native.rewind.ack":

    case "workspaces.cleanup.plan":

    case "workspaces.cleanup.apply":

    case "workspaces.cleanup.status": {
      request.result = await dependencies.nativeWorkspacesService.call(
        request.input.method as NativeWorkspaceMethod,
        request.params,
        request.domainContext,
        {
          legacy: !request.input.method.startsWith("native.buffers.recovery."),
        },
      );
      break;
    }

    case "native.buffers.delivery.apply":

    case "native.delivery.epochs.open":

    case "native.delivery.epochs.status":

    case "native.delivery.epochs.compact":

    case "native.delivery.epochs.close":

    case "native.buffers.delivery.status":

    case "native.buffers.delivery.ack":

    case "native.services.delivery.apply":

    case "native.services.delivery.status":

    case "native.services.delivery.ack":

    case "native.services.delivery.result.read":
      request.result = await dependencies.nativeDeliveryService.call(
        request.input.method as NativeDeliveryMethod,
        request.params,
        request.domainContext,
      );
      break;

    case "native.buffers.upload.start":

    case "native.buffers.upload.write":

    case "native.buffers.upload.commit":

    case "native.buffers.upload.status":

    case "native.buffers.upload.abort": {
      request.result = await dependencies.nativeBufferUploads.call(
        request.input.method as NativeBufferUploadMethod,
        request.params,
        request.domainContext,
      );
      break;
    }

    case "native.services.upload.begin":

    case "native.services.upload.append":

    case "native.services.upload.commit":

    case "native.services.upload.status":

    case "native.services.upload.cancel": {
      request.result = await dependencies.nativeServiceUploads.call(
        request.input.method as NativeServiceUploadMethod,
        request.params,
        request.domainContext,
      );
      break;
    }

    case "native.services.desktop.stop":

    case "native.services.assistant.delegation.publicKey":

    case "native.services.assistant.observations.ingest":

    case "native.services.assistant.delegation.origin":

    case "native.services.assistant.delegation.nativeChallenge":

    case "native.services.assistant.delegation.attest":

    case "native.services.assistant.delegation.issue":

    case "native.services.assistant.delegation.issue.status":

    case "native.services.assistant.delegation.challenge":

    case "native.services.assistant.delegation.call":

    case "native.services.assistant.delegation.revoke":

    case "native.services.assistant.presence.get":

    case "native.services.assistant.visibility.epoch":

    case "native.services.assistant.notification.authorize":

    case "native.services.assistant.workspace.authorize":

    case "native.services.assistant.browser.panel":

    case "native.services.assistant.visibility.revoke":

    case "native.services.assistant.visibility.reopen":

    case "native.services.assistant.presence.set":

    case "native.services.desktop.status":
    case "native.services.desktop.status.wait":

    case "native.services.runtimeLogs.bridge.describe":

    case "native.services.runtimeLogs.access.issue":

    case "native.services.runtimeLogs.terminals.append":

    case "native.services.conversation.bridge.describe":

    case "native.services.conversation.access.issue":

    case "native.services.conversation.desktop.take":

    case "native.services.conversation.desktop.finish":

    case "native.services.conversation.desktop.authorize":

    case "native.services.social.bridge.describe":

    case "native.services.social.access.issue":

    case "native.services.social.native.status":

    case "native.services.social.native.enroll":

    case "native.services.social.native.register":

    case "native.services.social.native.authority":

    case "native.services.social.native.reset":

    case "native.services.workspace.format": {
      request.result = await dependencies.nativeServicesService.call(
        request.input.method as NativeServiceMethod,
        request.params,
        request.domainContext,
      );
      break;
    }
  }
}
