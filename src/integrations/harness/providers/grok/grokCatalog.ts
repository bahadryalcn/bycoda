import { killChild } from "../../core/child";
import {
  assertOptionalProviderProbeError,
  createProviderRetirementLedger,
  withProviderRetirement,
} from "../../core/providerRetirement";
import { homeDir } from "../../../../platform/tauri/fs";
import { setHarnessModels } from "../../../../features/sessions/model/models";
import { AcpClient } from "../../core/acp";
import {
  createChildProcessHandle,
  execChild,
  resolveGrokBinary,
  spawnChild,
  watchChild,
} from "../../core/child";
import {
  fallbackGrokModels,
  grokAuthMethodId,
  grokSpawnArgs,
  modelsFromGrokModelsOutput,
  modelsFromInitialize,
  modelsFromSessionNew,
} from "./grokProtocol";

const retirements = createProviderRetirementLedger("grok.catalog", killChild);

const PROBE_ID = "bycoda-grok-probe";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

let inflight: Promise<void> | null = null;

export function refreshGrokCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverGrokModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("grok", models);
    })
    .catch((error: unknown) => {
      assertOptionalProviderProbeError(error);
      console.debug("[bycoda] grok catalog", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function discoverGrokModels(workingDirectory?: string) {
  const fromAcp = await discoverViaAcp(workingDirectory).catch((error: unknown) => {
    assertOptionalProviderProbeError(error);
    console.debug("[bycoda] grok ACP catalog failed", error);
    return [];
  });
  if (fromAcp.length > 0) return fromAcp;
  const fromCli = await discoverViaCli(workingDirectory).catch((error: unknown) => {
    assertOptionalProviderProbeError(error);
    console.debug("[bycoda] grok CLI catalog failed", error);
    return [];
  });
  if (fromCli.length > 0) return fromCli;
  return fallbackGrokModels();
}

async function discoverViaAcp(workingDirectory?: string) {
  const { path } = await resolveGrokBinary();
  const cwd = workingDirectory ?? (await homeDir());
  const probeId = `${PROBE_ID}-${crypto.randomUUID()}`;
  const probeProcess = retirements.admit(createChildProcessHandle(probeId), "grok.catalog");
  const acp = new AcpClient(probeProcess, {
    onRequest: (id) => {
      void acp.respond(id, {}).catch(() => undefined);
    },
  });

  const stop = () => {
    acp.close();
    return retirements.retire([probeProcess]);
  };

  watchChild(
    probeProcess,
    (line) => acp.pushLine(line),
    () => acp.close(new Error("Grok Build probe exited")),
  );

  return withProviderRetirement(
    async () => {
      await spawnChild(probeProcess, path, grokSpawnArgs({ model: "" }), cwd, undefined, "grok");
      return await withTimeout(
        DISCOVERY_TIMEOUT_MS,
        async () => {
          const init = await acp.request(
            "initialize",
            {
              protocolVersion: 1,
              clientCapabilities: CLIENT_CAPABILITIES,
              clientInfo: { name: "bycoda", version: "0.1.0" },
            },
            REQUEST_TIMEOUT_MS,
          );
          const fromInit = modelsFromInitialize(init);
          if (fromInit.length > 0) return fromInit;

          const methodId = grokAuthMethodId(init);
          if (methodId) {
            await acp
              .request("authenticate", { methodId, _meta: { headless: true } }, REQUEST_TIMEOUT_MS)
              .catch(() => undefined);
          }
          const created = await acp.request(
            "session/new",
            { cwd, mcpServers: [] },
            REQUEST_TIMEOUT_MS,
          );
          return modelsFromSessionNew(created);
        },
        () => {
          void stop();
        },
      );
    },
    async () => {
      await stop();
    },
  );
}

async function discoverViaCli(workingDirectory?: string) {
  const { path } = await resolveGrokBinary();
  const cwd = workingDirectory ?? (await homeDir());
  const stdout = await execChild(path, ["models"], cwd, "grok");
  return modelsFromGrokModelsOutput(stdout);
}

function withTimeout<T>(ms: number, run: () => Promise<T>, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("Grok Build catalog probe timed out"));
    }, ms);
    run()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
