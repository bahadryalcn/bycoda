import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import type { z } from "zod";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  AssistantAvatarGenerateResultSchema,
  AssistantAvatarReadResultSchema,
  AssistantProfileInterviewParamsSchema,
  AssistantProfileInterviewResultSchema,
  type AssistantProfileInterviewResult,
} from "../../../shared/model/host-contracts/assistant-builder";

export type AssistantInterviewParams = z.infer<typeof AssistantProfileInterviewParamsSchema>;
export type AssistantAvatarProvider = "codex" | "gemini";

/** The builder always runs on this desktop's own Host, like the Appearance generators. */
async function localMachineId(): Promise<string> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine) throw new Error("Local host unavailable");
  return machine.id;
}

/** One interview step: the next question, or the proposal once the model has enough. */
export async function requestAssistantInterview(
  params: AssistantInterviewParams,
): Promise<AssistantProfileInterviewResult> {
  const result = await remoteRequest<unknown>(
    await localMachineId(),
    "assistant.builder.interview",
    params,
  );
  return AssistantProfileInterviewResultSchema.parse(result);
}

/** Draws one portrait; resolves to the profile avatar value `image:<id>` (not saved yet). */
export async function requestAssistantAvatar(params: {
  prompt: string;
  provider: AssistantAvatarProvider;
}): Promise<string> {
  const result = await remoteRequest<unknown>(
    await localMachineId(),
    "assistant.builder.avatarGenerate",
    params,
  );
  return AssistantAvatarGenerateResultSchema.parse(result).avatar;
}

/** The data URL of a generated portrait. */
export async function requestAssistantAvatarData(id: string): Promise<string> {
  const result = await remoteRequest<unknown>(
    await localMachineId(),
    "assistant.builder.avatarRead",
    {
      id,
    },
  );
  return AssistantAvatarReadResultSchema.parse(result).dataUrl;
}

export const ASSISTANT_BUILDER_FAILURE_MAX = 160;

/** The Host's or transport's reason as one trimmed line, or "" when the failure carried none. */
export function assistantBuilderFailureDetail(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const line = message.replace(/\s+/g, " ").trim();
  return line ? truncateGraphemes(line, ASSISTANT_BUILDER_FAILURE_MAX) : "";
}
