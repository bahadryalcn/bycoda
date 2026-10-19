import { useEffect, useState } from "react";
import { refreshSshRunbookQueue } from "../../src/features/connections/model/sshRunbookQueue";
import { createRoot } from "react-dom/client";
import { TerminalView } from "../../src/features/terminal/ui/TerminalView";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import {
  ToolNavigation,
  ToolNavigationContext,
  ToolPanel,
} from "../../src/app/shell/ToolNavigation";
import type { WorkspaceToolId } from "../../src/app/model/toolWindows";
import { ServersTerminalWorkspace } from "../../src/features/connections/ui/ServersTerminalWorkspace";
import type {
  ServerRecord,
  SshEndpoint,
} from "../../src/features/connections/model/serverInventory";
import type {
  SshGroupDefaults,
  SshInheritance,
} from "../../src/features/connections/model/sshGroupDefaults";
import { ServersView } from "../../src/features/connections/ui/ServersView";
import { ServerFiles } from "../../src/features/connections/ui/ServerFiles";
import { ServerForwards } from "../../src/features/connections/ui/ServerForwards";
import { useServerInventory } from "../../src/features/connections/model/serverInventory";
import { setLanguagePreference } from "../../src/shared/i18n";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";

// Memory-only native bridge. No real endpoint, DB or credential access.
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const calls: string[] = [];
const requests: { command: string; input: Record<string, unknown> }[] = [];
const callbacks = new Map<number, (event: unknown) => void>();
const listeners = new Map<number, string>();
let callbackId = 0;
let proxyApprovalSequence = 0;
let proxyApprovalMode: "ready" | "stale" = "ready";
let agentReviewSequence = 0;
let agentReviewMode: "ready" | "expired" | "error" = "ready";
let suggestionSequence = 0;
let suggestionPrefix = "doc";
let suggestionNoMatch = false;
const emitFixtureEvent = (event: string, payload: unknown) => {
  for (const [id, name] of listeners)
    if (name === event) callbacks.get(id)?.({ event, id, payload });
};
let finishTransfer: (() => void) | undefined;
const forwardStatuses = new Map<string, Record<string, unknown>>();
let workspaceSnapshot: unknown = params.has("serverRestoreFixture")
  ? {
      tabs: [],
      sessions: [],
      activeTabId: "",
      projectCwd: "~",
      serversRestore: {
        version: 1,
        enabled: true,
        tabs: [{ tabId: "old-ui-reference", serverId: "ssh-duplicate", input: "must-not-replay" }],
      },
    }
  : null;
const sshRecords: ServerRecord[] =
  params.has("sshFixture") || params.has("forwardFixture")
    ? [
        {
          id: "ssh-duplicate",
          name: params.has("longLabels")
            ? "Existing SSH target with a long descriptive production connection name"
            : "Existing SSH target",
          kind: "ssh",
          sshEndpoint: {
            host: "duplicate.example.invalid",
            user: "fixture",
            port: 22,
            ...(params.has("httpProxyFixture")
              ? { httpProxy: { host: "proxy.example.invalid", port: 8080 } }
              : {}),
            ...(params.has("chainCertificate")
              ? { jumpHost: "legacy@first.example.invalid:22" }
              : {}),
          },
          metadata: {
            tags: [],
            favorite: false,
            ...(params.has("inheritedFixture")
              ? {
                  sshInheritance: {
                    groupId: "fixture-group",
                    fields: ["user"],
                    environment: false,
                  } satisfies SshInheritance,
                }
              : {}),
            ...(params.has("groupFixture") ? { group: "Legacy display label" } : {}),
            ...(params.has("proxyAuthFixture")
              ? {
                  forwards: [
                    {
                      id: "proxy-route",
                      name: "Database tunnel",
                      kind: "local" as const,
                      localPort: 15432,
                      targetHost: "db.internal",
                      targetPort: 5432,
                    },
                  ],
                }
              : {}),
          },
        },
      ]
    : [];
// Synthetic revisioned native group API; no persistence or transport access.
let groupProfiles: SshGroupDefaults[] = [
  {
    id: "fixture-group",
    revision: 1,
    name: "Personal defaults",
    defaults: { user: "group-user", port: 2222 },
    environment: [{ name: "APP_STAGE", value: "prod" }],
    shellKind: "posix",
  },
];
function groupPreview(connectionId: unknown, binding: SshInheritance | null) {
  const record = sshRecords.find((item) => item.id === connectionId);
  if (!record?.sshEndpoint) throw new Error("Synthetic target missing");
  const endpoint = structuredClone(record.sshEndpoint);
  const group = groupProfiles.find((item) => item.id === binding?.groupId);
  if (binding && !group) throw new Error("Synthetic group missing");
  const provenance: Record<string, { source: string; groupId?: string; revision?: number }> = {};
  for (const field of ["user", "port", "identityFile", "certificateFile"] as const) {
    if (binding?.fields.includes(field) && group?.defaults[field] !== undefined) {
      Object.assign(endpoint, { [field]: group.defaults[field] });
      provenance[field] = { source: "group", groupId: group.id, revision: group.revision };
    } else provenance[field] = { source: endpoint[field] === undefined ? "default" : "connection" };
  }
  const environment = binding?.environment && group ? structuredClone(group.environment) : [];
  // 64 hex chars, stable for a revision/binding and different after group updates.
  const digest =
    `${String(group?.revision ?? 0).padStart(8, "0")}${binding?.fields.includes("user") ? "1" : "0"}${binding?.fields.includes("port") ? "1" : "0"}${binding?.environment ? "1" : "0"}`.padEnd(
      64,
      "0",
    );
  return {
    connectionId: record.id,
    inheritance: structuredClone(binding),
    configuration: {
      endpoint,
      provenance,
      environment,
      shellKind: environment.length ? group?.shellKind : null,
      digest,
    },
  };
}
let runbookProfiles: SshRunbook[] = [
  {
    id: "fixture-book",
    revision: 1,
    name: "Inspect remote state",
    script: "printf '%s' '$HOME'\npwd",
    shell: "posix",
    targetIds: ["ssh-duplicate"],
    limits: { concurrency: 1, timeoutSeconds: 60 },
  },
];
const dismissedQueueIntents = new Set<string>();
const runbookStatuses = new Map<string, SshRunStatus>();
let runbookReviewSequence = 0;
const abandonedRunbookIds = new Set<string>();
let abandonFailedOnce = false;
let runbookMode: "ready" | "ambiguous" | "preclaim" = "ready";
const runbookTickets = new Map<string, number>();
let inventoryLoads = 0;
const machines = Array.from({ length: params.has("emptyServers") ? 0 : 35 }, (_, index) => ({
  id: `fixture-${index}`,
  environmentId: `environment-${index}`,
  name: `Server ${String(index).padStart(2, "0")}`,
  endpoint: `ssh://fixture@server-${index}.example.invalid`,
  ssh:
    params.has("hostOnlyFixture") && index === 0
      ? undefined
      : { target: `fixture@server-${index}.example.invalid`, port: 2222, remotePort: 3774 },
}));
Object.assign(window, {
  serversFixtureTerminalOutput: (id: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    emitFixtureEvent("pty-data", { id, data: btoa(String.fromCharCode(...bytes)) });
  },
  serversFixtureProxyMode: (mode: "ready" | "stale") => {
    proxyApprovalMode = mode;
  },
  serversFixtureRunbookMode: (mode: "ready" | "ambiguous" | "preclaim") => {
    runbookMode = mode;
  },
  serversFixtureRunbookRevision: () => {
    runbookProfiles[0].revision += 1;
  },
  serversFixtureGroupRevision: () => {
    groupProfiles[0].revision += 1;
  },
  serversFixtureRecords: () => structuredClone(sshRecords),
  serversFixtureAgentMode: (mode: "ready" | "expired" | "error") => {
    agentReviewMode = mode;
  },
  serversFixtureAgentTarget: () => {
    const record = sshRecords.find((item) => item.id === "ssh-duplicate");
    if (record?.sshEndpoint)
      record.sshEndpoint = { ...record.sshEndpoint, host: "changed.example.invalid" };
    window.dispatchEvent(new Event("bycoda:server-inventory"));
  },
  serversFixtureEmit: emitFixtureEvent,
  serversFixtureSuggestion: (prefix: string, noMatch = false) => {
    suggestionPrefix = prefix;
    suggestionNoMatch = noMatch;
  },
  serversFixtureCalls: calls,
  serversFixtureRequests: requests,
  serversFixtureProgress: (payload: unknown) => {
    for (const [id, event] of listeners) {
      if (event === "ssh-sftp-progress") callbacks.get(id)?.({ event, id, payload });
    }
  },
  serversFixtureFinishTransfer: () => finishTransfer?.(),
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: (event: unknown) => void) => {
      callbacks.set(++callbackId, callback);
      return callbackId;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (command: string, input: Record<string, unknown> = {}) => {
      calls.push(command);
      requests.push({
        command,
        input:
          command === "ssh_http_proxy_credentials_approve"
            ? { ...input, username: "[redacted]", password: "[redacted]" }
            : input,
      });
      if (params.has("proxyAuthFixture") && command === "ssh_http_proxy_credentials_approve") {
        const endpoint = input.connectionId
          ? sshRecords.find((item) => item.id === input.connectionId)?.sshEndpoint
          : input.endpoint;
        if (
          proxyApprovalMode === "stale" ||
          JSON.stringify(endpoint) !== JSON.stringify(input.expectedEndpoint)
        )
          throw new Error("Synthetic proxy target changed; review again");
        if (input.allowPlainHttp !== true || !input.username || typeof input.password !== "string")
          throw new Error("Synthetic explicit proxy consent missing");
        return {
          ticketId: `synthetic-proxy-ticket-${++proxyApprovalSequence}`,
          expiresInSeconds: 30,
        };
      }
      if (params.has("runbookFixture")) {
        if (command === "ssh_runbook_pending_intents")
          return params.has("queueFixture")
            ? ["queue-dismiss", "queue-review"]
                .filter((id) => !dismissedQueueIntents.has(id))
                .map((id) => ({
                  id,
                  automationId: "fixture-book",
                  revision: runbookProfiles[0].revision,
                  trigger: "scheduled",
                  createdAt: 1,
                  status: "pendingReview",
                }))
            : params.has("runbookPendingFixture")
              ? [
                  {
                    id: "synthetic-intent",
                    automationId: "fixture-book",
                    revision: runbookProfiles[0].revision,
                    trigger: "scheduled",
                    createdAt: 1,
                    status: "pendingReview",
                  },
                ]
              : [];
        if (command === "ssh_runbook_dismiss_intent") {
          dismissedQueueIntents.add(String(input.intentId));
          return;
        }
        if (command === "ssh_runbooks_list") return structuredClone(runbookProfiles);
        if (command === "ssh_runbook_save") {
          const profile = structuredClone(input.profile) as SshRunbook;
          const existing = runbookProfiles.find((item) => item.id === profile.id);
          if ((existing?.revision ?? null) !== input.expectedRevision)
            throw new Error("Synthetic runbook revision changed");
          profile.revision = (existing?.revision ?? 0) + 1;
          runbookProfiles = [...runbookProfiles.filter((item) => item.id !== profile.id), profile];
          return structuredClone(profile);
        }
        if (command === "ssh_runbook_remove") {
          runbookProfiles = runbookProfiles.filter((item) => item.id !== input.id);
          return;
        }
        if (command === "ssh_runbook_preview") {
          const profile = runbookProfiles.find((item) => item.id === input.automationId);
          if (!profile || profile.revision !== input.expectedRevision)
            throw new Error("Synthetic runbook revision changed");
          const reviewId = `synthetic-runbook-review-${++runbookReviewSequence}`;
          runbookTickets.set(reviewId, profile.revision);
          return {
            review: { reviewId, digest: "b".repeat(64), expiresInSeconds: 120 },
            profile: structuredClone(profile),
            targets: profile.targetIds.map((serverId) => ({
              serverId,
              endpoint: structuredClone(
                sshRecords.find((item) => item.id === serverId)!.sshEndpoint,
              ),
            })),
          };
        }
        if (command === "ssh_runbook_start") {
          const profile = runbookProfiles.find((item) => item.id === input.automationId);
          if (
            !profile ||
            profile.revision !== input.expectedRevision ||
            runbookTickets.get(String(input.reviewId)) !== profile.revision
          )
            throw new Error("Synthetic reviewed revision changed");
          runbookTickets.delete(String(input.reviewId));
          if (abandonedRunbookIds.has(String(input.runId)))
            throw new Error("Synthetic run ID abandoned");
          if (runbookMode === "preclaim") throw new Error("Synthetic preclaim start rejected");
          if (input.intentId) dismissedQueueIntents.add(String(input.intentId));
          if (!runbookStatuses.has(String(input.runId)))
            runbookStatuses.set(String(input.runId), {
              runId: String(input.runId),
              automationId: profile.id,
              revision: profile.revision,
              owner: "main",
              digest: "b".repeat(64),
              targets: profile.targetIds.map((serverId) => ({
                serverId,
                state: "running",
                exitCode: null,
                reason: null,
              })),
            });
          if (runbookMode === "ambiguous") throw new Error("Synthetic start response interrupted");
          return structuredClone(runbookStatuses.get(String(input.runId)));
        }
        if (command === "ssh_runbook_abandon_missing") {
          if (runbookStatuses.has(String(input.runId)))
            throw new Error("Synthetic run already claimed");
          if (params.has("abandonFailureOnce") && !abandonFailedOnce) {
            abandonFailedOnce = true;
            throw new Error("Synthetic abandon response interrupted");
          }
          abandonedRunbookIds.add(String(input.runId));
          return;
        }
        if (command === "ssh_runbook_status") {
          const value = runbookStatuses.get(String(input.runId));
          if (!value) throw new Error("Synthetic run missing");
          return structuredClone(value);
        }
        if (command === "ssh_runbook_cancel") {
          const value = runbookStatuses.get(String(input.runId));
          if (value)
            for (const target of value.targets)
              if (!input.serverId || target.serverId === input.serverId) {
                target.state = "cancelled";
                target.reason = "cancel_requested_remote_outcome_unknown";
              }
          return;
        }
      }
      if (params.has("groupFixture")) {
        if (command === "ssh_group_defaults_list") return structuredClone(groupProfiles);
        if (command === "ssh_group_defaults_save") {
          const profile = structuredClone(input.profile) as SshGroupDefaults;
          const existing = groupProfiles.find((item) => item.id === profile.id);
          if ((existing?.revision ?? null) !== input.expectedRevision)
            throw new Error("Synthetic group revision changed");
          profile.revision = (existing?.revision ?? 0) + 1;
          groupProfiles = [...groupProfiles.filter((item) => item.id !== profile.id), profile];
          return structuredClone(profile);
        }
        if (command === "ssh_group_defaults_remove") {
          if (sshRecords.some((item) => item.metadata.sshInheritance?.groupId === input.id))
            throw new Error("Synthetic group is in use");
          const existing = groupProfiles.find((item) => item.id === input.id);
          if (existing?.revision !== input.expectedRevision)
            throw new Error("Synthetic group revision changed");
          groupProfiles = groupProfiles.filter((item) => item.id !== input.id);
          return;
        }
        if (command === "server_ssh_configuration_preview") {
          const record = sshRecords.find((item) => item.id === input.connectionId);
          return groupPreview(
            input.connectionId,
            (input.useSaved
              ? (record?.metadata.sshInheritance ?? null)
              : input.inheritance) as SshInheritance | null,
          );
        }
        if (command === "server_ssh_inheritance_set") {
          const record = sshRecords.find((item) => item.id === input.connectionId);
          if (
            !record ||
            JSON.stringify(record.metadata.sshInheritance ?? null) !==
              JSON.stringify(input.expectedInheritance)
          )
            throw new Error("Synthetic inheritance changed");
          const preview = groupPreview(
            input.connectionId,
            input.inheritance as SshInheritance | null,
          );
          if (preview.configuration.digest !== input.expectedConfigurationDigest)
            throw new Error("Synthetic configuration changed; preview again");
          record.metadata = {
            ...record.metadata,
            sshInheritance: (input.inheritance ?? undefined) as SshInheritance | undefined,
          };
          return;
        }
      }
      if (params.has("agentReviewFixture") && command === "ssh_agent_forwarding_review") {
        if (agentReviewMode === "error") throw new Error("Synthetic agent unavailable");
        const endpoint = sshRecords.find((item) => item.id === input.connectionId)?.sshEndpoint;
        if (!endpoint) throw new Error("Synthetic target missing");
        return {
          reviewId: `synthetic-agent-review-${++agentReviewSequence}`,
          endpointFingerprint: "synthetic-canonical-endpoint",
          expiresAt: Date.now() + (agentReviewMode === "expired" ? -1 : 30_000),
          agentAvailable: true,
          summary: { host: endpoint.host, user: endpoint.user, port: endpoint.port, jumpHosts: [] },
        };
      }
      if (params.has("autocompleteFixture") && command === "ssh_terminal_suggestions_request") {
        const requestId = `synthetic-request-${++suggestionSequence}`;
        // Synthetic semantic shell transport only. The browser fixture never invokes SSH.
        queueMicrotask(() =>
          emitFixtureEvent("ssh-shell-state", {
            id: input.id,
            status: suggestionNoMatch ? "unavailable" : "suggestions",
            promptReady: true,
            shell: "bash",
            user: "fixture",
            host: "remote.example.invalid",
            requestId,
            source: input.source,
            prefix: suggestionPrefix,
            cursor: new TextEncoder().encode(suggestionPrefix).length,
            suggestions: suggestionNoMatch ? [] : [`${suggestionPrefix}ker`],
          }),
        );
        return requestId;
      }
      if (command === "remote_machines" || command === "server_inventory_list") {
        if (params.has("refreshError") && inventoryLoads++ > 0)
          throw new Error("Fixture inventory temporarily unavailable");
        return structuredClone(
          command === "remote_machines"
            ? machines
            : [
                ...machines.map((machine) => ({
                  id: machine.id,
                  name: machine.name,
                  kind: "host",
                  machine,
                  metadata: { tags: [], favorite: false },
                })),
                ...sshRecords,
              ],
        );
      }
      if (command === "server_ssh_identity_set") {
        const record = sshRecords.find((record) => record.id === input.id);
        if (!record?.sshEndpoint) throw new Error("Fixture SSH server not found");
        record.sshEndpoint.identityFile =
          typeof input.identityFile === "string" ? input.identityFile : undefined;
        return structuredClone(record);
      }
      if (command === "server_ssh_save") {
        const existing = sshRecords.findIndex((record) => record.id === input.id);
        const record: ServerRecord = {
          id: typeof input.id === "string" ? input.id : "fixture-saved-ssh",
          name: String(input.name),
          kind: "ssh",
          sshEndpoint: input.endpoint as SshEndpoint,
          metadata: existing >= 0 ? sshRecords[existing].metadata : { tags: [], favorite: false },
        };
        if (existing >= 0) sshRecords[existing] = structuredClone(record);
        else sshRecords.push(structuredClone(record));
        return structuredClone(record);
      }
      if (command === "workspace_get_snapshot") return structuredClone(workspaceSnapshot);
      if (command === "workspace_set_snapshot") {
        workspaceSnapshot = structuredClone(input.snapshot);
        return;
      }
      if (command === "server_metadata_update") {
        const record = sshRecords.find((item) => item.id === input.id);
        if (record) record.metadata = { ...record.metadata, ...(input.metadata as object) };
        return;
      }
      if (command === "ssh_forward_list") return [...forwardStatuses.values()];
      if (command === "ssh_forward_start") {
        const status = { ...input, state: "running" };
        forwardStatuses.set(String(input.id), status);
        return status;
      }
      if (command === "ssh_forward_stop") {
        forwardStatuses.delete(String(input.id));
        return;
      }
      // Fixed synthetic native replies: they exercise UI choices, not native parsing or trust.
      if (command === "ssh_public_keys_list")
        return params.has("sshKeys")
          ? [
              {
                identityFile: "C:/Users/fixture/.ssh/id_ed25519_work",
                keyType: "ssh-ed25519",
                fingerprint: "SHA256:fixture-public-metadata",
              },
              {
                identityFile: "C:/Users/fixture/.ssh/a-long-descriptive-production-server-key",
                keyType: "ssh-ed25519",
                fingerprint: "SHA256:fixture-other-public-metadata",
              },
            ]
          : [];
      if (command === "ssh_known_hosts_list") return [];
      if (command === "ssh_agent_identities") return { status: "empty", identities: [] };
      if (command === "ssh_certificate_inspect")
        return {
          certificateType: "user",
          fingerprint: "SHA256:FixturePublicKey",
          signingCaFingerprint: "SHA256:FixturePublicCa",
          serial: "42",
          validity: "forever",
          principals: ["fixture-user"],
        };
      if (command === "ssh_config_preview")
        return {
          hosts: [
            {
              alias: params.has("longLabels")
                ? "Imported alias for a long descriptive production connection name"
                : "Imported alias",
              endpoint: params.has("chainCertificate")
                ? structuredClone(sshRecords[0].sshEndpoint)
                : { host: "duplicate.example.invalid", user: "fixture", port: 22 },
              duplicate: false,
            },
          ],
          warnings: [],
        };
      if (command === "ssh_sftp_recoveries")
        return params.has("sftpFixture")
          ? [
              {
                id: "fixture-recovery",
                direction: "upload",
                localPath: "C:/Fixture files/large-source.bin",
                remotePath: "/remote/long-directory-name/large-source.bin",
                partialBytes: 4096,
                totalBytes: 1048576,
              },
            ]
          : [];
      if (command === "ssh_sftp_list")
        return params.has("filesFixture")
          ? [
              { name: "deployments", kind: "directory" },
              { name: "README.md", kind: "file" },
            ]
          : [];
      if (command === "ssh_sftp_resume")
        return new Promise<void>((resolve) => {
          finishTransfer = resolve;
        });
      if (command === "plugin:event|listen") {
        const id = Number(input.handler);
        listeners.set(id, String(input.event));
        return id;
      }
      if (command === "plugin:event|unlisten") {
        listeners.delete(Number(input.eventId));
        return;
      }
      if (command === "remote_request")
        throw new Error("Machine is unreachable: connection refused");
      if (command.includes("is_maximized") || command.includes("is_fullscreen")) return false;
      return null;
    },
  },
});
await setLanguagePreference("en");
if (params.has("serverRestoreFixture"))
  await (await import("../../src/app/model/appLifecycle")).loadResumedWorkspace();
function ForwardFixture() {
  const inventory = useServerInventory();
  const server = inventory.servers.find((item) => item.id === "ssh-duplicate");
  return server ? (
    <div className="p-4">
      <ServerForwards server={server} />
    </div>
  ) : null;
}
function Fixture() {
  useEffect(() => {
    if (params.has("queueFixture")) void refreshSshRunbookQueue();
  }, []);
  const [active, setActive] = useState<WorkspaceToolId>("servers");
  const [visible, setVisible] = useState(true);
  if (params.has("autocompleteFixture"))
    return (
      <main className="flex h-dvh min-w-0 flex-col">
        <TerminalView
          id="autocomplete-fixture"
          cwd=""
          sshEndpoint={{ host: "remote.example.invalid", user: "fixture", port: 22 }}
          shellIntegration="bash"
          active
        />
      </main>
    );
  if (params.has("forwardFixture")) return <ForwardFixture />;
  if (params.has("sftpFixture"))
    return visible ? (
      <ServerFiles connectionId="ssh-sftp-fixture" onClose={() => setVisible(false)} />
    ) : null;
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, padding: 4 }}>
        <Button onClick={() => setVisible(!visible)}>Toggle servers</Button>
      </div>
      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        {params.has("rail") ? (
          <ProjectRail
            cwd=""
            recents={[]}
            onSelectProject={() => {}}
            onOpenProject={() => {}}
            onOpenServers={() => {
              setActive("servers");
              setVisible(true);
            }}
            serversActive={active === "servers" && visible}
          />
        ) : null}
        <main style={{ flex: 1, minWidth: 0, display: "flex" }}>
          <ToolNavigationContext.Provider
            value={{
              active,
              cwd: "",
              notesEnabled: true,
              includeServers: true,
              onSelect: setActive,
            }}
          >
            <ToolPanel
              active={visible && active === "servers"}
              keepEffects={params.has("terminalWorkspace")}
            >
              {params.has("terminalWorkspace") ? (
                <ServersTerminalWorkspace visible={visible && active === "servers"}>
                  <ServersView besideRail />
                </ServersTerminalWorkspace>
              ) : (
                <ServersView besideRail />
              )}
            </ToolPanel>
            {active !== "servers" ? (
              <div style={{ width: "100%", height: 40 }}>
                <ToolNavigation />
              </div>
            ) : null}
          </ToolNavigationContext.Provider>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
