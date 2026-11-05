import { realpath, stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type RemoteProvider } from "../../src/features/connections/model/protocol";
import { type AgentModel } from "../../src/features/sessions/model/models";
import {
  resolveAntigravityBinary,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveFxBinary,
  resolveGrokBinary,
  resolveHermesBinary,
  resolveOmpBinary,
  resolveOpenCodeBinary,
  resolvePiBinary,
} from "../../src/integrations/harness/core/child";
import { discoverAntigravityModels } from "../../src/integrations/harness/providers/antigravity/antigravityCatalog";
import { discoverClaudeModels } from "../../src/integrations/harness/providers/claude/claudeCatalog";
import { discoverCodexModels } from "../../src/integrations/harness/providers/codex/codexCatalog";
import { discoverCursorModels } from "../../src/integrations/harness/providers/cursor/cursorCatalog";
import { discoverFxModels } from "../../src/integrations/harness/providers/fx/fxCatalog";
import { discoverGrokModels } from "../../src/integrations/harness/providers/grok/grokCatalog";
import { discoverHermesModels } from "../../src/integrations/harness/providers/hermes/hermesCatalog";
import { discoverOpenCodeModels } from "../../src/integrations/harness/providers/opencode/opencodeCatalog";
import {
  discoverOmpModels,
  discoverPiModels,
} from "../../src/integrations/harness/providers/pi/piCatalog";

export const resolveBinary: Record<RemoteProvider, () => Promise<{ path: string }>> = {
  codex: () => resolveCodexBinary(),
  claude: () => resolveClaudeBinary(),
  cursor: () => resolveCursorBinary(),
  grok: () => resolveGrokBinary(),
  opencode: () => resolveOpenCodeBinary(),
  pi: () => resolvePiBinary(),
  omp: () => resolveOmpBinary(),
  fx: () => resolveFxBinary(),
  hermes: () => resolveHermesBinary(),
  antigravity: () => resolveAntigravityBinary(),
  acp: async () => ({ path: "configured-acp" }),
};

export const MAX_BODY = 16 * 1024 * 1024;

export const discoverModels: Record<RemoteProvider, (cwd: string) => Promise<AgentModel[]>> = {
  codex: discoverCodexModels,
  claude: discoverClaudeModels,
  cursor: discoverCursorModels,
  grok: discoverGrokModels,
  opencode: discoverOpenCodeModels,
  pi: discoverPiModels,
  omp: discoverOmpModels,
  fx: discoverFxModels,
  hermes: discoverHermesModels,
  antigravity: discoverAntigravityModels,
  acp: async () => [],
};

export async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

export async function providerBinaries(providers: RemoteProvider[]): Promise<string> {
  const binaries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const file = await realpath((await resolveBinary[provider]()).path);
        return `${file}:${(await stat(file)).mtimeMs}`;
      } catch {
        return "";
      }
    }),
  );
  return binaries.join("\n");
}

export const DESKTOP_RUN_ID = "desktop";

export const MAX_DESKTOP_VIEWS = 32;

export const MAX_MEMOIZED_VIEWS = 4;

export const WATCH_STAMP_MS = 200;

export type HostPrivateControlHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

export type HostPrivateControl = {
  lifecycle?: HostPrivateControlHandler;
  nativeAuthorityBootstrap?: HostPrivateControlHandler & { close(): void | Promise<void> };
};

export let rejectionGuards = 0;

export let hostDegradedSince: number | undefined;

export let unhandledRejectionCount = 0;

export function logUnhandledRejection(reason: unknown) {
  hostDegradedSince ??= Date.now();
  unhandledRejectionCount++;
  // Messages and absolute paths may contain prompts or credentials. Retain only
  // bounded frame locations, never arbitrary exception text or function names.
  const frames =
    reason instanceof Error && typeof reason.stack === "string"
      ? reason.stack
          .split("\n")
          .slice(1, 17)
          .flatMap((line) => {
            const match = /(?:^|[\\/])([\w.-]+\.(?:[cm]?[jt]s|tsx)):(\d+):(\d+)\)?\s*$/.exec(line);
            return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
          })
      : [];
  const name =
    reason instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(reason.name)
      ? reason.name
      : "UnknownError";
  console.warn(
    `Host state may be degraded after unhandled rejection #${unhandledRejectionCount} (${name}).${frames.length ? ` Frames: ${frames.join(", ")}` : ""}`,
  );
}

export function guardUnhandledRejections(): () => void {
  if (rejectionGuards++ === 0) process.on("unhandledRejection", logUnhandledRejection);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--rejectionGuards === 0) process.off("unhandledRejection", logUnhandledRejection);
  };
}
