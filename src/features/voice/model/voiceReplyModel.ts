import { invoke } from "@tauri-apps/api/core";
import type { RemoteMachine } from "../../connections/public/protocol";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { remoteRequest } from "../../connections/public/connections";
import { resolveModelRouting } from "../../model-routing/public/choice";
import {
  HOST_MODEL_ROUTING,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import {
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import type { Session } from "../../sessions/public/session";

/** Resolve once per spoken turn. Discovery failure keeps the focused model; quota holds do not. */
export async function voiceReplyModel(session: Session): Promise<ModelRoutingTarget> {
  const fallback: ModelRoutingTarget = {
    harness: session.harness,
    model: session.model,
    providerAccountId: supportsProviderAccounts(session.harness)
      ? sessionProviderAccountId(session.harness, session)
      : undefined,
    modelSettings: session.modelSettings ?? {},
  };
  let resolution;
  try {
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    const local = machines?.find(isLocalSyncMachine);
    if (!local) return fallback;
    const host = await remoteRequest<{ capabilities?: string[] }>(
      local.id,
      "environment.describe",
      {},
    );
    if (!host.capabilities?.includes(HOST_MODEL_ROUTING)) return fallback;
    resolution = await resolveModelRouting(local.id, { role: "voice.reply" });
  } catch {
    return fallback;
  }
  if (resolution.ok) return resolution.target;
  if (resolution.reason === "notConfigured") return fallback;
  throw new Error("No eligible model is available for voice replies. Check Settings > Models.");
}
