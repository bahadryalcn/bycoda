import { homeDir } from "../../../../platform/tauri/fs";
import { setHarnessModels } from "../../../../features/sessions/model/models";
import { AcpClient } from "../../core/acp";
import {
  killChild,
  resolveGeminiBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import { modelsFromSessionNew } from "../antigravity/antigravityProtocol";

export async function withGeminiClient<T>(
  work: (acp: AcpClient, cwd: string) => Promise<T>,
  workingDirectory?: string,
): Promise<T> {
  const [{ path }, cwd] = await Promise.all([
    resolveGeminiBinary(),
    workingDirectory ? Promise.resolve(workingDirectory) : homeDir(),
  ]);
  const id = `bycoda-gemini-setup-${crypto.randomUUID()}`;
  const acp = new AcpClient(id, {
    onRequest: (requestId, method) => {
      // Setup never grants file access, terminal execution or tool permissions.
      const reply =
        method === "session/request_permission"
          ? acp.respond(requestId, { outcome: { outcome: "cancelled" } })
          : acp.respondError(requestId, {
              code: -32601,
              message: "Unsupported setup request",
            });
      void reply.catch(() => undefined);
    },
  });
  watchChild(
    id,
    (line) => acp.pushLine(line),
    () => acp.close(new Error("Gemini setup exited")),
  );
  try {
    await spawnChild(id, path, ["--experimental-acp"], cwd, undefined, "gemini");
    await acp.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "bycoda", version: "0.1.0" },
      },
      20_000,
    );
    return await work(acp, cwd);
  } finally {
    acp.close();
    unwatchChild(id);
    await killChild(id).catch(() => undefined);
  }
}

export async function discoverGeminiModels(workingDirectory?: string) {
  return withGeminiClient(async (acp, cwd) => {
    const result = await acp.request("session/new", { cwd, mcpServers: [] }, 45_000);
    return modelsFromSessionNew(result).map((model) => ({
      ...model,
      id: `gemini:${model.nativeId}`,
      harness: "gemini" as const,
    }));
  }, workingDirectory);
}

let inflight: Promise<void> | null = null;
export function refreshGeminiCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverGeminiModels()
    .then((models) => {
      if (models.length) setHarnessModels("gemini", models);
    })
    .catch(() => {
      // Discovery must not initiate a login or discard the last known catalog.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

let signingIn: Promise<void> | null = null;
export function loginGemini(): Promise<void> {
  if (signingIn) return signingIn;
  signingIn = withGeminiClient(async (acp) => {
    // The provider owns browser OAuth and persists credentials in its CLI profile.
    await acp.request("authenticate", { methodId: "oauth-personal" }, 10 * 60_000);
  })
    .then(async () => {
      // Verify using a fresh process, proving the saved login survives setup exit.
      const models = await discoverGeminiModels();
      if (!models.length)
        throw new Error("Gemini sign-in could not be verified. Please try again.");
      setHarnessModels("gemini", models);
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "Could not sign in to Gemini";
      throw new Error(detail.replace(/https?:\/\/\S+/gi, "[sign-in link]"));
    })
    .finally(() => {
      signingIn = null;
    });
  return signingIn;
}
