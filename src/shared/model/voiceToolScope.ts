/** Desktop writes still require their exact native approval/allowlist/ref gates;
 * a thread subject never inherits a working copy or another session's lease. */
export function voiceGlobalToolAllowed(family: string, action: string) {
  if (
    family === "conversation" &&
    ["remote.grants.list", "remote.call", "remote.result"].includes(action)
  )
    return true;
  if (family === "conversation" && ["social.send.propose", "social.send.status"].includes(action))
    return true;
  if (
    family === "conversation" &&
    ["environment.describe", "environment.persistence.status", "sync.status"].includes(action)
  )
    return true;
  if (
    family === "conversation" &&
    [
      // Owner-chosen Assistant folders only: reads need no approval, writes and every
      // command run keep their exact native approval (or the owner's explicit setting).
      "files.roots",
      "files.inspect",
      "files.list",
      "files.index",
      "files.search",
      "files.searchContent",
      "files.read",
      "files.create",
      "files.write",
      "files.rename",
      "files.move",
      "files.copy",
      "files.delete",
      "files.operation.status",
      "commands.run",
      "commands.run.status",
      "commands.run.cancel",
    ].includes(action)
  )
    return true;
  if (family === "social")
    return [
      "accounts.list",
      "inbox.list",
      "thread.read",
      "thread.page",
      "policy.get",
      "capabilities.get",
      "replies.draft",
      "messages.draft",
      "comments.draft",
      "drafts.read",
      "drafts.update",
    ].includes(action);
  if (
    family === "conversation" &&
    ["observations.read", "observations.ack", "observations.resnapshot"].includes(action)
  )
    return true;
  // Computer use acts on owner-approved apps, not on a project; the owner's permission mode,
  // app approvals, presence and Stop gate every call in both scopes.
  if (
    family === "conversation" &&
    (voiceDesktopObservation(action) || voiceDesktopInputAction(action))
  )
    return true;
  if (
    family === "conversation" &&
    [
      "notebook.list",
      "notebook.get",
      "notebook.create",
      "notebook.update",
      "notebook.delete",
    ].includes(action)
  )
    return true;
  return (
    family === "conversation" &&
    [
      "tools.list",
      "tools.search",
      "tools.describe",
      "tools.status",
      "models.pool.list",
      "devices.list",
      "preferences.read",
      "preferences.patch",
      "preferences.status",
      "providers.status",
      "providers.quota.refresh",
      "providers.operation.status",
      "projects.organization.read",
      "servers.list",
      "servers.get",
      "servers.ssh.execute",
      "servers.ssh.status",
      "servers.ssh.cancel",
      "servers.ssh.save",
      "servers.ssh.remove",
    ].includes(action)
  );
}

function voiceDesktopObservation(action: string) {
  return [
    "desktop.status",
    "desktop.snapshot",
    "desktop.windows.list",
    "desktop.find",
    "desktop.screenshot",
    "desktop.wait",
  ].includes(action);
}

export function voiceDesktopInputAction(action: string) {
  return [
    "desktop.launch",
    "desktop.clipboard",
    "desktop.act",
    "desktop.click",
    "desktop.setValue",
    "desktop.press",
  ].includes(action);
}
export function voiceThreadToolAllowed(family: string, action: string) {
  if (family === "conversation" && action === "browser.operation.status") return true;
  if (
    family === "conversation" &&
    [
      "terminals.list",
      "terminals.read",
      "terminals.create",
      "terminals.write",
      "terminals.interrupt",
      "terminals.close",
      "terminals.operation.status",
      "commands.run",
      "commands.run.status",
      "commands.run.cancel",
      "browser.status",
      "browser.claim",
      "browser.release",
      "browser.open",
      "browser.frame",
      "browser.read",
      "browser.resize",
      "browser.preview",
      "browser.input",
      "browser.close",
      "browser.recording.start",
      "browser.recording.stop",
      "browser.recording.status",
      "pullRequests.assistantWatch",
      "pullRequests.assistantUnwatch",
      "pullRequests.assistantWatches",
    ].includes(action)
  )
    return true;
  if (
    family === "conversation" &&
    [
      "files.inspect",
      "files.list",
      "files.index",
      "files.search",
      "files.searchContent",
      "files.read",
      "files.create",
      "files.write",
      "files.rename",
      "files.move",
      "files.copy",
      "files.delete",
      "files.operation.status",
      "devServers.list",
      "devServers.details",
      "devServers.logs",
      "devServers.start",
      "devServers.stop",
      "devServers.restart",
      "devServers.operation.status",
    ].includes(action)
  )
    return true;
  if (
    family === "conversation" &&
    ["sessions.create", "sessions.submit", "sessions.submit.status", "sessions.stop"].includes(
      action,
    )
  )
    return true;
  if (
    family === "conversation" &&
    [
      "notebook.list",
      "notebook.get",
      "notebook.create",
      "notebook.update",
      "notebook.delete",
      "workspace.projects.select",
      "workspace.operation.status",
      "workspace.sessions.create",
      "workspace.sessions.open",
      "workspace.sessions.submit",
      "workspace.sessions.submit.status",
      "workspace.sessions.stop",
    ].includes(action)
  )
    return true;
  if (family === "social" || family === "runtime-logs") return true;
  if (family !== "conversation") return false;
  return (
    [
      "crews.list",
      "crews.schema",
      "crews.inspect",
      "crews.get",
      "crews.definitions.list",
      "crews.definition.get",
      "crews.agents.list",
      "crews.agent.get",
      "crews.runs.list",
      "crews.active.list",
      "crews.save",
      "crews.agent.save",
      "crews.start",
      "crews.member.ask",
      "crews.assign",
      "crews.request",
      "crews.resolve",
      "crews.pause",
      "crews.stop",
      "crews.resume",
      "crews.accept",
      "crews.finish",
      "crews.answer",
    ].includes(action) ||
    [
      // Read-only project views; no approval needed.
      "git.index",
      "git.fileDiff",
      "git.branches",
      "git.worktrees",
      "models.list",
      "usage.sessions.read",
      "skills.search",
      "skills.read",
      "devices.list",
      "logs.monitors.list",
    ].includes(action) ||
    [
      "projects.browse",
      "projects.createDirectory",
      "projects.open",
      "git.stash",
      "git.pull",
      "git.pushPreview",
      "git.push",
      "git.mergePreview",
      "git.merge",
    ].includes(action) ||
    [
      "environment.describe",
      "environment.persistence.status",
      "sync.status",
      "tunnels.status",
      "mobile.access.status",
      "events.subscribe",
    ].includes(action) ||
    [
      "sessions.configuration",
      "sessions.configure",
      "sessions.contextual.preview",
      "sessions.contextual.create",
      "sessions.draft",
    ].includes(action) ||
    [
      "sprints.list",
      "sprints.get",
      "sprints.report",
      "sprints.create",
      "sprints.update",
      "sprints.start",
      "sprints.complete",
      "sprints.archive",
      "sprints.plan",
      "workspaces.list",
      "workspaces.get",
      "workspaces.prepare",
      "workspaces.resume",
      "workspaces.finish",
      "workspaces.close",
      "workspaces.featureClaims.list",
      "workspaces.featureClaims.acquire",
      "workspaces.featureClaims.release",
      "workspaces.cleanup.plan",
      "workspaces.cleanup.status",
      "workspaces.delivery.review",
    ].includes(action) ||
    [
      "projects.get",
      "projects.workspacePolicy.get",
      "projects.organization.read",
      "projects.organization.patch",
      "projects.organization.status",
      "git.status",
      "git.stage",
      "git.unstage",
      "git.commit",
      "commands.status",
      "commands.dispatch",
      "ownerQuestions.list",
      "ownerQuestions.answer",
      "events.read",
      "sessions.list",
      "sessions.read",
      "tools.list",
      "tools.search",
      "tools.describe",
      "tools.status",
      "tasks.list",
      "tasks.get",
      "tasks.create",
      "tasks.start",
      "tasks.stop",
      "tasks.retry",
      "tasks.update",
      "tasks.delete",
      "tasks.transfer",
      "tasks.queue.pause",
      "tasks.review.recheck",
      "tasks.reorder",
      "goals.list",
      "goals.get",
      "goals.create",
      "goals.replan",
      "goals.cancel",
      "goals.update",
      "goals.delete",
      "automations.list",
      "automations.get",
      "automations.create",
      "automations.update",
      "automations.pause",
      "automations.resume",
      "automations.delete",
      "automations.runs",
      "automations.runNow",
      "automations.stopRun",
    ].includes(action) ||
    voiceDesktopInputAction(action) ||
    voiceDesktopObservation(action) ||
    /^(notes|inbox)\./.test(action) ||
    ["host.limits.status", "models.pool.list", "shell.profiles"].includes(action)
  );
}
