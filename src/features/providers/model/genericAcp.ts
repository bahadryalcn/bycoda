export type GenericAcpConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  authMethodId?: string;
  contextWindow?: number;
};
export type GenericAcpSummary = Omit<GenericAcpConfig, "env"> & { envKeys: string[] };
export type AcpRegistryEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  package?: string;
  args: string[];
  env?: Record<string, string>;
  supported: boolean;
  unsupportedReason?: string;
};
export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
export const ACP_PINNED_PACKAGE =
  /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateGenericAcpConfig(value: GenericAcpConfig): GenericAcpConfig {
  if (
    !value ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.id) ||
    !value.name?.trim() ||
    value.name.length > 160 ||
    !value.command?.trim() ||
    value.command.length > 2048 ||
    /[\r\n\0]/.test(value.command)
  )
    throw new Error("Invalid ACP agent id, name or executable");
  if (
    !Array.isArray(value.args) ||
    value.args.length > 64 ||
    value.args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))
  )
    throw new Error("Invalid ACP arguments");
  if (
    value.env &&
    (Object.keys(value.env).length > 64 ||
      Object.entries(value.env).some(
        ([key, val]) =>
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
          typeof val !== "string" ||
          val.length > 8192 ||
          val.includes("\0"),
      ))
  )
    throw new Error("Invalid ACP environment");
  if (
    value.contextWindow != null &&
    (!Number.isSafeInteger(value.contextWindow) ||
      value.contextWindow < 1024 ||
      value.contextWindow > 10_000_000)
  )
    throw new Error("Invalid context window");
  return { ...value, name: value.name.trim(), command: value.command.trim() };
}

export function parseAcpRegistry(value: unknown): AcpRegistryEntry[] {
  const root = value as { agents?: unknown };
  const agents = Array.isArray(value) ? value : Array.isArray(root?.agents) ? root.agents : [];
  if (agents.length > 2000) throw new Error("ACP registry has too many agents");
  return agents.flatMap((raw) => {
    const agent = raw as {
      id?: string;
      name?: string;
      version?: string;
      description?: string;
      distribution?: { npx?: { package?: string; args?: string[]; env?: Record<string, string> } };
    };
    if (
      !agent.id ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(agent.id) ||
      !agent.name ||
      !agent.version
    )
      return [];
    const dist = agent.distribution?.npx;
    const supported = !!dist?.package && ACP_PINNED_PACKAGE.test(dist.package);
    const args = dist?.args ?? [];
    if (
      !Array.isArray(args) ||
      args.length > 64 ||
      args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))
    )
      return [];
    return [
      {
        id: agent.id,
        name: agent.name.slice(0, 160),
        version: agent.version.slice(0, 128),
        description: String(agent.description ?? "").slice(0, 1024),
        package: supported ? dist!.package : undefined,
        args,
        env: dist?.env,
        supported,
        ...(!supported
          ? {
              unsupportedReason:
                "This build supports exact-version npm distributions. Binary and uvx distributions require local command setup.",
            }
          : {}),
      },
    ];
  });
}
