import { join } from "node:path";
import { isOllamaModelName, OLLAMA_RPC } from "../../src/shared/model/host-contracts/ollama";
import { OllamaService } from "../providers/ollama";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

function assertModelNames(models: readonly string[]): void {
  if (!models.every(isOllamaModelName)) throw new Error("Invalid Ollama model name.");
}

let service: OllamaService | undefined;
/** One per Host process: it owns the single running download and the saved port. */
const ollama = (featureDirectory: string) =>
  (service ??= new OllamaService({
    settingsPath: join(featureDirectory, "ollama", "settings.json"),
  }));

/** Local Ollama for OpenCode. A changed OpenCode config drops cached catalogs so pickers re-read it. */
export async function handleOllamaRpc(
  dependencies: Pick<ServerBindings, "catalogs" | "featureDirectory">,
  request: OwnerRpcRequest,
): Promise<void> {
  const service = ollama(dependencies.featureDirectory);
  switch (request.input.method) {
    case "ollama.status":
      OLLAMA_RPC["ollama.status"].params.parse(request.params ?? {});
      request.result = await service.status();
      break;
    case "ollama.start":
      OLLAMA_RPC["ollama.start"].params.parse(request.params ?? {});
      request.result = await service.start();
      break;
    case "ollama.pull.start": {
      const { model } = OLLAMA_RPC["ollama.pull.start"].params.parse(request.params);
      assertModelNames([model]);
      service.startPull(model);
      request.result = await service.status();
      break;
    }
    case "ollama.pull.cancel":
      OLLAMA_RPC["ollama.pull.cancel"].params.parse(request.params ?? {});
      service.cancelPull();
      request.result = await service.status();
      break;
    case "ollama.port.set": {
      const { port } = OLLAMA_RPC["ollama.port.set"].params.parse(request.params);
      request.result = await service.setPort(port);
      dependencies.catalogs.clear();
      break;
    }
    case "ollama.opencode.save": {
      const { models } = OLLAMA_RPC["ollama.opencode.save"].params.parse(request.params);
      assertModelNames(models);
      request.result = await service.saveOpencode(models);
      dependencies.catalogs.clear();
      break;
    }
  }
}
