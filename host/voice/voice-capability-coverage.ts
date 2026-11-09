/** Audited boundaries, not permission grants or claims of installed acceptance. */
export const VOICE_CAPABILITY_COVERAGE: Record<string, { tools: string[]; remaining: string }> = {
  appearance: {
    tools: [],
    remaining:
      "Owner-only Settings model calls that write theme drafts; voice does not generate or apply themes.",
  },
  assistant: {
    tools: [],
    remaining:
      "Voice assistant controls use the dedicated assistant protocol and existing native approvals.",
  },
  attachments: {
    tools: ["attachments.list", "attachments.read", "sessions.draft"],
    remaining: "Only accepted same-session attachments; no arbitrary upload grants.",
  },
  automations: {
    tools: ["automations.list", "automations.create", "automations.runNow"],
    remaining: "Global creation requires explicit reviewed execution settings.",
  },
  browser: {
    tools: ["browser.preview", "browser.status"],
    remaining: "Real session control lease required.",
  },
  commands: {
    tools: ["commands.dispatch", "commands.status"],
    remaining:
      "Finite session command allowlist; arbitrary shell/send/rewind require dedicated owner workflow.",
  },
  conversation: {
    tools: ["tools.search", "tools.describe"],
    remaining: "Grant issuance and native relay are internal transport.",
  },
  crews: {
    tools: ["crews.list", "crews.start"],
    remaining:
      "Room writes require exact native review and current project revision; response and answer retain session-specific owner gates.",
  },
  decisionModels: {
    tools: [],
    remaining:
      "Owner-only Settings: model sources, credentials, local installs and routing stay outside voice.",
  },
  desktop: {
    tools: ["desktop.status", "desktop.act"],
    remaining: "Exact native approval and owner control allowlist retained.",
  },
  devices: {
    tools: ["devices.list", "devices.preview"],
    remaining: "Explicit machine/device and device control gates retained.",
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
    tools: ["files.read", "files.write"],
    remaining: "Exact working-copy and file revision gates retained.",
  },
  git: {
    tools: ["git.status", "git.stage", "git.unstage", "git.commit", "git.stash", "git.pull"],
    remaining:
      "Exact native review and Git state checks; push/merge/history rewrite remain owner workflows.",
  },
  goals: {
    tools: ["goals.create", "goals.get"],
    remaining: "Native plan approval remains separate from creation.",
  },
  history: {
    tools: ["history.import.status"],
    remaining:
      "Import commit/cancel remain native owner-only; status requires focused desktop session.",
  },
  host: {
    tools: ["host.limits.status"],
    remaining: "Paired device/credential administration remains native owner-only.",
  },
  inbox: {
    tools: ["inbox.list", "inbox.review"],
    remaining: "External writes retain native review and durable operation receipts.",
  },
  machine: {
    tools: ["machines.list"],
    remaining: "Machine pairing/credentials remain native owner-only.",
  },
  mobile: {
    tools: ["mobile.access.status"],
    remaining: "Pairing/access enable/disable secrets remain owner-device scoped.",
  },
  models: {
    tools: ["models.list"],
    remaining: "Catalog availability is not provider entitlement.",
  },
  native: {
    tools: ["ui.tools.open", "ui.workspace.open"],
    remaining:
      "Native upload/rewind/window lifecycle APIs are privileged internal protocols, not generic voice RPCs.",
  },
  notes: {
    tools: [
      "notes.list",
      "notes.create",
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
  push: {
    tools: [],
    remaining:
      "Phone push registration and delivery are device-bound owner settings, not voice actions.",
  },
  resources: {
    tools: ["resources.read"],
    remaining: "Observed runtime resources, not billed provider usage.",
  },
  runtimeLogs: {
    tools: ["logs.sources", "logs.read"],
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
    tools: ["stewards.list", "stewards.runNow"],
    remaining: "Session-scoped scheduler authority retained.",
  },
  sync: {
    tools: ["sync.status"],
    remaining:
      "Read host sync counter only; replication push/pull remain internal owner protocols.",
  },
  tasks: {
    tools: ["tasks.list", "tasks.create", "tasks.start"],
    remaining: "No auto-merge or publication; exact reviewed global execution settings.",
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
      "workspace.projects.select",
      "workspace.sessions.create",
      "workspace.sessions.open",
      "workspace.sessions.submit",
      "workspace.sessions.submit.status",
      "workspace.sessions.stop",
    ],
    remaining:
      "Finite Room navigation/session owner workflows only; source admission and native effect availability must be verified. Submit status retains the original appRequestId; absence is not proof of non-delivery.",
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
    tools: ["git.worktrees", "workspaces.prepare"],
    remaining: "Legacy removal and branch publication retain owner workflow.",
  },
};
