export type EnvironmentReadOptions = { signal?: AbortSignal };

/** The legacy HTTP adapter deliberately retains its existing provider negotiation. */
export type EnvironmentDescribeParams = { supportedProviders?: unknown };

/**
 * Environment metadata belongs to the Host composition, not to a transport.
 * Keep all snapshot fields while projecting the providers supported by a client.
 */
export function createEnvironmentService<
  Snapshot extends { providers: readonly string[] },
>(dependencies: { snapshot: (options: EnvironmentReadOptions) => Snapshot | Promise<Snapshot> }) {
  return {
    async describe(
      params: EnvironmentDescribeParams = {},
      options: EnvironmentReadOptions = {},
    ): Promise<Omit<Snapshot, "providers"> & { providers: string[] }> {
      options.signal?.throwIfAborted();
      const snapshot = await dependencies.snapshot(options);
      options.signal?.throwIfAborted();
      const supported = Array.isArray(params.supportedProviders)
        ? new Set<unknown>(params.supportedProviders)
        : undefined;
      return {
        ...snapshot,
        providers: [...new Set(snapshot.providers)].filter((provider) =>
          supported ? supported.has(provider) : provider === "codex" || provider === "claude",
        ),
      };
    },
  };
}
