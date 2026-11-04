import { expect, it } from "vitest";
import { voiceThreadToolAllowed } from "./voiceToolScope";
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
    "files.write",
    "shell.run",
    "browser.open",
    "desktop.arbitrary",
    "workspaces.delivery.merge",
    "workspaces.delivery.publish",
    "workspaces.cleanup.apply",
    "sprints.ingest",
  ])
    expect(voiceThreadToolAllowed("conversation", action)).toBe(false);
  expect(voiceThreadToolAllowed("shell", "desktop.launch")).toBe(false);
});
