/** Audited boundaries, not permission grants or claims of installed acceptance. */
export const VOICE_CAPABILITY_COVERAGE: Record<
  string,
  {
    /** Tool ids a voice scope (global or project thread) may call. */
    tools: string[];
    /** Catalog family of the ids; defaults to "conversation". */
    family?: "runtime-logs";
    /** Tool ids that exist but no voice scope allows; kept for the audit trail only. */
    sessionOnly?: string[];
    remaining: string;
  }
> = {
  appearance: {
    tools: [],
    remaining:
      "Owner-only Settings model calls that write theme drafts; voice does not generate or apply themes.",
  },
  approvals: {
    tools: [],
    remaining:
      "Owner approval relay between the computer and paired phones; the assistant never answers its own approvals.",
  },
  assistant: {
    tools: [],
    remaining:
      "Voice assistant controls use the dedicated assistant protocol and existing native approvals.",
  },
  attachments: {
    tools: ["sessions.draft"],
    sessionOnly: ["attachments.list", "attachments.read"],
    remaining: "Only accepted same-session attachments; no arbitrary upload grants.",
  },
  automations: {
    tools: [
      "automations.list",
      "automations.create",
      "automations.update",
      "automations.pause",
      "automations.resume",
      "automations.delete",
      "automations.runs",
      "automations.runNow",
      "automations.stopRun",
    ],
    remaining: "Global creation requires explicit reviewed execution settings.",
  },
  browser: {
    tools: ["browser.preview", "browser.status", "browser.read"],
    remaining:
      "Real session control lease required. browser.annotation.* is owned by one coding session's annotation scope and the Room browser refuses it, so annotations stay session-only.",
  },
  commands: {
    tools: [
      "commands.dispatch",
      "commands.status",
      "commands.run",
      "commands.run.status",
      "commands.run.cancel",
    ],
    remaining:
      "Finite session command allowlist; session shell/send/rewind require dedicated owner workflow. commands.run is Room-only, needs exact native approval per run unless the owner enabled Run commands without asking, and runs only inside an owner-chosen folder or the project working copy.",
  },
  conversation: {
    tools: ["tools.search", "tools.describe"],
    remaining: "Grant issuance and native relay are internal transport.",
  },
  crews: {
    tools: ["crews.list", "crews.active.list", "crews.start", "crews.member.ask", "crews.answer"],
    remaining:
      "Room writes, including member answers, require exact native review, the owner's delegated-approval policy, the pending question and current project revision. crews.respond (granting a member's tool approval) stays a coordinator/owner action: the assistant never grants approvals.",
  },
  decisionModels: {
    tools: [],
    remaining:
      "Owner-only Settings: model sources, credentials, local installs and routing stay outside voice.",
  },
  desktop: {
    tools: ["desktop.status", "desktop.act"],
    remaining:
      "Exact native approval and owner control allowlist retained. Human input (key chords via press, scroll, hover, drag, window focus) uses the same gate; Alt+F4 and Win+L, free mouse coordinates, held keys, window resize/move/minimize, system surfaces and notifications are unavailable.",
  },
  devices: {
    tools: ["devices.list"],
    sessionOnly: ["devices.preview"],
    remaining:
      "Host simulator/emulator list only; a connected machine's devices, preview and control need a focused session and device control gates.",
  },
  devServers: {
    tools: ["devServers.list", "devServers.start"],
    remaining: "Session/process ownership retained.",
  },
  environment: {
    tools: ["environment.describe", "environment.persistence.status"],
    remaining: "Persistence recovery remains native owner-only.",
  },
  events: {
    tools: ["events.subscribe", "events.read"],
    remaining: "Bounded committed-change long poll; no durable replay or external PR push.",
  },
  files: {
    tools: ["files.read", "files.write", "files.roots"],
    remaining:
      "Exact working-copy and file revision gates retained. The global Room reaches only owner-chosen Assistant folders; folder choice is owner-only Settings.",
  },
  git: {
    tools: [
      "git.status",
      "git.index",
      "git.fileDiff",
      "git.branches",
      "git.worktrees",
      "git.stage",
      "git.unstage",
      "git.commit",
      "git.stash",
      "git.pull",
      "git.pushPreview",
      "git.push",
      "git.mergePreview",
      "git.merge",
    ],
    remaining:
      "Exact native review and Git state checks; push and merge need exact approval; force push and history rewrite remain unavailable.",
  },
  goals: {
    tools: ["goals.create", "goals.get"],
    remaining: "Native plan approval remains separate from creation.",
  },
  history: {
    tools: [],
    sessionOnly: ["history.import.status"],
    remaining:
      "Import commit/cancel remain native owner-only; status requires focused desktop session.",
  },
  host: {
    tools: ["host.limits.status"],
    remaining: "Paired device/credential administration remains native owner-only.",
  },
  inbox: {
    tools: [
      "inbox.list",
      "inbox.details",
      "inbox.thread",
      "inbox.comment",
      "inbox.prAction",
      "inbox.review",
      "inbox.reviewContext",
      "inbox.result",
    ],
    remaining: "External writes retain native review and durable operation receipts.",
  },
  machine: {
    tools: [],
    sessionOnly: ["machines.list"],
    remaining: "Machine pairing/credentials remain native owner-only.",
  },
  mobile: {
    tools: ["mobile.access.status"],
    remaining: "Pairing/access enable/disable secrets remain owner-device scoped.",
  },
  models: {
    tools: ["models.pool.list", "models.list"],
    remaining: "Catalog availability is not provider entitlement.",
  },
  native: {
    tools: [],
    sessionOnly: ["ui.tools.open", "ui.workspace.open"],
    remaining:
      "Native upload/rewind/window lifecycle APIs are privileged internal protocols, not generic voice RPCs. ui.workspace.open only navigates but its relay needs a coding-session window context; opening any view or settings section from the global Room needs a native Room navigation operation that does not exist yet.",
  },
  notes: {
    tools: [
      "notes.list",
      "notes.create",
      "notes.read",
      "notes.update",
      "notes.delete",
      "notebook.list",
      "notebook.get",
      "notebook.create",
      "notebook.update",
      "notebook.delete",
    ],
    remaining:
      "Personal Room notebook has no project; project notes keep target scope. Revision, exact native review and delete recovery retained.",
  },
  preferences: {
    tools: ["preferences.read", "preferences.patch"],
    remaining:
      "Connected desktop and real Room thread supported; microphone enabling, credentials and executable paths excluded.",
  },
  projects: {
    tools: [
      "projects.get",
      "projects.browse",
      "projects.createDirectory",
      "projects.open",
      "projects.organization.read",
      "projects.organization.patch",
      "projects.organization.status",
    ],
    remaining:
      "Visible unlocked desktop projects only; target organization writes require exact project and current revision.",
  },
  providers: {
    tools: ["providers.status", "providers.quota.refresh"],
    remaining:
      "Connected desktop; cached status is not sign-in, credential changes remain owner-only.",
  },
  pullRequests: {
    tools: [
      "pullRequests.assistantWatch",
      "pullRequests.assistantUnwatch",
      "pullRequests.assistantWatches",
    ],
    remaining:
      "Linking a session to a pull request is an owner action in the Git panel. pullRequests.watch, unwatch and watches stay per coding session. The Room watches through pullRequests.assistantWatch on the Host (read-only, up to 30, 14 days, project thread only): it notifies on merge, close, CI and review changes but never comments, merges or pushes.",
  },
  push: {
    tools: [],
    remaining:
      "Phone push registration and delivery are device-bound owner settings, not voice actions.",
  },
  resources: {
    tools: [],
    sessionOnly: ["resources.read"],
    remaining:
      "Observed runtime resources, not billed provider usage. The read is answered by the desktop relay, which accepts only coding-session windows.",
  },
  runtimeLogs: {
    family: "runtime-logs",
    tools: ["read", "sources"],
    remaining: "Separate runtime-logs family also retains scoped bounded reads.",
  },
  sessions: {
    tools: [
      "sessions.list",
      "sessions.create",
      "sessions.submit",
      "sessions.submit.status",
      "sessions.stop",
      "sessions.configure",
      "sessions.contextual.create",
      "sessions.draft",
      "ownerQuestions.answer",
    ],
    remaining:
      "Handoff is unsent; arbitrary fork/send/destructive restore require their dedicated workflows.",
  },
  shell: {
    tools: ["shell.profiles"],
    remaining: "Profile mutation and arbitrary shell execution remain owner workflows.",
  },
  sprints: {
    tools: ["sprints.list", "sprints.create", "sprints.plan", "sprints.complete"],
    remaining:
      "Single-project scope; cross-host ingestion and goal context replication are internal.",
  },
  ssh: {
    tools: [
      "servers.list",
      "servers.get",
      "servers.ssh.execute",
      "servers.ssh.status",
      "servers.ssh.cancel",
      "servers.ssh.save",
      "servers.ssh.remove",
    ],
    remaining:
      "Saved server identity, exact native confirmation and status recovery retained; Room inventory changes require current inventory revision.",
  },
  stewards: {
    tools: [],
    sessionOnly: ["stewards.list", "stewards.runNow"],
    remaining: "Session-scoped scheduler authority retained.",
  },
  sync: {
    tools: ["sync.status"],
    remaining:
      "Read host sync counter only; replication push/pull remain internal owner protocols.",
  },
  tasks: {
    tools: [
      "tasks.list",
      "tasks.create",
      "tasks.start",
      "tasks.delete",
      "tasks.transfer",
      "tasks.queue.pause",
      "tasks.review.recheck",
      "tasks.reorder",
    ],
    remaining:
      "No auto-merge or publication; exact reviewed global execution settings. Deletion, transfer, queue changes and review recheck use the same native review, task versions and durable receipts as other Room work writes.",
  },
  terminals: {
    tools: ["terminals.list", "terminals.write"],
    remaining: "Native terminal ownership and approval retained.",
  },
  tunnels: {
    tools: ["tunnels.status"],
    remaining: "Exposure/start/stop and credentials remain native owner-only.",
  },
  usage: {
    tools: ["usage.sessions.read"],
    remaining: "Host-observed coverage, not provider billing.",
  },
  voice: {
    tools: ["preferences.patch"],
    remaining: "Native voice protocol owns opt-in capture and setup/install gates.",
  },
  workspace: {
    tools: [
      "files.read",
      "git.status",
      "skills.search",
      "skills.read",
      "logs.monitors.list",
      "workspace.projects.select",
      "workspace.sessions.create",
      "workspace.sessions.open",
      "workspace.sessions.submit",
      "workspace.sessions.submit.status",
      "workspace.sessions.stop",
    ],
    remaining:
      "Finite Room navigation/session owner workflows only; source admission and native effect availability must be verified. Submit status retains the original appRequestId; absence is not proof of non-delivery. Global app search, the Today summary and MCP server status are computed in the desktop renderer or its native files and have no Host data path, so they have no voice tool; machines.list and logs.wait need the desktop relay or a session waiter. Assistant activity and notifications are read through the voice assistant_activity control.",
  },
  workspaces: {
    tools: [
      "workspaces.prepare",
      "workspaces.featureClaims.acquire",
      "workspaces.cleanup.plan",
      "workspaces.delivery.review",
    ],
    remaining: "Cleanup apply, merge, publish and owner-retarget remain native workflows.",
  },
  worktrees: {
    tools: ["workspaces.prepare", "git.worktrees"],
    remaining: "Legacy removal and branch publication retain owner workflow.",
  },
};
