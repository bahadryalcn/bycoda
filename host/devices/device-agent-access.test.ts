import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { dispatchConversationTools } from "../server/tools-conversation";
import {
  assertAgentDevicesEnabled,
  readAgentDevicesEnabled,
  saveAgentDevicesEnabled,
} from "./device-agent-access";

const cleanups: (() => Promise<void>)[] = [];

function store() {
  const dir = mkdtempSync(join(tmpdir(), "agent-devices-"));
  const host = new HostStore(join(dir, "host.db"));
  cleanups.push(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return host;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("keeps agent device use on until the owner turns it off", async () => {
  const host = store();
  expect(await readAgentDevicesEnabled(host)).toBe(true);
  await expect(assertAgentDevicesEnabled(host)).resolves.toBeUndefined();
  expect(await saveAgentDevicesEnabled(host, false)).toBe(false);
  expect(await readAgentDevicesEnabled(host)).toBe(false);
  await expect(assertAgentDevicesEnabled(host)).rejects.toThrow("DEVICES_AGENT_ACCESS_OFF");
  await expect(saveAgentDevicesEnabled(host, "off")).rejects.toThrow("true or false");
  expect(await readAgentDevicesEnabled(host)).toBe(false);
  await saveAgentDevicesEnabled(host, true);
  expect(await readAgentDevicesEnabled(host)).toBe(true);
});

it("refuses agent device tools before they reach the device host while the switch is off", async () => {
  const host = store();
  await saveAgentDevicesEnabled(host, false);
  const principal = {
    kind: "session" as const,
    projectId: "project",
    sessionId: "session",
    provider: "codex",
  };
  const status = vi.fn();
  const dependencies = {
    conversationAccess: { authorization: () => ({}), principalForToken: async () => principal },
    engine: {
      store: {
        ready: host.ready,
        db: {
          withAuthorization: async (_scope: unknown, run: () => Promise<unknown>) => run(),
          scope: (run: () => Promise<unknown>) => host.db.scope(run),
          exec: (sql: string) => host.db.exec(sql),
          prepare: (sql: string) => host.db.prepare(sql),
        },
      },
    },
    deviceHost: { status },
  };
  const request = {
    conversationPrincipal: principal,
    params: { action: "devices.status", input: {} },
    token: "token",
  };
  await expect(
    dispatchConversationTools(dependencies as never, request as never),
  ).rejects.toThrow("DEVICES_AGENT_ACCESS_OFF");
  expect(status).not.toHaveBeenCalled();
});
