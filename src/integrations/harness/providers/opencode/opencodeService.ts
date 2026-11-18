import { invoke, isTauri } from "@tauri-apps/api/core";
import { execChild, hasHeadlessChildBackend } from "../../core/child";
import { runtimeProviderBinaryPath } from "../../../../features/providers/model/providerBinaryPaths";
import type { NativeSessionCapability } from "../../core/controlTurn";
import { newRequestId } from "../../../../shared/lib/id/requestId";

export type NativeOwnedOpenCode = Readonly<{ serviceId: string; referenceId: string }>;

export type OpenCodeV2Service = {
  url: string;
  password?: string;
  nativeOwnedService?: NativeOwnedOpenCode;
};

const ownedSources = new WeakMap<
  NativeSessionCapability,
  Map<string, { operationId: string; pending?: Promise<OpenCodeV2Service> }>
>();
const catalogSources = new Map<string, Promise<OpenCodeV2Service>>();
const catalogRetryOperations = new Map<string, string>();
// Enable conversation routing only after unscoped utilities and provider-open
// share this service and physical endpoint ownership is qualified.
const OWNED_V2_ROUTE_READY = true;
const OWNED_UTILITY_ROUTE_READY = true;

export function resolveOwnedOpenCodeCatalog(path: string, cwd: string): Promise<OpenCodeV2Service> {
  const binaryPath = runtimeProviderBinaryPath("opencode");
  const key = JSON.stringify([path, cwd, binaryPath]);
  const existing = catalogSources.get(key);
  if (existing) return existing;
  // A failed acquire is retried with the same operation ID: native acquisition
  // is idempotent per ID, so an accepted-but-unreported reference is returned
  // instead of leaked, and a real failure no longer sticks until restart.
  const operationId = catalogRetryOperations.get(key) ?? newRequestId();
  catalogRetryOperations.set(key, operationId);
  const pending = (async () => {
    const pageToken = await invoke<string>("canonical_store_page_token");
    const command = Object.freeze({
      command: path,
      args: ["--version"],
      cwd,
      binaryProvider: "opencode",
      binaryPath,
    });
    const grant = await invoke<{ token: string; routeId: string }>("harness_management_grant", {
      pageToken,
      command,
    });
    const source = await invoke<{ serviceId: string; referenceId: string; endpoint: string }>(
      "owned_opencode_catalog_acquire",
      {
        command: path,
        binaryPath,
        cwd,
        pageToken,
        operationId,
        managementToken: grant.token,
        managementRouteId: grant.routeId,
      },
    );
    return {
      url: source.endpoint,
      nativeOwnedService: Object.freeze({
        serviceId: source.serviceId,
        referenceId: source.referenceId,
      }),
    };
  })();
  void pending.then(
    () => catalogRetryOperations.delete(key),
    () => {
      if (catalogSources.get(key) === pending) catalogSources.delete(key);
    },
  );
  catalogSources.set(key, pending);
  return pending;
}

export async function resolveOwnedOpenCodeUtility(
  path: string,
  cwd: string,
): Promise<OpenCodeV2Service> {
  const catalog = await resolveOwnedOpenCodeCatalog(path, cwd);
  if (!catalog.nativeOwnedService)
    throw new Error("Native OpenCode service identity is unavailable.");
  const binaryPath = runtimeProviderBinaryPath("opencode");
  const pageToken = await invoke<string>("canonical_store_page_token");
  const command = Object.freeze({
    command: path,
    args: ["--version"],
    cwd,
    binaryProvider: "opencode",
    binaryPath,
  });
  const grant = await invoke<{ token: string; routeId: string }>("harness_management_grant", {
    pageToken,
    command,
  });
  const operationId = newRequestId();
  const source = await invoke<{ serviceId: string; referenceId: string; endpoint: string }>(
    "owned_opencode_utility_acquire",
    {
      handle: catalog.nativeOwnedService,
      pageToken,
      operationId,
      managementToken: grant.token,
      managementRouteId: grant.routeId,
    },
  );
  return {
    url: source.endpoint,
    nativeOwnedService: Object.freeze({
      serviceId: source.serviceId,
      referenceId: source.referenceId,
    }),
  };
}

/** Release only the original capability's references after its native cohort
 * has physically retired. Failed acquires have no confirmed reference to release. */
export async function releaseOwnedOpenCodeForCapability(
  capability: NativeSessionCapability,
): Promise<void> {
  const sources = ownedSources.get(capability);
  if (!sources) return;
  for (const [key, acquisition] of sources) {
    const source = await acquisition.pending?.catch(() => undefined);
    const handle = source?.nativeOwnedService;
    if (!handle) continue;
    const released = await invoke<boolean>("owned_opencode_release", {
      ...handle,
      pageToken: capability.pageToken,
      capability,
    });
    if (!released)
      throw new Error("Original OpenCode service reference retirement is unconfirmed.");
    if (sources.get(key) === acquisition) sources.delete(key);
  }
  if (sources.size === 0 && ownedSources.get(capability) === sources)
    ownedSources.delete(capability);
}

export function parseOpenCodeServiceUrl(output: string): string | null {
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/?$/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function resolveOpenCodeV2ServiceUrl(path: string, cwd: string): Promise<string> {
  const status = await execChild(
    path,
    ["service", "status"],
    cwd,
    "opencode",
    undefined,
    "management",
  ).catch(() => "");
  const existing = parseOpenCodeServiceUrl(status);
  if (existing) return existing;

  const started = await execChild(
    path,
    ["service", "start"],
    cwd,
    "opencode",
    undefined,
    "management",
  ).catch((error: unknown) => {
    throw new Error(
      `Could not start the OpenCode background service: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  const fromStart = parseOpenCodeServiceUrl(started);
  if (fromStart) return fromStart;

  const refreshed = await execChild(
    path,
    ["service", "status"],
    cwd,
    "opencode",
    undefined,
    "management",
  );
  const url = parseOpenCodeServiceUrl(refreshed);
  if (url) return url;
  throw new Error("OpenCode background service did not report a local URL.");
}

export async function resolveOpenCodeV2Service(
  path: string,
  cwd: string,
  capability?: NativeSessionCapability,
  purpose?: "utility",
): Promise<OpenCodeV2Service> {
  if (
    OWNED_UTILITY_ROUTE_READY &&
    purpose === "utility" &&
    !capability &&
    typeof isTauri === "function" &&
    isTauri() &&
    !hasHeadlessChildBackend()
  ) {
    return resolveOwnedOpenCodeUtility(path, cwd);
  }
  if (
    OWNED_V2_ROUTE_READY &&
    capability &&
    typeof isTauri === "function" &&
    isTauri() &&
    !hasHeadlessChildBackend()
  ) {
    const binaryPath = runtimeProviderBinaryPath("opencode");
    const key = JSON.stringify([path, cwd, binaryPath]);
    let sources = ownedSources.get(capability);
    if (!sources) {
      sources = new Map();
      ownedSources.set(capability, sources);
    }
    const acquisition = sources.get(key) ?? { operationId: newRequestId() };
    if (acquisition.pending) return acquisition.pending;
    const pending = invoke<{ serviceId: string; referenceId: string; endpoint: string }>(
      "owned_opencode_acquire",
      {
        command: path,
        binaryPath,
        cwd,
        pageToken: capability.pageToken,
        capability,
        operationId: acquisition.operationId,
      },
    ).then(({ serviceId, referenceId, endpoint }) => ({
      url: endpoint,
      nativeOwnedService: Object.freeze({ serviceId, referenceId }),
    }));
    acquisition.pending = pending;
    sources.set(key, acquisition);
    // Retry with the original ID to recover a reference accepted before an unknown outcome.
    void pending.catch(() => {
      delete acquisition.pending;
    });
    return pending;
  }
  const url = await resolveOpenCodeV2ServiceUrl(path, cwd);
  const password = (
    await execChild(path, ["service", "get", "password"], cwd, "opencode", undefined, "management")
  ).trim();
  if (!password) {
    throw new Error("OpenCode background service did not report a password.");
  }
  return { url, password };
}
