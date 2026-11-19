import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";
import type { RemoteMachine } from "../../connections";
import { remoteRequest } from "../../connections/public/connections";
import { t } from "../../../shared/i18n";
import {
  OLLAMA_RPC,
  type OllamaMethod,
  type OllamaStatus,
} from "../../../shared/model/host-contracts/ollama";

type Params<M extends OllamaMethod> = z.input<(typeof OLLAMA_RPC)[M]["params"]>;

/** Ollama and OpenCode run on this computer, so every call goes to the local Host. */
async function call<M extends OllamaMethod>(method: M, params: Params<M>): Promise<OllamaStatus> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error(t("The local Host is unavailable. Reconnect and retry."));
  const result = OLLAMA_RPC[method].result.safeParse(
    await remoteRequest<unknown>(machine.id, method, params),
  );
  if (!result.success) throw new Error(t("Update bycoda Host to manage Ollama models."));
  return result.data;
}

export const ollamaClient = {
  status: () => call("ollama.status", {}),
  start: () => call("ollama.start", {}),
  pull: (model: string) => call("ollama.pull.start", { model }),
  cancelPull: () => call("ollama.pull.cancel", {}),
  setPort: (port: number | null) => call("ollama.port.set", { port }),
  saveOpencode: (models: string[]) => call("ollama.opencode.save", { models }),
};
