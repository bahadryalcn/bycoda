import { invoke } from "@tauri-apps/api/core";
import { validSshJumpFileReference } from "./sshJumpPolicies";
import { validSshEndpointPreview } from "./sshEndpointReview";
import { refreshServerInventory, type SshEndpoint } from "./serverInventory";
export const SSH_INHERITED_FIELDS = ["user", "port", "identityFile", "certificateFile"] as const;
export type SshInheritedField = (typeof SSH_INHERITED_FIELDS)[number];
export type SshInheritance = { groupId: string; fields: SshInheritedField[]; environment: boolean };
export type SshGroupDefaults = {
  id: string;
  revision: number;
  name: string;
  defaults: { user?: string; port?: number; identityFile?: string; certificateFile?: string };
  environment: { name: string; value: string }[];
  shellKind?: "posix" | "powershell";
};
export type SshConfigurationPreview = {
  connectionId: string;
  inheritance: SshInheritance | null;
  configuration: {
    endpoint: SshEndpoint;
    provenance: Record<
      string,
      { source: "connection" | "default" | "group"; groupId?: string; revision?: number }
    >;
    environment: { name: string; value: string }[];
    shellKind?: "posix" | "powershell" | null;
    digest: string;
  };
};
export type SshGroupDraft = {
  id: string;
  revision: number;
  name: string;
  user: string;
  port: string;
  identityFile: string;
  certificateFile: string;
  environment: { name: string; value: string }[];
  shellKind: "posix" | "powershell";
};
export function sshGroupDraft(profile?: SshGroupDefaults): SshGroupDraft {
  return {
    id: profile?.id ?? crypto.randomUUID(),
    revision: profile?.revision ?? 0,
    name: profile?.name ?? "",
    user: profile?.defaults.user ?? "",
    port: profile?.defaults.port == null ? "" : String(profile.defaults.port),
    identityFile: profile?.defaults.identityFile ?? "",
    certificateFile: profile?.defaults.certificateFile ?? "",
    environment: profile?.environment.map((entry) => ({ ...entry })) ?? [],
    shellKind: profile?.shellKind ?? "posix",
  };
}
/** Friendly form checks only. Native policy and revision checks are authoritative. */
export function sshGroupProfileFromDraft(draft: SshGroupDraft): SshGroupDefaults | undefined {
  if (
    !draft.name.trim() ||
    new TextEncoder().encode(draft.name).length > 200 ||
    draft.environment.length > 32
  )
    return undefined;
  // oxlint-disable-next-line no-control-regex -- mirrors native public profile-name bounds
  if (/[\x00-\x1f\x7f-\x9f]/.test(draft.name)) return undefined;
  if (
    !validSshEndpointPreview({
      host: "validation.invalid",
      port: draft.port ? Number(draft.port) : 22,
      user: draft.user || undefined,
      identityFile: draft.identityFile || undefined,
      certificateFile: draft.certificateFile || undefined,
    })
  )
    return undefined;
  if (
    [draft.identityFile, draft.certificateFile].some(
      (value) => value.includes("-----BEGIN") || value.includes("-----END"),
    )
  )
    return undefined;
  if (
    draft.user &&
    (!/^[a-zA-Z0-9._-]+$/.test(draft.user) || draft.user.startsWith("-") || draft.user.length > 128)
  )
    return undefined;
  if (
    draft.port &&
    (!/^\d+$/.test(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65535)
  )
    return undefined;
  if (
    !validSshJumpFileReference(draft.identityFile) ||
    !validSshJumpFileReference(draft.certificateFile)
  )
    return undefined;
  const names = new Set<string>();
  let total = 0;
  const reserved = new Set(
    "PATH HOME USER LOGNAME SHELL ENV BASH_ENV SHELLOPTS BASHOPTS ZDOTDIR FPATH CDPATH IFS PS1 PS2 PS4 PROMPT_COMMAND PROMPT COMSPEC PATHEXT SYSTEMROOT WINDIR PSMODULEPATH NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED PYTHONPATH PYTHONHOME PYTHONSTARTUP RUBYOPT RUBYLIB PERL5OPT PERL5LIB JAVA_TOOL_OPTIONS _JAVA_OPTIONS JDK_JAVA_OPTIONS CLASSPATH DOTNET_STARTUP_HOOKS DOTNET_ADDITIONAL_DEPS DOTNET_SHARED_STORE SSL_CERT_FILE SSL_CERT_DIR GIT_SSL_NO_VERIFY GIT_EXEC_PATH GIT_TEMPLATE_DIR".split(
      " ",
    ),
  );
  const sensitive = [
    "TOKEN",
    "PASSWORD",
    "PASSPHRASE",
    "SECRET",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "API_KEY",
    "ACCESS_KEY",
    "AUTHORIZATION",
  ];
  const prefixes = ["LD_", "DYLD_", "SSH_", "BYCODA_", "BASH_FUNC_", "GIT_CONFIG_", "GIT_SSH"];
  for (const entry of draft.environment) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name) ||
      entry.name.length > 128 ||
      new TextEncoder().encode(entry.value).length > 4096 ||
      names.has(draft.shellKind === "powershell" ? entry.name.toUpperCase() : entry.name)
    )
      return undefined;
    // oxlint-disable-next-line no-control-regex -- environment entries are literal, single-line values
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(entry.value)) return undefined;
    const name = entry.name.toUpperCase();
    if (
      reserved.has(name) ||
      sensitive.some((word) => name.includes(word)) ||
      prefixes.some((prefix) => name.startsWith(prefix)) ||
      entry.value.includes("-----BEGIN") ||
      entry.value.includes("-----END")
    )
      return undefined;
    try {
      const url = new URL(entry.value);
      if (url.username || url.password) return undefined;
    } catch {
      /* Literal non-URL values are supported. */
    }
    total += new TextEncoder().encode(entry.name + entry.value).length;
    if (total > 16 * 1024) return undefined;
    names.add(draft.shellKind === "powershell" ? name : entry.name);
  }
  return {
    id: draft.id,
    revision: draft.revision,
    name: draft.name.trim(),
    defaults: {
      ...(draft.user ? { user: draft.user } : {}),
      ...(draft.port ? { port: Number(draft.port) } : {}),
      ...(draft.identityFile ? { identityFile: draft.identityFile } : {}),
      ...(draft.certificateFile ? { certificateFile: draft.certificateFile } : {}),
    },
    environment: draft.environment.map((entry) => ({ ...entry })),
    shellKind: draft.shellKind,
  };
}
export const listSshGroupDefaults = () => invoke<SshGroupDefaults[]>("ssh_group_defaults_list");
export async function saveSshGroupDefaults(
  profile: SshGroupDefaults,
  expectedRevision: number | null,
) {
  const result = await invoke<SshGroupDefaults>("ssh_group_defaults_save", {
    profile,
    expectedRevision,
  });
  refreshServerInventory();
  return result;
}
export async function removeSshGroupDefaults(id: string, expectedRevision: number) {
  await invoke("ssh_group_defaults_remove", { id, expectedRevision });
  refreshServerInventory();
}
export const previewSshConfiguration = (
  connectionId: string,
  inheritance: SshInheritance | null,
  useSaved: boolean,
) =>
  invoke<SshConfigurationPreview>("server_ssh_configuration_preview", {
    connectionId,
    inheritance,
    useSaved,
  });
export async function setSshInheritance(
  connectionId: string,
  inheritance: SshInheritance | null,
  expectedInheritance: SshInheritance | null,
  expectedConfigurationDigest: string,
) {
  await invoke("server_ssh_inheritance_set", {
    connectionId,
    inheritance,
    expectedInheritance,
    expectedConfigurationDigest,
  });
  refreshServerInventory();
}

export type SshRuntimeConfiguration = Omit<SshConfigurationPreview["configuration"], "endpoint">;
/** Only native configuration metadata may explain an inherited review target. */
export function validSshRuntimeConfiguration(value: unknown): value is SshRuntimeConfiguration {
  if (!value || typeof value !== "object") return false;
  const configuration = value as SshRuntimeConfiguration;
  if (
    typeof configuration.digest !== "string" ||
    !/^[a-f0-9]{64}$/i.test(configuration.digest) ||
    !Array.isArray(configuration.environment) ||
    configuration.environment.length > 32 ||
    ![null, undefined, "posix", "powershell"].includes(configuration.shellKind) ||
    !configuration.provenance ||
    typeof configuration.provenance !== "object" ||
    Array.isArray(configuration.provenance) ||
    Object.keys(configuration.provenance).length > 64
  )
    return false;
  if (configuration.environment.length && !configuration.shellKind) return false;
  for (const entry of configuration.environment) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry.name) ||
      typeof entry.value !== "string" ||
      new TextEncoder().encode(entry.value).length > 4096
    )
      return false;
    // oxlint-disable-next-line no-control-regex -- native literal environment must stay single-line metadata
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(entry.value)) return false;
  }
  if (
    !sshGroupProfileFromDraft({
      id: "native-preview",
      revision: 0,
      name: "Native preview",
      user: "",
      port: "",
      identityFile: "",
      certificateFile: "",
      environment: configuration.environment,
      shellKind: configuration.shellKind ?? "posix",
    })
  )
    return false;
  return Object.values(configuration.provenance).every(
    (source) =>
      source &&
      ["connection", "default", "group"].includes(source.source) &&
      (source.source !== "group" ||
        (typeof source.groupId === "string" &&
          /^[a-zA-Z0-9._-]{1,200}$/.test(source.groupId) &&
          Number.isSafeInteger(source.revision) &&
          source.revision! >= 0)),
  );
}
