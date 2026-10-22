import {
  acquireHarnessBridge,
  killChild,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import { PiRpc } from "./piClient";
import { PI_FLAVOR, OMP_FLAVOR, type PiFlavor } from "./piFlavor";
import { nativeCommandInvocation, type NativeCommand } from "../../core/nativeCommands";
import { skillDisabled, type SkillPolicy } from "../../core/skillPolicy";
import {
  asRecord,
  buildPiSpawnArgs,
  extensionUiResponse,
  needsExtensionUiReply,
  parseExtensionUiRequest,
} from "./piProtocol";

const REQUEST_TIMEOUT_MS = 45_000;

export type PiSkillCommand = {
  name: string;
  description: string;
  invocation: string;
  source: "pi";
};

export async function discoverPiSkills(cwd: string): Promise<PiSkillCommand[]> {
  return piSkillsFromRpcData(await discoverCommands(PI_FLAVOR, cwd, "get_commands"));
}

export async function discoverOmpCommands(cwd: string): Promise<NativeCommand[]> {
  return ompCommandsFromRpcData(await discoverCommands(OMP_FLAVOR, cwd, "get_available_commands"));
}

async function discoverCommands(flavor: PiFlavor, cwd: string, command: string): Promise<unknown> {
  const { path } = await flavor.resolveBinary();
  const releaseBridge = await acquireHarnessBridge();
  const childId = `bycoda-${flavor.id}-skills-${crypto.randomUUID()}`;
  const replyToUi = (record: Record<string, unknown>) => {
    const request = parseExtensionUiRequest(record);
    if (!request || !needsExtensionUiReply(request)) return;
    void writeChild(childId, JSON.stringify(extensionUiResponse(request, "deny"))).catch(
      () => undefined,
    );
  };
  const rpc = new PiRpc(childId, replyToUi, flavor.label);

  try {
    watchChild(
      childId,
      (line) => rpc.pushLine(line),
      () => rpc.close(new Error(`${flavor.label} skill probe exited`)),
    );
    await spawnChild(
      childId,
      path,
      buildPiSpawnArgs(flavor, { noSession: true }),
      cwd,
      undefined,
      flavor.id,
    );
    const response = await rpc.request({ type: command }, REQUEST_TIMEOUT_MS);
    return asRecord(response)?.data;
  } finally {
    rpc.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => undefined);
    releaseBridge();
  }
}

/** Preserve the provider's configured/package skills; never reconstruct its catalog from our disk scan. */
export async function allowedPiSkillPaths(
  flavor: PiFlavor,
  cwd: string,
  policy: SkillPolicy,
): Promise<string[]> {
  const data = await discoverCommands(
    flavor,
    cwd,
    flavor.id === "omp" ? "get_available_commands" : "get_commands",
  );
  return allowedPiSkillPathsFromData(data, policy);
}

export function allowedPiSkillPathsFromData(data: unknown, policy: SkillPolicy): string[] {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands))
    throw new Error(
      "Provider did not report its skill catalog; cannot apply bycoda skill restrictions.",
    );
  const paths: string[] = [];
  for (const value of commands) {
    const command = asRecord(value);
    if (command?.source !== "skill") continue;
    const name = typeof command.name === "string" ? command.name.replace(/^skill:/, "") : "";
    const path = asRecord(command.sourceInfo)?.path ?? command.path;
    if (skillDisabled(policy, { name, path: typeof path === "string" ? path : undefined }))
      continue;
    if (!name || typeof path !== "string" || !path || path.startsWith("-"))
      throw new Error(
        "This provider version does not report skill paths. Update it before using bycoda skill restrictions.",
      );
    paths.push(path);
  }
  return [...new Set(paths)];
}

export function ompCommandsFromRpcData(data: unknown): NativeCommand[] {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands))
    throw new Error("OMP get_available_commands returned no commands array");
  const seen = new Set<string>();
  return commands.flatMap((value): NativeCommand[] => {
    const row = asRecord(value);
    const name = row?.name;
    if (typeof name !== "string" || !name || /[\s/\\]/.test(name) || seen.has(name)) return [];
    seen.add(name);
    const aliases = Array.isArray(row?.aliases)
      ? row.aliases.filter(
          (alias): alias is string =>
            typeof alias === "string" && !!alias && !/[\s/\\]/.test(alias),
        )
      : [];
    const hint = asRecord(row?.input)?.hint;
    const subcommands = Array.isArray(row?.subcommands)
      ? row.subcommands.flatMap((value) => {
          const sub = asRecord(value);
          if (typeof sub?.name !== "string" || !sub.name) return [];
          return [
            {
              name: sub.name,
              ...(typeof sub.description === "string" ? { description: sub.description } : {}),
              ...(typeof sub.usage === "string" ? { usage: sub.usage } : {}),
            },
          ];
        })
      : [];
    return [
      {
        name,
        invocation: nativeCommandInvocation("omp", name),
        source: "omp",
        description: typeof row?.description === "string" ? row.description : "",
        ...(typeof row?.source === "string" ? { origin: row.source } : {}),
        ...(aliases.length ? { aliases } : {}),
        ...(typeof hint === "string" ? { inputHint: hint } : {}),
        ...(subcommands.length ? { subcommands } : {}),
      },
    ];
  });
}

export function piSkillsFromRpcData(data: unknown): PiSkillCommand[] {
  const commands = asRecord(data)?.commands;
  if (!Array.isArray(commands)) {
    throw new Error("Pi get_commands returned no commands array");
  }

  const seen = new Set<string>();
  const skills: PiSkillCommand[] = [];
  for (const value of commands) {
    const command = asRecord(value);
    const invocation = command?.name;
    if (
      command?.source !== "skill" ||
      typeof invocation !== "string" ||
      !invocation.startsWith("skill:") ||
      seen.has(invocation)
    ) {
      continue;
    }
    const name = invocation.slice("skill:".length);
    if (!name) continue;
    seen.add(invocation);
    skills.push({
      name,
      description: typeof command.description === "string" ? command.description : "",
      invocation,
      source: "pi",
    });
  }
  return skills;
}
