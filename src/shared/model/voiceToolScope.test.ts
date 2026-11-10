import { expect, it } from "vitest";
import { voiceGlobalToolAllowed, voiceThreadToolAllowed } from "./voiceToolScope";
it("permits only the finite desktop approval path for a real assistant thread and retains working-copy scope", () => {
  for (const action of [
    "desktop.launch",
    "desktop.clipboard",
    "desktop.act",
    "desktop.click",
    "desktop.setValue",
    "desktop.press",
    "desktop.status",
    "desktop.snapshot",
  ])
    expect(voiceThreadToolAllowed("conversation", action)).toBe(true);
  for (const action of [
    "desktop.configure",
    "desktop.resume",
    "desktop.stop",
    "shell.run",
    "desktop.arbitrary",
    "workspaces.delivery.merge",
    "workspaces.delivery.publish",
    "workspaces.cleanup.apply",
    "sprints.ingest",
  ])
    expect(voiceThreadToolAllowed("conversation", action)).toBe(false);
  for (const action of ["files.write", "browser.open"])
    expect(voiceThreadToolAllowed("conversation", action), action).toBe(true);
  // Terminals, browser and dev servers still need a visible project; folder files do not.
  for (const action of ["browser.open", "terminals.write", "devServers.start"])
    expect(voiceGlobalToolAllowed("conversation", action), action).toBe(false);
  expect(voiceThreadToolAllowed("shell", "desktop.launch")).toBe(false);
});

it("allows browser.read in voice wherever browser.frame is allowed", () => {
  for (const scope of [voiceThreadToolAllowed, voiceGlobalToolAllowed])
    expect(scope("conversation", "browser.read")).toBe(scope("conversation", "browser.frame"));
  expect(voiceThreadToolAllowed("conversation", "browser.read")).toBe(true);
});

it("lets the global thread reach owner-chosen folders and run commands, nothing broader", () => {
  for (const action of [
    "files.roots",
    "files.list",
    "files.read",
    "files.search",
    "files.write",
    "files.create",
    "files.rename",
    "files.move",
    "files.copy",
    "files.delete",
    "files.operation.status",
    "commands.run",
    "commands.run.status",
    "commands.run.cancel",
  ])
    expect(voiceGlobalToolAllowed("conversation", action), action).toBe(true);
  for (const action of ["commands.run", "commands.run.status", "commands.run.cancel"])
    expect(voiceThreadToolAllowed("conversation", action), action).toBe(true);
  for (const action of ["files.roots", "folders.set", "folders.get", "shell.run", "commands.exec"])
    expect(voiceThreadToolAllowed("conversation", action), action).toBe(false);
  // Choosing folders and the run-without-asking switch are owner settings, never tools.
  for (const action of ["folders.set", "folders.get", "assistant.folders.set"])
    expect(voiceGlobalToolAllowed("conversation", action), action).toBe(false);
});
